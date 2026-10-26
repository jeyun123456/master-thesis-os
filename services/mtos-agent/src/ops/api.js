import { createHash, timingSafeEqual } from 'node:crypto';
import { DEFAULT_SETTINGS, SETTING_BOUNDS, evaluateAlerts, settingsFromEnv } from './alerts.js';
import { ValidationError } from '../validate.js';

const RANGES = { '1h': 3_600_000, '24h': 86_400_000, '7d': 7 * 86_400_000 };
const MAX_POINTS = 240;
const RATE_LIMIT = { windowMs: 60_000, max: 90 };
const PUBLIC_ROW = ({ pid, ppid, name, group, label, category, role, path, cmd, startedAt, parentAlive, ws, priv, cpu, threads, mcp }) => ({ pid, ppid, name, group, label, category, role, path, cmd, startedAt, parentAlive, ws, priv, cpu, threads, mcp });

class OpsError extends Error { constructor(status, message) { super(message); this.status = status; } }

const sameSecret = (a, b) => {
  const ha = createHash('sha256').update(String(a)).digest();
  const hb = createHash('sha256').update(String(b)).digest();
  return timingSafeEqual(ha, hb);
};

function downsample(rows, keyOf, valueKeys, maxPoints = MAX_POINTS) {
  if (rows.length <= maxPoints) return rows;
  const span = rows[rows.length - 1].ts - rows[0].ts || 1;
  const size = Math.ceil(span / maxPoints);
  const buckets = new Map();
  for (const row of rows) {
    const key = `${keyOf(row)}|${Math.floor((row.ts - rows[0].ts) / size)}`;
    const acc = buckets.get(key) ?? { ...row, _n: 0, _sum: Object.fromEntries(valueKeys.map((k) => [k, 0])) };
    acc._n += 1;
    for (const k of valueKeys) acc._sum[k] += row[k] ?? 0;
    buckets.set(key, acc);
  }
  return [...buckets.values()].map((b) => { const out = { ...b }; for (const k of valueKeys) out[k] = Math.round(b._sum[k] / b._n * 10) / 10; delete out._n; delete out._sum; return out; });
}

/**
 * Read-only server-ops endpoints. Disabled unless MTOS_OPS_ENABLED=1; when MTOS_OPS_ADMIN_SECRET is set a matching
 * x-ops-admin header is required on top of the P0 session (the web proxy adds it server-side, so a stolen browser
 * cookie alone cannot read this data). There is deliberately no endpoint that executes, kills or restarts anything.
 */
