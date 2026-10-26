import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// Ops metrics live in their own SQLite file next to the agent DB: the agent's
// production schema is never touched, and rollback is just deleting this file.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS ops_samples (
  ts INTEGER PRIMARY KEY,
  cpu REAL, mem_total INTEGER, mem_avail INTEGER, commit_used INTEGER, commit_limit INTEGER,
  standby INTEGER, modified INTEGER, compressed_ws INTEGER, pagefile_used_mb INTEGER, proc_count INTEGER, disks TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS ops_group (
  ts INTEGER NOT NULL, grp TEXT NOT NULL, n INTEGER NOT NULL, ws INTEGER NOT NULL, priv INTEGER NOT NULL, cpu REAL,
  PRIMARY KEY (ts, grp)
);
CREATE INDEX IF NOT EXISTS ops_group_grp ON ops_group(grp, ts);
CREATE TABLE IF NOT EXISTS ops_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, kind TEXT NOT NULL, subject TEXT NOT NULL, detail TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ops_events_ts ON ops_events(ts);
CREATE TABLE IF NOT EXISTS ops_state (key TEXT PRIMARY KEY, ts INTEGER NOT NULL, json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ops_rollup_samples (
  bucket INTEGER PRIMARY KEY, n INTEGER NOT NULL, cpu_avg REAL, cpu_max REAL, avail_min INTEGER, avail_avg INTEGER, commit_max INTEGER, commit_limit INTEGER, mem_total INTEGER
);
CREATE TABLE IF NOT EXISTS ops_rollup_group (
  bucket INTEGER NOT NULL, grp TEXT NOT NULL, n INTEGER NOT NULL, ws_avg INTEGER, ws_max INTEGER, priv_avg INTEGER, priv_max INTEGER,
  PRIMARY KEY (bucket, grp)
);
`;

export const RAW_RETENTION_MS = 7 * 86_400_000;
export const ROLLUP_RETENTION_MS = 30 * 86_400_000;
export const ROLLUP_BUCKET_MS = 15 * 60_000;

export function openOpsDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 3000;');
  db.exec(SCHEMA);
  return db;
}

export function createOpsStore(db) {
  const insSample = db.prepare('INSERT OR REPLACE INTO ops_samples (ts,cpu,mem_total,mem_avail,commit_used,commit_limit,standby,modified,compressed_ws,pagefile_used_mb,proc_count,disks) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
  const insGroup = db.prepare('INSERT OR REPLACE INTO ops_group (ts,grp,n,ws,priv,cpu) VALUES (?,?,?,?,?,?)');
  const insEvent = db.prepare('INSERT INTO ops_events (ts,kind,subject,detail) VALUES (?,?,?,?)');
  const putState = db.prepare('INSERT INTO ops_state (key,ts,json) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET ts = excluded.ts, json = excluded.json');
  const getState = db.prepare('SELECT ts, json FROM ops_state WHERE key = ?');

  const tx = (fn) => { db.exec('BEGIN'); try { fn(); db.exec('COMMIT'); } catch (error) { db.exec('ROLLBACK'); throw error; } };

  return {
    saveSample(ts, s, groups) {
      tx(() => {
        insSample.run(ts, s.cpu, s.memTotal, s.memAvail, s.commitUsed, s.commitLimit, s.standby, s.modified, s.compressedWs, s.pagefileUsedMb, s.procCount, JSON.stringify(s.disks));
        for (const g of groups) insGroup.run(ts, g.grp, g.n, g.ws, g.priv, g.cpu ?? null);
      });
    },
    addEvent(ts, kind, subject, detail = '') { insEvent.run(ts, kind, String(subject).slice(0, 120), String(detail).slice(0, 300)); },
    setState(key, ts, value) { putState.run(key, ts, JSON.stringify(value)); },
    state(key) { const row = getState.get(key); return row ? { ts: row.ts, value: JSON.parse(row.json) } : null; },
    latestSample() { return db.prepare('SELECT * FROM ops_samples ORDER BY ts DESC LIMIT 1').get() ?? null; },
    samplesSince(since) { return db.prepare('SELECT * FROM ops_samples WHERE ts >= ? ORDER BY ts').all(since); },
    rollupSamplesSince(since) { return db.prepare('SELECT * FROM ops_rollup_samples WHERE bucket >= ? ORDER BY bucket').all(since); },
    groupSince(since, groups) {
      const marks = groups.map(() => '?').join(',');
      return db.prepare(`SELECT ts, grp, n, ws, priv FROM ops_group WHERE ts >= ? AND grp IN (${marks}) ORDER BY ts`).all(since, ...groups);
    },
    rollupGroupSince(since, groups) {
      const marks = groups.map(() => '?').join(',');
      return db.prepare(`SELECT bucket AS ts, grp, n, ws_avg AS ws, priv_avg AS priv FROM ops_rollup_group WHERE bucket >= ? AND grp IN (${marks}) ORDER BY bucket`).all(since, ...groups);
    },
    eventsSince(since, limit = 200) { return db.prepare('SELECT ts, kind, subject, detail FROM ops_events WHERE ts >= ? ORDER BY ts DESC LIMIT ?').all(since, limit); },
    rowCounts() {
      return Object.fromEntries(['ops_samples', 'ops_group', 'ops_events', 'ops_rollup_samples', 'ops_rollup_group'].map((t) => [t, db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n]));
    },

    /** Raw rows older than 7 days become 15-minute aggregates (kept 30 days); then the raw rows are dropped. */
    prune(now) {
      const rawCut = now - RAW_RETENTION_MS;
      tx(() => {
        db.prepare(`INSERT OR REPLACE INTO ops_rollup_samples
          SELECT (ts / ${ROLLUP_BUCKET_MS}) * ${ROLLUP_BUCKET_MS} b, COUNT(*), AVG(cpu), MAX(cpu), MIN(mem_avail), CAST(AVG(mem_avail) AS INTEGER), MAX(commit_used), MAX(commit_limit), MAX(mem_total)
          FROM ops_samples WHERE ts < ? GROUP BY b`).run(rawCut);
        db.prepare(`INSERT OR REPLACE INTO ops_rollup_group
          SELECT (ts / ${ROLLUP_BUCKET_MS}) * ${ROLLUP_BUCKET_MS} b, grp, COUNT(*), CAST(AVG(ws) AS INTEGER), MAX(ws), CAST(AVG(priv) AS INTEGER), MAX(priv)
          FROM ops_group WHERE ts < ? GROUP BY b, grp`).run(rawCut);
        db.prepare('DELETE FROM ops_samples WHERE ts < ?').run(rawCut);
        db.prepare('DELETE FROM ops_group WHERE ts < ?').run(rawCut);
        db.prepare('DELETE FROM ops_events WHERE ts < ?').run(now - ROLLUP_RETENTION_MS);
        db.prepare('DELETE FROM ops_rollup_samples WHERE bucket < ?').run(now - ROLLUP_RETENTION_MS);
        db.prepare('DELETE FROM ops_rollup_group WHERE bucket < ?').run(now - ROLLUP_RETENTION_MS);
      });
    },
  };
}
