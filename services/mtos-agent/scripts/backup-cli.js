#!/usr/bin/env node
// Operator CLI for the agent DB. Restore is never exposed over HTTP.
//   node scripts/backup-cli.js backup
//   node scripts/backup-cli.js verify <absolute-file>
//   node scripts/backup-cli.js restore-full <absolute-file>
// Env: absolute MTOS_AGENT_DB_PATH and MTOS_BACKUP_DIR, and MTOS_BACKUP_KEY (the P0 key).
import { connect } from 'node:net';
import { isAbsolute, resolve } from 'node:path';
import { createAgentBackup, openAgentBackup, parseKey, restoreAgentFull, syncSourceFiles } from '../src/backup.js';
import { openAgentDb } from '../src/db.js';

function absoluteEnv(name) {
  const value = process.env[name]?.trim();
  if (!value || !isAbsolute(value)) throw new Error(`${name} must be an absolute path`);
  return resolve(value);
}

async function assertAgentStopped() {
  const port = Number(process.env.MTOS_AGENT_PORT || 8789);
  await new Promise((done, fail) => {
    const socket = connect({ host: '127.0.0.1', port });
    socket.setTimeout(1000, () => { socket.destroy(); fail(new Error('could not confirm the agent is stopped')); });
    socket.once('connect', () => { socket.destroy(); fail(new Error(`agent still listening on ${port}; stop the agent and worker first`)); });
    socket.once('error', (error) => (error.code === 'ECONNREFUSED' ? done() : fail(error)));
  });
}

const [command, file] = process.argv.slice(2);
const key = parseKey(process.env.MTOS_BACKUP_KEY);
const backupDir = absoluteEnv('MTOS_BACKUP_DIR');
const dbPath = absoluteEnv('MTOS_AGENT_DB_PATH');

if (command === 'backup') {
  const db = openAgentDb(dbPath);
  try { console.log(await createAgentBackup(db, { outDir: backupDir, key })); } finally { db.close(); }
  // Originals of collected school mail/notices live outside the DB; mirror them next to the backups.
  if (process.env.MTOS_SOURCE_FILES_DIR) console.log(`source files copied: ${syncSourceFiles(absoluteEnv('MTOS_SOURCE_FILES_DIR'), resolve(backupDir, 'sources'))}`);
} else if (command === 'verify' && file && isAbsolute(file)) {
  const { path, cleanup } = openAgentBackup(file, key);
  cleanup();
  console.log(`ok: ${file} decrypts and passes integrity_check (${path ? 'verified' : ''})`);
} else if (command === 'restore-full' && file && isAbsolute(file)) {
  await assertAgentStopped();
  const pre = await restoreAgentFull(dbPath, file, key, { snapshotDir: backupDir });
  console.log(`restored; previous state saved to ${pre}`);
} else {
  console.error('usage: backup | verify <absolute-file> | restore-full <absolute-file>');
  process.exit(2);
}