export function createOpsApi({ opsStore, collector, agentDb, agentStore, env = process.env, now = () => Date.now() }) {
  const hits = [];
  const settingsNow = () => ({ ...settingsFromEnv(env), ...(opsStore.state('settings')?.value ?? {}) });

  const gate = (req) => {
    if (env.MTOS_OPS_ENABLED !== '1') throw new OpsError(503, '서버 관리 기능이 비활성화되어 있어 (MTOS_OPS_ENABLED).');
    const secret = env.MTOS_OPS_ADMIN_SECRET;
    if (secret && !sameSecret(req.headers['x-ops-admin'] ?? '', secret)) throw new OpsError(403, '관리자 권한이 필요해.');
    const t = now();
    while (hits.length && hits[0] < t - RATE_LIMIT.windowMs) hits.shift();
    if (hits.length >= RATE_LIMIT.max) throw new OpsError(429, '요청이 너무 잦아. 잠시 후 다시 시도해줘.');
    hits.push(t);
  };

  const school = () => {
    const cursor = (v) => { try { return JSON.parse(v ?? '{}') ?? {}; } catch { return {}; } };
    const source = (key) => {
      const s = agentStore.settings.collector(key);
      const c = cursor(s.cursor);
      return { last_checked_at: s.last_checked_at, last_success_at: s.last_success_at, last_error: s.last_error ? String(s.last_error).slice(0, 200) : null, connected: Boolean(c.initialized_at), session: c.session ?? null, pending: c.pending ?? 0 };
    };
    return { mail: source('school_mail'), notices: source('school_notices') };
  };

  const currentAlerts = () => {
    const t = now();
    const settings = settingsNow();
    const analysis = collector.analysis();
    const fresh = analysis && t - analysis.at < 20 * 60_000;
    return evaluateAlerts({
      samples: opsStore.samplesSince(t - 130 * 60_000), latest: opsStore.latestSample(), settings, items: fresh ? analysis.items : [],
      school: school(), collectorStat: collector.stat(), intervalMs: collector.stat().intervals.fast, now: t,
    });
  };

  const overview = () => {
    const s = opsStore.latestSample();
    const boot = opsStore.state('boot')?.value;
    const analysis = collector.analysis();
    const expected = (analysis?.items ?? []).filter((i) => i.id.startsWith('proc:') && i.expected);
    const alerts = currentAlerts();
    return {
      now: now(), stale: !s || now() - s.ts > 3 * collector.stat().intervals.fast,
      sample: s && {
        ts: s.ts, cpu: s.cpu, memTotal: s.mem_total, memAvail: s.mem_avail, memUsedPct: Math.round((1 - s.mem_avail / s.mem_total) * 1000) / 10, commitUsed: s.commit_used, commitLimit: s.commit_limit,
        commitPct: s.commit_limit ? Math.round((s.commit_used / s.commit_limit) * 1000) / 10 : null, standby: s.standby, modified: s.modified, compressedWs: s.compressed_ws, pagefileUsedMb: s.pagefile_used_mb, pagefileSizeMb: boot?.pagefileSizeMb ?? null,
        procCount: s.proc_count, disks: JSON.parse(s.disks).map((d) => ({ ...d, freePct: d.size ? Math.round((d.free / d.size) * 1000) / 10 : null })),
      },
      bootAt: boot?.bootAt ?? null, uptimeSec: boot?.bootAt ? Math.round((now() - Date.parse(boot.bootAt)) / 1000) : null,
      services: { expected: expected.length, running: expected.filter((i) => i.status === 'running').length, down: expected.filter((i) => i.status !== 'running').map((i) => i.name) },
      alerts: { crit: alerts.filter((a) => a.severity === 'crit').length, warn: alerts.filter((a) => a.severity === 'warn').length, info: alerts.filter((a) => a.severity === 'info').length },
      collector: { ...collector.stat(), inventoryAt: analysis?.at ?? null, rows: opsStore.rowCounts() },
    };
  };

  const processes = (url) => {
    const sort = ['mem', 'cpu', 'name', 'pid'].includes(url.searchParams.get('sort')) ? url.searchParams.get('sort') : 'mem';
    const q = (url.searchParams.get('q') ?? '').toLowerCase().slice(0, 60);
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 100, 1), 200);
    const analysis = collector.analysis();
    const live = new Map(collector.fastProcs().map((p) => [p.pid, p]));
    let rows = (analysis?.rows ?? []).map((r) => ({ ...PUBLIC_ROW(r), ...(live.has(r.pid) ? { ws: live.get(r.pid).ws, priv: live.get(r.pid).priv, cpu: live.get(r.pid).cpu, threads: live.get(r.pid).threads } : {}) }));
    if (q) rows = rows.filter((r) => `${r.name} ${r.label} ${r.pid} ${r.group}`.toLowerCase().includes(q));
    const by = { mem: (a, b) => (b.priv ?? 0) - (a.priv ?? 0), cpu: (a, b) => (b.cpu ?? 0) - (a.cpu ?? 0), name: (a, b) => a.name.localeCompare(b.name), pid: (a, b) => a.pid - b.pid }[sort];
    const groups = (analysis?.groups ?? []).filter((g) => !q || `${g.id} ${g.label}`.toLowerCase().includes(q)).map(({ id, label, category, role, expected, tracked, n, ws, priv, cpu }) => ({ id, label, category, role, expected, tracked, n, ws, priv, cpu: Math.round(cpu * 10) / 10 }));
    groups.sort((a, b) => b.priv - a.priv);
    return { inventoryAt: analysis?.at ?? null, total: rows.length, processes: rows.sort(by).slice(0, limit), groups: groups.slice(0, 60), note: 'Working Set은 공유 메모리를 포함하므로 합산값이 실제 물리 메모리 사용량과 같지 않음. 종료/재시작 기능은 제공하지 않음.' };
  };

  const services = () => {
    const analysis = collector.analysis();
    const events = opsStore.eventsSince(now() - RANGES['7d'], 500);
    const winEvents = (opsStore.state('slow')?.value?.serviceEvents ?? []).slice(0, 10);
    const list = (analysis?.items ?? []).filter((i) => i.id.startsWith('proc:') && ['server', 'collector', 'ai'].includes(i.category) && (i.expected || i.status === 'running' || i.category === 'server')).map((i) => {
      const grp = i.id.slice(5);
      const starts = events.filter((e) => e.subject === grp && e.kind === 'process_start').length;
      const main = (analysis.rows ?? []).filter((r) => r.group === grp).sort((a, b) => Date.parse(a.startedAt ?? 0) - Date.parse(b.startedAt ?? 0))[0];
      return { id: i.id, name: i.name, category: i.category, role: i.role, expected: i.expected, status: i.status, pid: i.processId, processCount: i.processCount, memory: i.memoryUsage, workingSet: i.workingSet, cpu: i.cpuUsage, startedAt: main?.startedAt ?? null, launchMethod: i.launchMethod, via: i.ownerApplication, restartsObserved7d: starts, flags: i.flags };
    });
    const sc = school();
    const jobs = ['collect_school_mail', 'collect_school_notices'].map((type) => agentDb.prepare("SELECT type, state, finished_at, error FROM jobs WHERE type = ? ORDER BY COALESCE(finished_at, started_at, created_at) DESC LIMIT 1").get(type)).filter(Boolean);
    const lastError = (name) => jobs.find((j) => j.type === name && j.error)?.error?.slice(0, 160) ?? null;
    return {
      services: list, windowsServiceErrors: winEvents,
      logical: [
        { name: 'P0 API', port: 8787, from: 'p0-api' }, { name: 'MTOS Agent API', port: 8789, from: 'mtos-agent-api' }, { name: 'MTOS Worker', from: 'mtos-agent-worker' }, { name: 'Cloudflare Tunnel (P0)', from: 'cloudflared-p0' }, { name: 'Thunderbird', from: 'thunderbird' },
      ].map((l) => ({ ...l, status: list.find((s) => s.id === `proc:${l.from}`)?.status ?? 'not_running' })),
      collectors: [
        { name: '학교 메일 수집기', ...sc.mail, lastJobError: lastError('collect_school_mail') },
        { name: '학교 공지 수집기', ...sc.notices, lastJobError: lastError('collect_school_notices') },
      ],
      codexRuns: agentDb.prepare("SELECT type, state, model, started_at, finished_at FROM jobs WHERE runner IS NOT NULL ORDER BY COALESCE(started_at, created_at) DESC LIMIT 8").all(),
    };
  };

  const trend = (url) => {
    const range = RANGES[url.searchParams.get('range')] ? url.searchParams.get('range') : '1h';
    const t = now();
    const since = t - RANGES[range];
    const analysis = collector.analysis();
    const defaults = (analysis?.groups ?? []).filter((g) => g.tracked || g.priv > 0).sort((a, b) => b.priv - a.priv).slice(0, 8).map((g) => g.id);
    const wanted = (url.searchParams.get('groups') ?? '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 12);
    const groups = wanted.length ? wanted : defaults;
    const raw = opsStore.samplesSince(since);
    const rawFrom = raw[0]?.ts ?? t;
    const old = rawFrom > since ? opsStore.rollupSamplesSince(since).filter((r) => r.bucket < rawFrom) : [];
    const system = old.map((r) => ({ ts: r.bucket, cpu: r.cpu_avg, memAvail: r.avail_avg, memTotal: r.mem_total, commitUsed: r.commit_max, commitLimit: r.commit_limit, diskFreePct: null }))
      .concat(raw.map((s) => ({ ts: s.ts, cpu: s.cpu, memAvail: s.mem_avail, memTotal: s.mem_total, commitUsed: s.commit_used, commitLimit: s.commit_limit, diskFreePct: (() => { const d = JSON.parse(s.disks); return d.length ? Math.min(...d.map((x) => (x.size ? (x.free / x.size) * 100 : 100))) : null; })() })));
    const disks = raw.length ? raw.map((s) => ({ ts: s.ts, disks: JSON.parse(s.disks) })) : [];
    const gRaw = groups.length ? opsStore.groupSince(since, groups) : [];
    const gOld = groups.length && rawFrom > since ? opsStore.rollupGroupSince(since, groups).filter((r) => r.ts < rawFrom) : [];
    return {
      range, since, until: t, groups,
      system: downsample(system, () => 'sys', ['cpu', 'memAvail', 'commitUsed', 'diskFreePct']),
      diskSeries: downsample(disks.map((d) => ({ ts: d.ts, ...Object.fromEntries(d.disks.map((x) => [x.id, x.size ? (x.free / x.size) * 100 : null])) })), () => 'd', [...new Set(disks.flatMap((d) => d.disks.map((x) => x.id)))]),
      groupSeries: downsample(gOld.concat(gRaw), (r) => r.grp, ['ws', 'priv', 'n']),
      note: '수집되지 않은 시간대는 채우지 않음.',
    };
  };

  const background = (url) => {
    const analysis = collector.analysis();
    const kind = url.searchParams.get('kind') ?? 'all';
    const status = url.searchParams.get('status');
    const minMb = Number(url.searchParams.get('minMb')) || 0;
    const q = (url.searchParams.get('q') ?? '').toLowerCase().slice(0, 60);
    const kinds = {
      mcp: (i) => i.category === 'mcp', ai: (i) => i.category === 'ai' || /spawned-by/.test(i.launchMethod ?? ''), server: (i) => ['server', 'collector'].includes(i.category), scheduled: (i) => i.category === 'scheduled' || i.category === 'vendor-scheduled',
      startup: (i) => i.category === 'startup', service: (i) => i.category === 'windows-service', background: (i) => ['app', 'other'].includes(i.category),
    };
    let list = analysis?.items ?? [];
    if (kinds[kind]) list = list.filter(kinds[kind]);
    if (status) list = list.filter((i) => i.status === status);
    if (minMb) list = list.filter((i) => (i.memoryUsage ?? 0) >= minMb * 1048576);
    if (q) list = list.filter((i) => `${i.name} ${i.ownerApplication} ${i.executablePath}`.toLowerCase().includes(q));
    const all = analysis?.items ?? [];
    const reg = all.filter((i) => i.id.startsWith('mcp-reg:'));
    return {
      inventoryAt: analysis?.at ?? null, total: list.length, items: list.sort((a, b) => (b.memoryUsage ?? 0) - (a.memoryUsage ?? 0)).slice(0, 300),
      counts: { registeredMcp: reg.length, runningMcp: reg.filter((i) => i.status === 'running').length, runningMcpProcesses: (analysis?.rows ?? []).filter((r) => r.mcp).length, tasks: all.filter((i) => i.id.startsWith('task:')).length, startup: all.filter((i) => i.category === 'startup').length },
      flags: analysis?.flags ?? [], tree: analysis?.tree ?? [], tools: analysis?.tools ?? null,
    };
  };

  const ai = () => {
    const status = school();
    const queue = Object.fromEntries(agentDb.prepare('SELECT state, COUNT(*) n FROM jobs GROUP BY state').all().map((r) => [r.state, r.n]));
    const lastYolo = agentDb.prepare('SELECT id, mode, model, status, started_at, finished_at, error FROM yolo_runs ORDER BY started_at DESC LIMIT 1').get() ?? null;
    const recentYolo = agentDb.prepare('SELECT status, COUNT(*) n FROM (SELECT status FROM yolo_runs ORDER BY started_at DESC LIMIT 20) GROUP BY status').all();
    const lastByType = agentDb.prepare("SELECT type, state, runner, model, finished_at, error FROM jobs j WHERE id = (SELECT id FROM jobs WHERE type = j.type ORDER BY COALESCE(finished_at, started_at, created_at) DESC LIMIT 1) ORDER BY type").all()
      .map((j) => ({ ...j, error: j.error ? String(j.error).slice(0, 160) : null }));
    const heartbeat = agentDb.prepare("SELECT value FROM meta WHERE key = 'worker_heartbeat'").get()?.value;
    const pending = agentDb.prepare("SELECT COUNT(*) n FROM inbox_items WHERE state IN ('new','classifying','auto_pending')").get().n;
    return { school: status, queue, pendingInbox: pending, workerHeartbeat: heartbeat ? JSON.parse(heartbeat) : null, lastYolo: lastYolo && { ...lastYolo, error: lastYolo.error ? String(lastYolo.error).slice(0, 160) : null }, recentYolo, jobsByType: lastByType };
  };

  const events = (url) => {
    const range = RANGES[url.searchParams.get('range')] ? url.searchParams.get('range') : '24h';
    const since = now() - RANGES[range];
    const jobs = agentDb.prepare("SELECT type, state, started_at, finished_at FROM jobs WHERE started_at IS NOT NULL AND started_at >= ? ORDER BY started_at DESC LIMIT 200").all(new Date(since).toISOString());
    const yolo = agentDb.prepare('SELECT mode, status, started_at, finished_at FROM yolo_runs WHERE started_at >= ? ORDER BY started_at DESC LIMIT 50').all(new Date(since).toISOString());
    return { since, events: opsStore.eventsSince(since, 200), jobs, yolo };
  };

  const updateSettings = (body) => {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ValidationError('settings must be an object');
    const next = { ...settingsNow() };
    for (const [k, v] of Object.entries(body)) {
      if (!(k in SETTING_BOUNDS)) throw new ValidationError(`unknown setting: ${k}`);
      const [lo, hi] = SETTING_BOUNDS[k];
      if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) throw new ValidationError(`${k} must be a number between ${lo} and ${hi}`);
      next[k] = v;
    }
    opsStore.setState('settings', now(), next);
    return next;
  };

  /** Returns [status, payload] for /ops/* paths, or null for anything else. */
  return {
    handles: (path) => path === '/ops' || path.startsWith('/ops/'),
    async handle({ req, method, path, url, readBody }) {
      try { gate(req); } catch (error) { if (error instanceof OpsError) return [error.status, { error: error.message }]; throw error; }
      if (method === 'GET') {
        switch (path) {
          case '/ops/overview': return [200, overview()];
          case '/ops/processes': return [200, processes(url)];
          case '/ops/services': return [200, services()];
          case '/ops/trend': return [200, trend(url)];
          case '/ops/background': return [200, background(url)];
          case '/ops/ai': return [200, ai()];
          case '/ops/alerts': return [200, { alerts: currentAlerts(), settings: settingsNow(), defaults: DEFAULT_SETTINGS, bounds: SETTING_BOUNDS }];
          case '/ops/events': return [200, events(url)];
          default: return [404, { error: 'not found' }];
        }
      }
      if (method === 'PUT' && path === '/ops/settings') return [200, { settings: updateSettings(await readBody()) }];
      return [405, { error: 'read-only endpoint' }];
    },
  };
}
