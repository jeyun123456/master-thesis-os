import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createOpsApi } from '../src/ops/api.js';
import { DEFAULT_SETTINGS, evaluateAlerts } from '../src/ops/alerts.js';
import { analyze } from '../src/ops/classify.js';
import { createOpsCollector } from '../src/ops/collector.js';
import { redactCommandLine } from '../src/ops/redact.js';
import { createOpsStore, openOpsDb, RAW_RETENTION_MS } from '../src/ops/store.js';

const MB = 1024 * 1024;

test('redaction masks credentials, URL secrets and user folder names', () => {
  const cases = [
    ['cloudflared.exe tunnel run --token-file C:\\a\\t.token', 'token-file ***'],
    ['node a.js --api-key=abcd1234 --password hunter2', '--api-key=*** --password ***'],
    ['curl https://u:pw@h.com/p?token=zz', 'https://***@h.com/p?***'],
    ['curl -H "Authorization: Bearer abcdefghijkl1234"', 'Bearer ***'],
    ['curl https://x.y/hook/AbCdEfGhIjKlMnOpQrStUvWxYz123', 'https://x.y/hook/***'],
    ['powershell -EncodedCommand aQBmACAAKAAkAGUAbgB2ADoATwBSAEMAQQBfAE8AUABFAE4A', '-EncodedCommand ***'],
    ['bash -c "source /c/Users/bob/.x.sh"', '/c/Users/~/.x.sh'],
    ['"C:\\Users\\bob\\bin\\x.exe" serve', 'C:\\Users\\~\\bin\\x.exe'],
  ];
  for (const [input, expected] of cases) {
    const out = redactCommandLine(input);
    assert.ok(out.includes(expected), `${input} -> ${out}`);
    assert.ok(!/hunter2|abcd1234|pw@|zz\b|abcdefghijkl1234|AbCdEfGhIj|bob/.test(out), out);
  }
  assert.ok(redactCommandLine('x'.repeat(500)).length <= 220);
});

const proc = (i, pp, n, cmd, st = '2026-10-20T00:00:00Z') => ({ i, pp, n, cmd, path: null, st });

test('classification distinguishes tasks, MCP parents, duplicates and orphans without guessing owners', () => {
  const inventory = {
    procs: [
      proc(1, 0, 'svchost.exe', ''),
      proc(10, 1, 'powershell.exe', 'powershell -File "C:\\x\\run-agent.ps1" -Role api'),
      proc(11, 10, 'node.exe', 'node C:\\x\\mtos-agent\\src\\server.js'),
      proc(12, 1, 'powershell.exe', 'powershell -File "C:\\x\\run-agent.ps1" -Role worker'),
      proc(13, 12, 'node.exe', 'node C:\\x\\mtos-agent\\src\\worker.js'),
      proc(14, 12, 'node.exe', 'node C:\\x\\mtos-agent\\src\\worker.js'),
      proc(20, 1, 'claude.exe', 'claude.exe'),
      proc(21, 20, 'node.exe', 'node C:\\m\\switchbot\\index.js mcp serve'),
      proc(22, 1, 'hermes.exe', 'hermes'),
      proc(23, 22, 'node.exe', 'node C:\\m\\switchbot\\index.js mcp serve'),
      proc(30, 999, 'python.exe', 'python -m browser_harness.daemon', '2026-10-01T00:00:00Z'),
      proc(40, 1, 'mystery.exe', 'mystery.exe'),
    ],
    ports: [], services: [],
  };
  const slow = {
    tasks: [
      { path: '\\', name: 'MTOS_Agent_API', state: 'Running', trigger: 'Boot', exe: 'powershell.exe', args: '-File "C:\\x\\run-agent.ps1" -Role api' },
      { path: '\\', name: 'MTOS_Agent_Worker', state: 'Running', trigger: 'Boot', exe: 'powershell.exe', args: '-File "C:\\x\\run-agent.ps1" -Role worker' },
    ],
    mcpRegistry: [{ name: 'switchbot', app: 'Hermes', transport: 'stdio', source: 'user', enabled: true }, { name: 'idle-mcp', app: 'Claude Code', transport: 'stdio', source: 'user', enabled: true }],
  };
  const { items, flags, rows } = analyze({ inventory, slow, fast: [], now: Date.parse('2026-10-26T00:00:00Z') });
  const item = (id) => items.find((i) => i.id === id);

  assert.equal(item('proc:mtos-agent-api').launchMethod, 'task-scheduler');
  assert.equal(item('proc:mtos-agent-api').ownerApplication, '\\MTOS_Agent_API');
  assert.equal(item('proc:mtos-agent-worker').ownerApplication, '\\MTOS_Agent_Worker');
  assert.ok(flags.some((f) => f.kind === 'duplicate_suspect' && f.subject === 'mtos-agent-worker'), 'two worker mains under one parent');
  assert.ok(!flags.some((f) => f.kind === 'duplicate_suspect' && f.subject === 'mtos-agent-api'));
  // stdio MCP under two different parents is parallel, not duplicate
  assert.ok(flags.some((f) => f.kind === 'parallel_instances' && f.subject === 'mcp:switchbot'));
  assert.ok(!flags.some((f) => f.kind === 'duplicate_suspect' && f.subject === 'mcp:switchbot'));
  // registered-but-not-running is reported as such, not as a service
  assert.equal(item('mcp-reg:Claude Code:idle-mcp').status, 'registered_not_running');
  assert.equal(item('mcp-reg:Hermes:switchbot').status, 'running');
  // orphan only suspected; unknown owner stays unknown
  assert.ok(flags.some((f) => f.kind === 'orphan_suspect' && f.subject === 'hermes-browser-harness#30'));
  assert.equal(item('proc:hermes-browser-harness').launchMethod, 'unknown');
  assert.equal(rows.find((r) => r.pid === 40).tracked, false);
});

