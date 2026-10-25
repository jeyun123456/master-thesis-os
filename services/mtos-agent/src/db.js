import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// The agent DB is separate from the P0 SQLite file on purpose: P0 stays the
// only owner of tasks, and a broken agent/worker can never lock or corrupt it.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS memos (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('task','note','reference','archive')),
  body TEXT NOT NULL,
  source_url TEXT,
  obsidian_state TEXT NOT NULL DEFAULT 'none' CHECK (obsidian_state IN ('none','proposed','pending_retry','synced')),
  obsidian_path TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS memos_project ON memos(project_id, created_at);

CREATE TABLE IF NOT EXISTS milestones (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('planned','done','missed','cancelled')),
  kind TEXT NOT NULL CHECK (kind IN ('official','internal')),
  source TEXT NOT NULL DEFAULT '',
  evidence_url TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS milestones_project ON milestones(project_id, date);
CREATE TABLE IF NOT EXISTS milestone_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  milestone_id TEXT NOT NULL REFERENCES milestones(id),
  version INTEGER NOT NULL,
  actor TEXT NOT NULL,
  before TEXT NOT NULL,
  changes TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS inbox_items (
  id TEXT PRIMARY KEY,
  dedupe_key TEXT NOT NULL UNIQUE,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('manual','gmail','portal','link')),
  source_ref TEXT,
  source_url TEXT,
  raw_text TEXT NOT NULL,
  received_at TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'new' CHECK (state IN ('new','classifying','classified','auto_pending','applied','undone','duplicate','dismissed','failed')),
  classification TEXT,
  created_task_id TEXT,
  duplicate_of_task_id TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS inbox_state ON inbox_items(state, received_at);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  dedupe_key TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  priority INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('queued','running','done','failed','retry_wait','cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  next_run_at TEXT NOT NULL,
  lease_until TEXT,
  lease_owner TEXT,
  source TEXT NOT NULL,
  runner TEXT,
  model TEXT,
  input TEXT NOT NULL,
  result TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS jobs_ready ON jobs(state, priority, next_run_at);

CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('deadline_change','stage_change','milestone_add','obsidian_write','duplicate_merge','sync_conflict')),
  state TEXT NOT NULL CHECK (state IN ('pending','approved','rejected','applied','failed','stale')),
  title TEXT NOT NULL,
  payload TEXT NOT NULL,
  target_ref TEXT,
  target_version TEXT,
  official_deadline TEXT,
  blocks_today INTEGER NOT NULL DEFAULT 0,
  data_loss_risk INTEGER NOT NULL DEFAULT 0,
  source_ref TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  decided_at TEXT,
  applied_at TEXT
);
CREATE INDEX IF NOT EXISTS approvals_state ON approvals(state, created_at);
CREATE TABLE IF NOT EXISTS approval_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  approval_id TEXT NOT NULL REFERENCES approvals(id),
  event TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS task_meta (
  task_id TEXT PRIMARY KEY,
  parent_task_id TEXT,
  step_order INTEGER,
  ai_generated INTEGER NOT NULL DEFAULT 0,
  source_ref TEXT,
  blocked_reason TEXT,
  snooze_until TEXT,
  recur TEXT,
  series_id TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS task_meta_parent ON task_meta(parent_task_id);
CREATE TABLE IF NOT EXISTS block_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  event TEXT NOT NULL CHECK (event IN ('blocked','unblocked','snoozed','note')),
  reason TEXT NOT NULL DEFAULT '',
  until_date TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS occurrences (
  series_id TEXT NOT NULL,
  due_date TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('done','skipped','deferred')),
  task_id TEXT,
  deferred_to TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (series_id, due_date)
);

CREATE TABLE IF NOT EXISTS focus_recommendations (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  job_id TEXT,
  items TEXT NOT NULL,
  free_slots TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS focus_feedback (
  date TEXT NOT NULL,
  task_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('accepted','rejected')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (date, task_id)
);

CREATE TABLE IF NOT EXISTS collector_state (
  source TEXT PRIMARY KEY,
  last_checked_at TEXT,
  last_success_at TEXT,
  cursor TEXT,
  last_error TEXT
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
`;

export function openAgentDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('schema_version', '1')").run();
  return db;
}

export const nowIso = () => new Date().toISOString();

export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
