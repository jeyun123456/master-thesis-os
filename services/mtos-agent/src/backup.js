import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync, backup } from 'node:sqlite';
import { nowIso, openAgentDb } from './db.js';

// Same container format and key as the P0 backups (MTOSBK1 + AES-256-GCM), so
// one MTOS_BACKUP_KEY and one recovery procedure cover both databases.
// Local only: Drive upload is intentionally not wired up.
const MAGIC = Buffer.from('MTOSBK1\n');

export function parseKey(hex) {
  if (typeof hex !== 'string' || !/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error('backup key must be 64 hex chars (32 bytes)');
  return Buffer.from(hex, 'hex');
}

function encrypt(plain, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), body]);
}

function decrypt(blob, key) {
  if (!blob.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('not a Master Thesis OS backup');
  const iv = blob.subarray(MAGIC.length, MAGIC.length + 12);
  const tag = blob.subarray(MAGIC.length + 12, MAGIC.length + 28);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(blob.subarray(MAGIC.length + 28)), decipher.final()]);
}

function integrityOk(path) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return db.prepare('PRAGMA integrity_check').get().integrity_check === 'ok';
  } finally {
    db.close();
  }
}

/** Online-backup snapshot -> integrity check -> encrypt. Returns the written file path. */
export async function createAgentBackup(sourceDb, { outDir, key }) {
  mkdirSync(outDir, { recursive: true });
  const scratch = mkdtempSync(join(tmpdir(), 'mtos-agent-bk-'));
  try {
    const plain = join(scratch, 'snapshot.db');
    await backup(sourceDb, plain);
    if (!integrityOk(plain)) throw new Error('snapshot failed integrity_check');
    const file = join(outDir, `mtos-agent-${nowIso().replace(/[:.]/g, '-')}.db.enc`);
    writeFileSync(file, encrypt(readFileSync(plain), key));
    return file;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** Decrypts to a temp dir and checks integrity. Caller must call cleanup(). */
export function openAgentBackup(file, key) {
  const dir = mkdtempSync(join(tmpdir(), 'mtos-agent-open-'));
  const path = join(dir, 'backup.db');
  writeFileSync(path, decrypt(readFileSync(file), key));
  const cleanup = () => rmSync(dir, { recursive: true, force: true });
  if (!integrityOk(path)) {
    cleanup();
    throw new Error('backup failed integrity_check');
  }
  return { path, cleanup };
}

/** Full restore with the agent and worker stopped. Always snapshots the live DB first. */
export async function restoreAgentFull(livePath, file, key, { snapshotDir }) {
  const { path, cleanup } = openAgentBackup(file, key);
  try {
    const live = openAgentDb(livePath);
    let pre;
    try {
      pre = await createAgentBackup(live, { outDir: snapshotDir, key });
    } finally {
      live.close();
    }
    for (const ext of ['-wal', '-shm']) rmSync(livePath + ext, { force: true });
    copyFileSync(path, livePath);
    return pre;
  } finally {
    cleanup();
  }
}
