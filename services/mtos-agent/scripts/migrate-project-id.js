// Usage: node scripts/migrate-project-id.js --db <mtos-agent.db> --from thesis --to <project id> [--apply] [--revert]
// Dry run unless --apply. --apply first writes a consistent backup next to the DB (VACUUM INTO).
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { openAgentDb } from '../src/db.js';
import { migrateAgentProjectId, revertAgentProjectIdMigration } from '../src/migrate-project-id.js';

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const dbPath = opt('db');
const from = opt('from');
const to = opt('to');
if (!dbPath || !from || !to || !existsSync(dbPath)) { console.error('need an existing --db, --from and --to'); process.exit(2); }

const apply = args.includes('--apply');
if (apply) {
  const backup = `${dbPath}.before-project-id-${new Date().toISOString().replace(/[:.]/g, '-')}.bak`;
  const raw = new DatabaseSync(dbPath);
  raw.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
  raw.close();
  console.log('backup:', backup);
}
const db = openAgentDb(dbPath);
console.log(args.includes('--revert') ? revertAgentProjectIdMigration(db, { from, to }) : migrateAgentProjectId(db, { from, to, apply }));
db.close();
