import { spawn } from 'node:child_process';
import { cpus as osCpus, freemem as osFreemem, totalmem as osTotalmem } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyze, buildTree } from './classify.js';
import { redactCommandLine } from './redact.js';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'ops-collect.ps1');
const MAX_OUTPUT = 2 * 1024 * 1024;
const TIMEOUT_MS = 45_000;

/** Runs one read-only probe tier and parses its JSON. No shell; output is size- and time-limited. */
export function runProbe(tier, { spawnImpl = spawn } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, '-Tier', tier], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = [];
    let size = 0;
    let settled = false;
    const done = (fn, value) => { if (!settled) { settled = true; clearTimeout(timer); fn(value); } };
    const timer = setTimeout(() => { child.kill(); done(reject, new Error(`probe ${tier} timed out`)); }, TIMEOUT_MS);
    child.stdout.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_OUTPUT) { child.kill(); done(reject, new Error(`probe ${tier} output too large`)); return; }
      chunks.push(chunk);
    });
    child.on('error', (error) => done(reject, error));
    child.on('close', () => {
      try { done(resolve, JSON.parse(Buffer.concat(chunks).toString('utf8').replace(/^﻿/, ''))); } catch { done(reject, new Error(`probe ${tier} returned invalid JSON`)); }
    });
  });
}

const cpuTotals = (list) => list.reduce((a, c) => ({ idle: a.idle + c.times.idle, total: a.total + c.times.user + c.times.nice + c.times.sys + c.times.idle + c.times.irq }), { idle: 0, total: 0 });

