#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, relative, resolve, sep, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(new URL('../', import.meta.url)));
const p0Root = resolve(repoRoot, '..', 'master-thesis-os-p0', 'tools', 'master-thesis-os-p0');
const backupCli = join(p0Root, 'scripts', 'backup-cli.js');
const scratchBase = process.env.TMPDIR || (process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Temp') : process.env.TEMP);

function isWithin(root, candidate) {
  const rel = relative(resolve(root), resolve(candidate));
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
}

if (!scratchBase || !existsSync(scratchBase) || isWithin(repoRoot, scratchBase) || isWithin(p0Root, scratchBase)) {
  console.error('BLOCK: provide an existing scratch directory outside both repositories (TMPDIR).');
  process.exit(1);
}
if (!existsSync(backupCli)) {
  console.error('BLOCK: sibling P0 backup CLI is not available.');
  process.exit(1);
}

const workDir = mkdtempSync(join(scratchBase, 'mtos-p0-backup-verify-'));
const dbPath = join(workDir, 'isolated-data', 'test.db');
const backupDir = join(workDir, 'encrypted-backups');
const key = randomBytes(32).toString('hex');
let db;

function runBackupCli(...args) {
  const env = {
    PATH: process.env.PATH || '',
    SystemRoot: process.env.SystemRoot || '',
    WINDIR: process.env.WINDIR || '',
    TEMP: workDir,
    TMP: workDir,
    TMPDIR: workDir,
    MTOS_DB_PATH: dbPath,
    MTOS_BACKUP_DIR: backupDir,
    MTOS_BACKUP_KEY: key,
  };
  const result = spawnSync(process.execPath, [backupCli, ...args], {
    cwd: p0Root,
    env,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`P0 backup CLI command '${args[0]}' failed (exit ${result.status ?? 'unavailable'}).`);
  }
  return result.stdout.trim();
}

try {
  const { openDb } = await import(new URL('../../master-thesis-os-p0/tools/master-thesis-os-p0/src/db.js', import.meta.url));
  const { createTaskService } = await import(new URL('../../master-thesis-os-p0/tools/master-thesis-os-p0/src/tasks.js', import.meta.url));
  const taskId = 'isolated-backup-restore-check';
  const originalTitle = 'staging-only-backup-sentinel';
  const changedTitle = 'staging-only-after-backup';

  db = openDb(dbPath);
  const tasks = createTaskService(db);
  tasks.create({
    id: taskId,
    op_id: 'isolated-backup-seed-op',
    fields: { title: originalTitle, status: 'open', category: 'research' },
  });
  db.close();
  db = undefined;

  const backupOutput = runBackupCli('backup');
  const backupFile = backupOutput.split(/\r?\n/).at(-1);
  assert.ok(backupFile && isWithin(backupDir, backupFile), 'backup must stay inside the isolated scratch directory');
  assert.ok(existsSync(backupFile), 'encrypted backup file must exist');
  assert.ok(!readFileSync(backupFile).includes(Buffer.from(originalTitle)), 'backup must not contain plaintext task data');
  runBackupCli('verify', backupFile);
  const preview = JSON.parse(runBackupCli('preview', backupFile, taskId));
  assert.equal(preview.task?.title, originalTitle);

  db = openDb(dbPath);
  createTaskService(db).update(taskId, {
    base_version: 1,
    op_id: 'isolated-backup-mutate-op',
    changes: { title: changedTitle },
  });
  db.close();
  db = undefined;

  const restoreOutput = runBackupCli('restore-full', backupFile);
  const preRestoreFile = restoreOutput.match(/pre-restore snapshot:\s*(.+)$/m)?.[1]?.trim();
  assert.ok(preRestoreFile && isWithin(join(backupDir, 'pre-restore'), preRestoreFile));
  runBackupCli('verify', preRestoreFile);
  const preRestorePreview = JSON.parse(runBackupCli('preview', preRestoreFile, taskId));
  assert.equal(preRestorePreview.task?.title, changedTitle);

  db = openDb(dbPath);
  const restored = db.prepare('SELECT title, status FROM tasks WHERE id = ?').get(taskId);
  const integrity = db.prepare('PRAGMA integrity_check').get().integrity_check;
  assert.equal(restored?.title, originalTitle);
  assert.equal(restored?.status, 'open');
  assert.equal(integrity, 'ok');
  db.close();
  db = undefined;

  console.log('PASS isolated test database produced an encrypted backup; no plaintext sentinel found');
  console.log('PASS CLI verify and preview read back the expected test record');
  console.log('PASS full restore recovered the backup and retained an encrypted pre-restore snapshot');
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Isolated backup verification failed.');
  process.exitCode = 1;
} finally {
  try { db?.close(); } catch { /* already closed */ }
  rmSync(workDir, { recursive: true, force: true });
}