const sample = (ts, availMb, commitPct, extra = {}) => ({ ts, mem_avail: availMb * MB, commit_used: commitPct, commit_limit: 100, disks: '[{"id":"C:","size":100,"free":50}]', ...extra });

test('alerts need sustained pressure, flag low disk, and treat expired sessions as paused not failed', () => {
  const now = 10_000_000;
  const steady = (availMb, commitPct) => Array.from({ length: 8 }, (_, i) => sample(now - (7 - i) * 60_000, availMb, commitPct));
  const base = { settings: DEFAULT_SETTINGS, now, intervalMs: 60_000 };

  let alerts = evaluateAlerts({ ...base, samples: steady(300, 95), latest: steady(300, 95).at(-1) });
  assert.deepEqual(alerts.map((a) => a.id).sort(), ['commit_high', 'low_available_ram']);

  const brief = steady(900, 50).map((s, i) => (i === 7 ? { ...s, mem_avail: 100 * MB } : s));
  alerts = evaluateAlerts({ ...base, samples: brief, latest: brief.at(-1) });
  assert.equal(alerts.length, 0, 'a single dip is not an alert');

  const lowDisk = { ...steady(900, 10).at(-1), disks: '[{"id":"C:","size":100,"free":5}]' };
  alerts = evaluateAlerts({ ...base, samples: steady(900, 10), latest: lowDisk });
  assert.equal(alerts[0].id, 'disk_low:C:');

  const iso = (min) => new Date(now - min * 60_000).toISOString();
  const school = {
    mail: { connected: true, session: 'ok', last_success_at: iso(20), last_checked_at: iso(1), last_error: null },
    notices: { connected: true, session: 'session_expired', last_success_at: iso(500), last_checked_at: iso(1), last_error: 'login' },
  };
  alerts = evaluateAlerts({ ...base, samples: steady(900, 10), latest: steady(900, 10).at(-1), school });
  assert.ok(alerts.some((a) => a.id === 'mail_stale'));
  assert.ok(alerts.some((a) => a.id === 'notices_paused' && a.severity === 'info'));
  assert.ok(!alerts.some((a) => a.id === 'notices_stale' || a.id === 'notices_failing'));

  alerts = evaluateAlerts({ ...base, samples: [], latest: null });
  assert.equal(alerts[0].id, 'ops_collector_stale');

  alerts = evaluateAlerts({ ...base, samples: steady(900, 10), latest: steady(900, 10).at(-1), items: [{ id: 'proc:p0-api', name: 'P0 API', expected: true, status: 'not_running', flags: [] }] });
  assert.equal(alerts[0].id, 'service_down:proc:p0-api');
});

