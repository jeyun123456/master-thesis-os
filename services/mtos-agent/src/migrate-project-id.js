import { nowIso } from './db.js';

/**
 * One-time, idempotent project_id rename for agent memos and milestones
 * (default: dry run). Milestone history rows keep their original text; each
 * changed row is recorded in project_id_migrations so it can be reverted.
 */
export function migrateAgentProjectId(db, { from, to, apply = false }) {
  if (!from || !to || from === to) throw new Error('from and to must be different project ids');
  db.exec(`CREATE TABLE IF NOT EXISTS project_id_migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT, table_name TEXT NOT NULL, row_id TEXT NOT NULL, from_id TEXT NOT NULL, to_id TEXT NOT NULL,
    migrated_at TEXT NOT NULL, reverted_at TEXT
  )`);
  const result = { dryRun: !apply, memos: 0, milestones: 0 };
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const table of ['memos', 'milestones']) {
      const rows = db.prepare(`SELECT id FROM ${table} WHERE project_id = ?`).all(from);
      result[table] = rows.length;
      if (!apply) continue;
      const at = nowIso();
      for (const row of rows) {
        db.prepare(`UPDATE ${table} SET project_id = ? WHERE id = ?`).run(to, row.id);
        db.prepare('INSERT INTO project_id_migrations (table_name, row_id, from_id, to_id, migrated_at) VALUES (?,?,?,?,?)').run(table, row.id, from, to, at);
      }
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return result;
}

export function revertAgentProjectIdMigration(db, { from, to }) {
  let reverted = 0;
  db.exec('BEGIN IMMEDIATE');
  try {
    const rows = db.prepare('SELECT * FROM project_id_migrations WHERE from_id = ? AND to_id = ? AND reverted_at IS NULL').all(from, to);
    for (const row of rows) {
      if (!['memos', 'milestones'].includes(row.table_name)) continue;
      reverted += db.prepare(`UPDATE ${row.table_name} SET project_id = ? WHERE id = ? AND project_id = ?`).run(from, row.row_id, to).changes;
      db.prepare('UPDATE project_id_migrations SET reverted_at = ? WHERE id = ?').run(nowIso(), row.id);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return { reverted };
}
