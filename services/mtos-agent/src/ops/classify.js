import { redactCommandLine, safePath } from './redact.js';

// Pure functions: raw Windows probe output in, classified inventory out.
// A process is only attributed to an owner when the process tree or a registered
// task/service proves it; otherwise it stays "unknown" instead of being guessed.

const lower = (value) => String(value ?? '').toLowerCase();
const isNode = (p) => /^node(\d+)?(\.exe)?$/.test(p.name);
const isPython = (p) => /^pythonw?(\.exe)?$/.test(p.name);

/** role: always = must be running, on-demand = started per job/session, scheduled = started by a timer, app = user application. */
export const RULES = [
  { id: 'mtos-agent-api', label: 'MTOS Agent API', category: 'server', role: 'always', expected: true, singleton: true, port: 8789, test: (p) => isNode(p) && /mtos-agent[\\/]+src[\\/]+server\.js/i.test(p.cmd) },
  { id: 'mtos-agent-worker', label: 'MTOS Agent Worker', category: 'server', role: 'always', expected: true, singleton: true, test: (p) => isNode(p) && /mtos-agent[\\/]+src[\\/]+worker\.js/i.test(p.cmd) },
  { id: 'p0-api', label: 'P0 API', category: 'server', role: 'always', expected: true, singleton: true, port: 8787, test: (p, c) => isNode(p) && !/mtos-agent/i.test(p.cmd) && (c.ports.get(8787)?.has(p.i) || /(^|[\\/\s"])src[\\/]+server\.js/i.test(p.cmd)) },
  { id: 'p0-web', label: 'P0 웹(next start)', category: 'server', role: 'always', expected: false, singleton: true, port: 3000, test: (p) => /next[\\/]dist[\\/]bin[\\/]next/i.test(p.cmd) },
  { id: 'cloudflared-p0', label: 'Cloudflare Tunnel (P0)', category: 'server', role: 'always', expected: true, singleton: true, test: (p) => p.name === 'cloudflared.exe' && /config-p0\.yml/i.test(p.cmd) },
  { id: 'cloudflared-hermes-dashboard', label: 'Cloudflare Tunnel (Hermes 대시보드)', category: 'server', role: 'always', singleton: true, test: (p) => p.name === 'cloudflared.exe' && /hermes-dashboard/i.test(p.cmd) },
  { id: 'cloudflared-journal', label: 'Cloudflare Tunnel (Hermes 저널)', category: 'server', role: 'always', singleton: true, test: (p) => p.name === 'cloudflared.exe' && /token-file/i.test(p.cmd) },
  { id: 'cloudflared-other', label: 'Cloudflare Tunnel (기타)', category: 'server', role: 'always', test: (p) => p.name === 'cloudflared.exe' },
  { id: 'thunderbird', label: 'Thunderbird (학교 메일 수집)', category: 'collector', role: 'always', expected: true, test: (p) => p.name === 'thunderbird.exe' },
  { id: 'codex-cli', label: 'Codex CLI', category: 'ai', role: 'on-demand', inherit: true, test: (p) => /^codex(\.exe)?$/.test(p.name) || /@openai[\\/]+codex|[\\/]codex(\.js|\.exe|\.cmd)?(["\s]|$)/i.test(p.cmd) },
  { id: 'claude-code', label: 'Claude Code', category: 'ai', role: 'on-demand', inherit: true, test: (p) => p.name === 'claude.exe' },
  { id: 'school-portal-browser', label: '학교 포털 브라우저', category: 'collector', role: 'on-demand', inherit: true, test: (p) => /^(chrome|chromium|msedge|headless_shell)(\.exe)?$/.test(p.name) && /portal|playwright|puppeteer|school/i.test(p.cmd) },
  { id: 'hermes-browser-harness', label: 'Hermes 브라우저 하네스', category: 'ai', role: 'on-demand', transient: true, test: (p) => isPython(p) && /browser_harness/i.test(p.cmd) },
  { id: 'hermes', label: 'Hermes (AI 에이전트)', category: 'ai', role: 'always', test: (p) => (isPython(p) && /hermes[\\/]bin[\\/]hermes\.exe/i.test(p.cmd)) || p.name === 'hermes.exe' },
  { id: 'hermes-location-receiver', label: 'Hermes 위치 수신기', category: 'server', role: 'always', test: (p) => isPython(p) && /owntracks_receiver/i.test(p.cmd) },
  { id: 'orca', label: 'Orca', category: 'app', role: 'app', test: (p) => /^orca(\.exe)?$/.test(p.name) },
  { id: 'aside', label: 'Aside', category: 'app', role: 'app', test: (p) => /^aside(-daemon)?\.exe$/.test(p.name) && !/\bmcp\b/i.test(p.cmd) },
  { id: 'chrome-remote-desktop', label: 'Chrome 원격 데스크톱', category: 'app', role: 'always', test: (p) => /^remoting_(host|desktop)\.exe$/.test(p.name) },
];

const MCP_WORD = /(^|[\s"\\/])mcp(\.js|\.py|\.exe)?(\s|"|$)|[\\/]mcp[-_][\w-]+|[\w-]+[-_]mcp[\\/\s"]|mcp[-_]server/i;

function mcpIdentity(p, registry) {
  if (!MCP_WORD.test(p.cmd) && !/mcp/i.test(p.path ?? '')) return null;
  if (p.name === 'powershell.exe' || p.name === 'cmd.exe') return null;
  const hit = registry.find((r) => r.name && new RegExp(`(^|[^\\w])${r.name.replace(/[^\w]/g, '.')}([^\\w]|$)`, 'i').test(`${p.cmd} ${p.path ?? ''}`));
  return { registered: hit ?? null, name: hit?.name ?? `(미등록) ${p.name.replace(/\.exe$/, '')}` };
}

const WRAPPER = /(?:-File\s+"?|^"?)([^"]*?[\\/](?:run-agent|Run-Stage|windows_launch|public-dashboard(?:-tunnel)?|start-[\w-]+|START_[\w]+)\.(?:ps1|cmd|vbs))/i;

function groupOf(p, ctx) {
  for (const rule of RULES) if (rule.test(p, ctx)) return rule;
  return null;
}

export function analyze({ inventory, slow = {}, fast = [], now = Date.now() }) {
  const procs = inventory?.procs ?? [];
  const byPid = new Map(procs.map((p) => [p.i, { ...p, name: lower(p.n), cmd: p.cmd ?? '' }]));
  const ports = new Map();
  for (const l of inventory?.ports ?? []) { if (!ports.has(l.port)) ports.set(l.port, new Set()); ports.get(l.port).add(l.pid); }
  const registry = slow.mcpRegistry ?? [];
  const tasks = slow.tasks ?? [];
  const ctx = { ports };
  const fastByPid = new Map(fast.map((f) => [f.pid, f]));
  const parentAlive = (p) => { const pp = byPid.get(p.pp); return Boolean(pp) && (!pp.st || !p.st || pp.st <= p.st); };

  // pass 1: direct rules; pass 2: inherit through the process tree for session-scoped tools
  const info = new Map();
  for (const p of byPid.values()) {
    const rule = groupOf(p, ctx);
    const mcp = rule ? null : mcpIdentity(p, registry);
    info.set(p.i, { rule, mcp });
  }
  const inherited = (pid, depth = 0) => {
    const p = byPid.get(pid);
    if (!p || depth > 8) return null;
    const own = info.get(pid)?.rule;
    if (own?.inherit) return own;
    return parentAlive(p) ? inherited(p.pp, depth + 1) : null;
  };

  const rows = [];
  for (const p of byPid.values()) {
    const { rule, mcp } = info.get(p.i);
    const inh = rule ? null : inherited(p.pp);
    const group = mcp ? { id: `mcp:${mcp.name}`, label: `MCP · ${mcp.name}`, category: 'mcp', role: 'on-demand' } : rule ?? (inh ? { ...inh, id: inh.id } : null);
    const key = group?.id ?? (p.name.replace(/\.exe$/, '') || 'unknown');
    const live = fastByPid.get(p.i);
    rows.push({
      pid: p.i, ppid: p.pp, name: p.name, group: key, label: group?.label ?? p.name.replace(/\.exe$/, ''), category: group?.category ?? 'other', role: group?.role ?? null,
      expected: Boolean(group?.expected), singleton: Boolean(group?.singleton), tracked: Boolean(group), mcp: mcp ? { name: mcp.name, registered: Boolean(mcp.registered) } : null,
      path: safePath(p.path), cmd: redactCommandLine(p.cmd), startedAt: p.st ?? null, parentAlive: parentAlive(p),
      ws: live?.ws ?? null, priv: live?.priv ?? null, cpu: live?.cpu ?? null, threads: live?.threads ?? null, _raw: p.cmd, _wrapper: (p.cmd.match(WRAPPER) ?? [])[1] ?? null,
    });
  }
  const rowByPid = new Map(rows.map((r) => [r.pid, r]));

  // launch attribution: a registered task whose script/exe appears in the process or an ancestor's command line
  const taskKey = (t) => lower((t.args?.match(/-File\s+"?([^"]+?\.(?:ps1|py|vbs|cmd))"?/i) ?? [])[1] ?? t.args?.replace(/"/g, '').split(/\s+/).find((a) => /\.(py|vbs|ps1|cmd)$/i.test(a)) ?? t.exe?.replace(/"/g, ''));
  // tasks that share one script (e.g. Run-Stage.ps1 -Mode P0/Backup/Watch) are told apart by their -Mode/-Role/-Name arguments
  const taskParams = (t) => [...(t.args ?? '').matchAll(/(?:^|\s)-(Mode|Role|Name)\s+"?([\w-]+)"?/gi)].map((m) => `-${m[1]} ${m[2]}`.toLowerCase());
  const taskKeys = tasks.map((t) => ({ t, key: taskKey(t), params: taskParams(t) })).filter((x) => x.key && x.key.length > 6);
  const taskMatches = (x, raw) => raw.includes(x.key) && x.params.every((q) => raw.replace(/\s+/g, ' ').includes(q));
  const servicePids = new Map((inventory?.services ?? []).filter((s) => s.pid).map((s) => [s.pid, s]));

  function launch(row) {
    for (let cur = row, depth = 0; cur && depth < 8; depth += 1) {
      const raw = lower(cur._raw ?? byPid.get(cur.pid)?.cmd ?? '');
      const hit = taskKeys.find((x) => taskMatches(x, raw));
      if (hit) return { method: 'task-scheduler', via: `${hit.t.path}${hit.t.name}`, condition: hit.t.trigger || null };
      const svc = servicePids.get(cur.pid);
      if (svc && depth === 0) return { method: 'windows-service', via: svc.name, condition: svc.start };
      const parent = cur.parentAlive ? rowByPid.get(cur.ppid) : null;
      if (parent && (parent.group === 'claude-code' || parent.group === 'codex-cli' || parent.group === 'hermes' || parent.category === 'ai')) return { method: `spawned-by:${parent.label}`, via: parent.label, condition: '부모 세션 시작 시' };
      if (!parent) break;
      cur = parent;
    }
    return { method: 'unknown', via: null, condition: null };
  }
  const launchByGroup = new Map();
  for (const r of rows) {
    if (!r.tracked) continue;
    const l = launch(r);
    r.launch = l;
    const prev = launchByGroup.get(r.group);
    if (!prev || (prev.method === 'unknown' && l.method !== 'unknown')) launchByGroup.set(r.group, l);
  }

  // groups
  const groups = new Map();
  for (const r of rows) {
    const g = groups.get(r.group) ?? { id: r.group, label: r.label, category: r.category, role: r.role, expected: r.expected, singleton: r.singleton, tracked: r.tracked, pids: [], n: 0, ws: 0, priv: 0, cpu: 0 };
    g.n += 1; g.pids.push(r.pid); g.ws += r.ws ?? 0; g.priv += r.priv ?? 0; g.cpu += r.cpu ?? 0;
    groups.set(r.group, g);
  }

  // flags (suspicions only — never conclusions)
  const flags = [];
  const mainOf = (g) => rows.filter((r) => r.group === g.id && !(r.parentAlive && rowByPid.get(r.ppid)?.group === g.id));
  for (const g of groups.values()) {
    if (g.singleton) {
      const mains = mainOf(g);
      if (mains.length > 1) flags.push({ kind: 'duplicate_suspect', subject: g.id, severity: 'warn', detail: `${g.label} 주 프로세스 ${mains.length}개 (PID ${mains.map((m) => m.pid).join(', ')}). 상시 단일 실행이어야 하는 서비스인지 확인 필요.` });
    }
  }
  const mcpRows = rows.filter((r) => r.mcp);
  const sameMcp = new Map();
  for (const r of mcpRows) { const k = `${r.mcp.name}|${r.ppid}|${r.cmd}`; sameMcp.set(k, (sameMcp.get(k) ?? []).concat(r)); }
  for (const list of sameMcp.values()) if (list.length > 1) flags.push({ kind: 'duplicate_suspect', subject: `mcp:${list[0].mcp.name}`, severity: 'warn', detail: `같은 부모(PID ${list[0].ppid})가 동일 MCP를 ${list.length}번 실행 중.` });
  for (const r of rows) {
    const ageMs = r.startedAt ? now - Date.parse(r.startedAt) : 0;
    if (!r.parentAlive && r.tracked && (r.role === 'on-demand') && ageMs > 3_600_000 && r.group !== 'claude-code') {
      flags.push({ kind: 'orphan_suspect', subject: `${r.group}#${r.pid}`, severity: 'info', detail: `부모 PID ${r.ppid} 종료됨, 시작 후 ${Math.round(ageMs / 3_600_000)}시간 경과 (${r.label}). 실제 사용 여부는 추가 확인 필요.` });
    }
  }
  const mcpByName = new Map();
  for (const r of mcpRows) mcpByName.set(r.mcp.name, (mcpByName.get(r.mcp.name) ?? new Set()).add(r.ppid));
  for (const [name, parents] of mcpByName) if (parents.size > 1) flags.push({ kind: 'parallel_instances', subject: `mcp:${name}`, severity: 'info', detail: `${parents.size}개의 서로 다른 부모 프로세스가 각자 MCP '${name}'를 실행 중 (stdio MCP는 부모별 실행이 정상 구조일 수 있음).` });

  // inventory items: running groups + registered MCP + scheduled tasks + services + startup entries, linked where provable
  const items = [];
  const gStatus = (g) => (g ? 'running' : 'not_running');
  for (const g of groups.values()) {
    if (!g.tracked) continue;
    const main = mainOf(g)[0] ?? rows.find((r) => r.group === g.id);
    const l = launchByGroup.get(g.id) ?? { method: 'unknown', via: null, condition: null };
    items.push({
      id: `proc:${g.id}`, name: g.label, category: g.category, ownerApplication: l.via ?? (main && rowByPid.get(main.ppid)?.label) ?? null, launchMethod: l.method, launchCondition: l.condition,
      processId: main?.pid ?? null, parentProcessId: main?.ppid ?? null, executablePath: main?.path ?? null, status: gStatus(g), memoryUsage: g.priv || null, workingSet: g.ws || null, cpuUsage: Math.round(g.cpu * 10) / 10,
      lastSeenAt: new Date(now).toISOString(), processCount: g.n, role: g.role, expected: g.expected, flags: flags.filter((f) => f.subject.startsWith(g.id)).map((f) => f.kind),
      notes: l.method === 'unknown' ? '실행 주체를 확인하지 못함' : '',
    });
  }
  for (const r of registry) {
    const running = mcpRows.filter((m) => m.mcp.registered === r || m.mcp.name === r.name);
    items.push({
      id: `mcp-reg:${r.app}:${r.name}`, name: r.name, category: 'mcp', ownerApplication: r.app, launchMethod: r.transport === 'http' ? 'remote-http' : 'stdio (부모 프로그램이 실행)', launchCondition: r.transport === 'http' ? `원격 연결 ${r.urlHost ?? ''}` : '부모 세션/서비스 시작 시',
      processId: running[0]?.pid ?? null, parentProcessId: running[0]?.ppid ?? null, executablePath: r.command, status: r.transport === 'http' ? 'remote' : running.length ? 'running' : 'registered_not_running',
      memoryUsage: running.reduce((a, m) => a + (m.priv ?? 0), 0) || null, cpuUsage: Math.round(running.reduce((a, m) => a + (m.cpu ?? 0), 0) * 10) / 10, lastSeenAt: running.length ? new Date(now).toISOString() : null,
      processCount: running.length, notes: `등록된 설정(${r.source}) ${r.enabled ? '' : '· 비활성'}`.trim(), flags: [],
    });
  }
  for (const x of taskKeys.concat(tasks.filter((t) => !taskKey(t) || taskKey(t).length <= 6).map((t) => ({ t, key: null, params: [] })))) {
    const { t, key } = x;
    const proc = key ? rows.find((r) => taskMatches(x, lower(byPid.get(r.pid)?.cmd))) : null;
    items.push({
      id: `task:${t.path}${t.name}`, name: `${t.path}${t.name}`, category: /hermes|mtos|localpc|chocomint|seminar|gravity/i.test(`${t.path}${t.name}`) ? 'scheduled' : 'vendor-scheduled', ownerApplication: 'Windows Task Scheduler', launchMethod: 'task-scheduler', launchCondition: t.trigger || null,
      processId: proc?.pid ?? null, parentProcessId: proc?.ppid ?? null, executablePath: safePath(t.exe), status: t.state === 'Disabled' ? 'disabled' : proc ? 'running' : String(t.state).toLowerCase(),
      memoryUsage: proc?.priv ?? null, cpuUsage: proc?.cpu ?? null, lastSeenAt: t.lastRun, lastResult: t.lastResult, nextRun: t.nextRun, processCount: proc ? 1 : 0, flags: [],
      notes: t.lastResult && ![0, 267009, 267011, 267014, 267010].includes(t.lastResult) ? `마지막 결과 코드 ${t.lastResult} (0x${(t.lastResult >>> 0).toString(16)})` : '',
    });
  }
  for (const s of inventory?.services ?? []) {
    items.push({
      id: `svc:${s.name}`, name: s.display || s.name, category: 'windows-service', ownerApplication: 'Windows Service', launchMethod: 'windows-service', launchCondition: s.start,
      processId: s.pid || null, parentProcessId: null, executablePath: safePath(s.path), status: String(s.state).toLowerCase(), memoryUsage: fastByPid.get(s.pid)?.priv ?? null, cpuUsage: fastByPid.get(s.pid)?.cpu ?? null,
      lastSeenAt: s.state === 'Running' ? new Date(now).toISOString() : null, processCount: s.pid ? 1 : 0, flags: [], notes: s.start === 'Auto' && s.state !== 'Running' ? '자동 시작이지만 현재 중지' : '',
    });
  }
  for (const s of slow.startup ?? []) {
    const exe = lower((s.cmd.match(/"?([^"]+?\.(?:exe|vbs|cmd|lnk))"?/i) ?? [])[1]).split(/[\\/]/).pop();
    const proc = exe ? rows.find((r) => r.name === exe) : null;
    items.push({
      id: `startup:${s.location}:${s.name}`, name: s.name, category: 'startup', ownerApplication: s.location, launchMethod: 'startup', launchCondition: '로그인/부팅 시', processId: proc?.pid ?? null, parentProcessId: proc?.ppid ?? null,
      executablePath: safePath(redactCommandLine(s.cmd, 160)), status: proc ? 'running' : 'not_running', memoryUsage: proc?.priv ?? null, cpuUsage: proc?.cpu ?? null, lastSeenAt: proc ? new Date(now).toISOString() : null, processCount: proc ? 1 : 0, flags: [], notes: '',
    });
  }

  return { rows, groups: [...groups.values()], flags, items };
}

/** Parent/child tree of tracked processes with their un-tracked ancestors collapsed to the nearest visible one. */
export function buildTree(rows, { limit = 400 } = {}) {
  const byPid = new Map(rows.map((r) => [r.pid, r]));
  const keep = new Set();
  for (const r of rows) if (r.tracked || r.mcp) { for (let c = r, i = 0; c && i < 6; i += 1) { keep.add(c.pid); c = c.parentAlive ? byPid.get(c.ppid) : null; } }
  const nodes = new Map();
  for (const pid of keep) {
    const r = byPid.get(pid);
    nodes.set(pid, { pid, name: r.name, label: r.tracked ? r.label : r.name, group: r.group, category: r.category, ws: r.ws, priv: r.priv, cpu: r.cpu, startedAt: r.startedAt, cmd: r.cmd, mcp: r.mcp, children: [] });
  }
  const roots = [];
  for (const pid of keep) {
    const r = byPid.get(pid);
    const parent = r.parentAlive && nodes.get(r.ppid);
    (parent ? parent.children : roots).push(nodes.get(pid));
  }
  const total = { n: 0 };
  const trim = (list) => list.filter(() => { total.n += 1; return total.n <= limit; }).map((n) => ({ ...n, children: trim(n.children) }));
  return trim(roots);
}