const fakeProbe = (counter) => async (tier) => {
  if (tier === 'fast') return { tier, mem: { total: 8000 * MB, available: 400 * MB, committed: 30e9, commitLimit: 34e9, standby: 1, modified: 1, pagefileUsedMB: 1, pagefileSizeMB: 2 }, bootAt: '2026-10-01T00:00:00Z', disks: [{ id: 'C:', size: 100, free: 50 }], procs: [{ i: 11, n: 'node', w: 20 * MB, p: 30 * MB, c: counter.cpu, t: 8 }, { i: 40, n: 'mystery', w: 5 * MB, p: 6 * MB, c: 1, t: 1 }] };
  if (tier === 'inventory') return { tier, procs: [proc(11, 1, 'node.exe', 'node C:\\x\\mtos-agent\\src\\server.js --token abc123'), proc(40, 1, 'mystery.exe', 'mystery.exe')], ports: [], services: [] };
  return { tier, tasks: [], startup: [], mcpRegistry: [], serviceEvents: [], tools: { docker: false, wsl: false, pm2: false } };
};

function setup(env = { MTOS_OPS_ENABLED: '1' }) {
  const store = createOpsStore(openOpsDb(':memory:'));
  const counter = { cpu: 1 };
  const collector = createOpsCollector({ store, probe: fakeProbe(counter) });
  const agentDb = new DatabaseSync(':memory:');
  agentDb.exec("CREATE TABLE jobs (id TEXT, type TEXT, state TEXT, runner TEXT, model TEXT, error TEXT, created_at TEXT, started_at TEXT, finished_at TEXT); CREATE TABLE yolo_runs (id TEXT, mode TEXT, model TEXT, status TEXT, started_at TEXT, finished_at TEXT, error TEXT); CREATE TABLE meta (key TEXT, value TEXT); CREATE TABLE inbox_items (state TEXT);");
  const agentStore = { settings: { collector: () => ({ last_checked_at: null, last_success_at: null, cursor: null, last_error: null }) } };
  const api = createOpsApi({ opsStore: store, collector, agentDb, agentStore, env });
  const call = (path, { method = 'GET', headers = {}, query = '' } = {}) => api.handle({ req: { headers }, method, path, url: new URL(`http://x${path}${query}`), readBody: async () => ({}) });
  return { store, collector, api, call, counter };
}

test('collector stores samples, redacts command lines and exposes only read-only endpoints', async () => {
  const { store, collector, call, counter } = setup();
  await collector.tick.slow(); await collector.tick.inventory(); await collector.tick.fast();
  counter.cpu = 31;
  await collector.tick.fast();

  assert.equal(store.rowCounts().ops_samples >= 1, true);
  const [, overview] = await call('/ops/overview');
  assert.equal(overview.sample.memAvail, 400 * MB);
  assert.equal(overview.services.running, 1);
  const [, procs] = await call('/ops/processes', { query: '?q=mtos&sort=cpu' });
  assert.equal(procs.processes.length, 1);
  assert.ok(!/abc123/.test(JSON.stringify(procs)), 'token argument must be masked');
  assert.equal(procs.processes[0].group, 'mtos-agent-api');
  const [, trend] = await call('/ops/trend', { query: '?range=1h' });
  assert.ok(trend.system.length >= 1 && trend.groups.includes('mtos-agent-api'));

  for (const method of ['POST', 'DELETE', 'PATCH']) assert.equal((await call('/ops/processes', { method }))[0], 405);
  assert.equal((await call('/ops/kill'))[0], 404);
  collector.stop();
});