export function createOpsCollector({ store, probe = runProbe, now = () => Date.now(), cpus = osCpus, freemem = osFreemem, totalmem = osTotalmem, lowMemBytes = 150 * 1024 * 1024, intervals = {}, log = () => {} }) {
  const every = { fast: 60_000, inventory: 5 * 60_000, slow: 30 * 60_000, ...intervals };
  const stat = { startedAt: now(), runs: 0, failures: 0, lastAt: null, lastMs: null, lastError: null, rssMb: null };
  const mem = { inventoryRaw: null, slow: store.state('slow')?.value ?? {}, fast: [], prevCpu: null, prevProc: new Map(), prevPresence: null, analysis: null, timers: [], stopped: false };
  mem.analysis = store.state('analysis')?.value ?? null;

  // Re-classifying is cheap and runs every tick; persisting the (large) snapshot only happens after a fresh inventory/config read.
  const reanalyze = ({ persist = false } = {}) => {
    if (!mem.inventoryRaw) return;
    const result = analyze({ inventory: mem.inventoryRaw, slow: mem.slow, fast: mem.fast, now: now() });
    const rows = result.rows.map(({ _raw, _wrapper, ...row }) => row);
    mem.analysis = { at: now(), groups: result.groups, flags: result.flags, items: result.items, rows, tree: buildTree(rows), tools: mem.slow.tools ?? null, mcpRegistry: mem.slow.mcpRegistry ?? [] };
    if (persist) store.setState('analysis', now(), mem.analysis);
  };

  // Under extreme memory pressure the PowerShell probe (~90MB) would make things worse, so only Node's own counters are recorded.
  function runLightFast() {
    const ts = now();
    const totals = cpuTotals(cpus());
    let cpu = null;
    if (mem.prevCpu) {
      const total = totals.total - mem.prevCpu.total;
      cpu = total > 0 ? Math.round((1 - (totals.idle - mem.prevCpu.idle) / total) * 1000) / 10 : null;
    }
    mem.prevCpu = { ...totals, ts };
    mem.prevProc = new Map();
    store.saveSample(ts, { cpu, memTotal: totalmem(), memAvail: freemem(), commitUsed: null, commitLimit: null, standby: null, modified: null, compressedWs: null, pagefileUsedMb: null, procCount: null, disks: [] }, []);
    store.addEvent(ts, 'probe_skipped_low_memory', 'collector', `available ${Math.round(freemem() / 1048576)}MB`);
  }

  async function runFast() {
    if (freemem() < lowMemBytes) { runLightFast(); return; }
    const s = await probe('fast');
    const ts = now();
    const list = cpus();
    const totals = cpuTotals(list);
    let cpu = null;
    if (mem.prevCpu) {
      const total = totals.total - mem.prevCpu.total;
      cpu = total > 0 ? Math.round((1 - (totals.idle - mem.prevCpu.idle) / total) * 1000) / 10 : null;
    }
    const wallSec = mem.prevCpu ? (ts - mem.prevCpu.ts) / 1000 : 0;
    mem.prevCpu = { ...totals, ts };

    const procs = (s.procs ?? []).map((p) => {
      const prev = mem.prevProc.get(p.i);
      const pct = prev && p.c !== null && wallSec > 0 && p.c >= prev ? Math.round(((p.c - prev) / wallSec / list.length) * 1000) / 10 : null;
      return { pid: p.i, name: String(p.n).toLowerCase() + '.exe', ws: p.w, priv: p.p, cpu: pct, threads: p.t, cpuSec: p.c };
    });
    mem.prevProc = new Map(procs.filter((p) => p.cpuSec !== null).map((p) => [p.pid, p.cpuSec]));
    mem.fast = procs;
    reanalyze();

    // aggregate by group (inventory classification, falling back to the process name)
    const groupOfPid = new Map((mem.analysis?.rows ?? []).map((r) => [r.pid, r.group]));
    const tracked = new Set((mem.analysis?.groups ?? []).filter((g) => g.tracked).map((g) => g.id));
    const agg = new Map();
    for (const p of procs) {
      const grp = groupOfPid.get(p.pid) ?? p.name.replace(/\.exe$/, '');
      const g = agg.get(grp) ?? { grp, n: 0, ws: 0, priv: 0, cpu: 0 };
      g.n += 1; g.ws += p.ws; g.priv += p.priv; g.cpu += p.cpu ?? 0;
      agg.set(grp, g);
    }
    const all = [...agg.values()];
    const topUntracked = all.filter((g) => !tracked.has(g.grp)).sort((a, b) => b.priv - a.priv).slice(0, 10);
    const keep = all.filter((g) => tracked.has(g.grp)).concat(topUntracked);

    // presence changes of tracked groups become events for correlating memory pressure with restarts
    const presence = new Set(all.filter((g) => tracked.has(g.grp)).map((g) => g.grp));
    if (mem.prevPresence) {
      for (const grp of presence) if (!mem.prevPresence.has(grp)) store.addEvent(ts, 'process_start', grp);
      for (const grp of mem.prevPresence) if (!presence.has(grp)) store.addEvent(ts, 'process_exit', grp);
    }
    mem.prevPresence = presence;

    const compressed = procs.find((p) => p.name === 'memory compression.exe')?.ws ?? null;
    store.saveSample(ts, {
      cpu, memTotal: s.mem.total, memAvail: s.mem.available, commitUsed: s.mem.committed, commitLimit: s.mem.commitLimit, standby: s.mem.standby, modified: s.mem.modified,
      compressedWs: compressed, pagefileUsedMb: s.mem.pagefileUsedMB, procCount: procs.length, disks: s.disks ?? [],
    }, keep);
    store.setState('boot', ts, { bootAt: s.bootAt, pagefileSizeMb: s.mem.pagefileSizeMB });
  }

  async function runInventory() {
    mem.inventoryRaw = await probe('inventory');
    reanalyze({ persist: true });
  }

  async function runSlow() {
    const slow = await probe('slow');
    slow.tasks = (slow.tasks ?? []).map((t) => ({ ...t, args: redactCommandLine(t.args ?? '', 400, { maskUser: false }), exe: redactCommandLine(t.exe ?? '', 200, { maskUser: false }) }));
    mem.slow = slow;
    store.setState('slow', now(), slow);
    reanalyze({ persist: true });
  }

  async function guarded(name, fn) {
    const started = now();
    try { await fn(); stat.lastError = null; } catch (error) { stat.failures += 1; stat.lastError = `${name}: ${error.message}`; log(`[ops] ${stat.lastError}`); }
    stat.runs += 1; stat.lastAt = now(); stat.lastMs = stat.lastAt - started; stat.rssMb = Math.round(process.memoryUsage().rss / 1048576);
    store.setState('collector', stat.lastAt, stat);
  }

  // sequential scheduler: each tier re-arms only after it finished, so runs can never overlap or pile up
  let chain = Promise.resolve();
  const enqueue = (name, fn) => { chain = chain.then(() => (mem.stopped ? undefined : guarded(name, fn))); return chain; };
  const loop = (name, ms, fn) => {
    const timer = setInterval(() => enqueue(name, fn), ms);
    timer.unref?.();
    mem.timers.push(timer);
  };

  return {
    stat: () => ({ ...stat, intervals: every }),
    analysis: () => mem.analysis,
    fastProcs: () => mem.fast,
    async start() {
      store.prune(now());
      await enqueue('slow', runSlow);
      await enqueue('inventory', runInventory);
      await enqueue('fast', runFast);
      loop('fast', every.fast, runFast);
      loop('inventory', every.inventory, runInventory);
      loop('slow', every.slow, runSlow);
      loop('prune', 6 * 3_600_000, async () => store.prune(now()));
    },
    /** Test hook / manual one-shot. */
    tick: { fast: () => enqueue('fast', runFast), inventory: () => enqueue('inventory', runInventory), slow: () => enqueue('slow', runSlow) },
    stop() { mem.stopped = true; for (const t of mem.timers) clearInterval(t); },
  };
}