test('ops API is disabled by default, requires the admin secret and is rate limited', async () => {
  assert.equal((await setup({}).call('/ops/overview'))[0], 503);

  const guarded = setup({ MTOS_OPS_ENABLED: '1', MTOS_OPS_ADMIN_SECRET: 'correct-horse-battery' });
  assert.equal((await guarded.call('/ops/overview'))[0], 403);
  assert.equal((await guarded.call('/ops/overview', { headers: { 'x-ops-admin': 'wrong' } }))[0], 403);
  assert.equal((await guarded.call('/ops/overview', { headers: { 'x-ops-admin': 'correct-horse-battery' } }))[0], 200);

  const limited = setup();
  let last;
  for (let i = 0; i < 95; i += 1) last = (await limited.call('/ops/overview'))[0];
  assert.equal(last, 429);
});

test('settings accept only bounded numbers; retention rolls raw rows into aggregates', async () => {
  const { store, call, api } = setup();
  const put = (body) => api.handle({ req: { headers: {} }, method: 'PUT', path: '/ops/settings', url: new URL('http://x/ops/settings'), readBody: async () => body });
  assert.equal((await put({ minAvailRamMb: 800 }))[0], 200);
  assert.equal((await call('/ops/alerts'))[1].settings.minAvailRamMb, 800);
  await assert.rejects(put({ minAvailRamMb: -5 }));
  await assert.rejects(put({ nonsense: 1 }));

  const now = 100 * RAW_RETENTION_MS;
  const old = now - RAW_RETENTION_MS - 3_600_000;
  const s = { cpu: 10, memTotal: 8e9, memAvail: 1e9, commitUsed: 1, commitLimit: 2, standby: 0, modified: 0, compressedWs: 0, pagefileUsedMb: 0, procCount: 1, disks: [] };
  store.saveSample(old, s, [{ grp: 'g', n: 1, ws: 5, priv: 7 }]);
  store.saveSample(old + 60_000, { ...s, cpu: 30 }, [{ grp: 'g', n: 1, ws: 7, priv: 9 }]);
  store.saveSample(now - 60_000, s, []);
  store.prune(now);
  const counts = store.rowCounts();
  assert.equal(counts.ops_samples, 1);
  assert.equal(counts.ops_rollup_samples, 1);
  assert.equal(counts.ops_rollup_group, 1);
});

test('over HTTP: no session -> 401, valid session without admin secret -> 403, with secret -> 200; real agent schema works', async () => {
  const { createServer } = await import('node:http');
  const { AuthError } = await import('../src/auth.js');
  const { createAgentApp } = await import('../src/server.js');
  const { createStore } = await import('../src/store.js');
  const { freshDb } = await import('./helpers.js');
  const TOKEN = 'valid-session-token-0123456789';
  const db = freshDb();
  const opsStore = createOpsStore(openOpsDb(':memory:'));
  const counter = { cpu: 1 };
  const collector = createOpsCollector({ store: opsStore, probe: fakeProbe(counter) });
  await collector.tick.slow(); await collector.tick.inventory(); await collector.tick.fast();
  const ops = createOpsApi({ opsStore, collector, agentDb: db, agentStore: createStore(db), env: { MTOS_OPS_ENABLED: '1', MTOS_OPS_ADMIN_SECRET: 's3cret-value' } });
  const verifySession = async (token) => { if (token !== TOKEN) throw new AuthError('invalid session'); };
  const server = createServer(createAgentApp({ db, verifySession, ops, codexInfo: () => null }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/agent/api/ops`;
  const get = async (path, headers) => (await fetch(`${base}${path}`, { headers })).status;
  try {
    assert.equal(await get('/overview', {}), 401);
    assert.equal(await get('/overview', { authorization: 'Bearer wrong-token-wrong-token-wrong' }), 401);
    assert.equal(await get('/overview', { authorization: `Bearer ${TOKEN}` }), 403);
    const ok = { authorization: `Bearer ${TOKEN}`, 'x-ops-admin': 's3cret-value' };
    for (const path of ['/overview', '/processes', '/services', '/trend?range=24h', '/background?kind=mcp', '/ai', '/alerts', '/events']) assert.equal(await get(path, ok), 200, path);
  } finally { server.close(); collector.stop(); }
});
