import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import { createAgentBackup, openAgentBackup } from '../src/backup.js';
import { AiAuthError, AiRateLimitError, createCodexRunner } from '../src/codex.js';
import { openAgentDb } from '../src/db.js';
import { buildQuery, createGmailCollector } from '../src/gmail.js';
import { createStore } from '../src/store.js';
import { freshDb } from './helpers.js';

test('gmail query only targets allow-listed senders', () => {
  assert.equal(buildQuery(['prof@univ.ac.jp', 'univ.ac.jp'], 1700000000), 'from:(prof@univ.ac.jp OR univ.ac.jp) after:1700000000');
  assert.throws(() => buildQuery([], 0), /발신자/);
});

test('gmail collection is incremental and dedupes by message id', async () => {
  const store = createStore(freshDb());
  store.settings.setMailSenders(['prof@univ.ac.jp']);
  const queries = [];
  const fetchImpl = async (url) => {
    const href = String(url);
    if (href.includes('oauth2')) return Response.json({ access_token: 'at' });
    if (href.includes('/messages?')) { queries.push(new URL(href).searchParams.get('q')); return Response.json({ messages: [{ id: 'abc123' }] }); }
    return Response.json({ id: 'abc123', internalDate: '1761350400000', snippet: '제출 안내', payload: { headers: [{ name: 'Subject', value: '중간발표 일정' }, { name: 'From', value: 'prof@univ.ac.jp' }] } });
  };
  const env = { GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret', GOOGLE_REFRESH_TOKEN: 'rt' };
  let t = Date.parse('2026-10-25T00:00:00Z');
  const collect = createGmailCollector({ store, env, fetchImpl, now: () => t });
  const first = await collect();
  assert.equal(first.newItemIds.length, 1);
  t += 12 * 3600_000;
  const second = await collect();
  assert.equal(second.newItemIds.length, 0, 'same message is not collected twice');
  const cursorAfterFirst = Math.floor(Date.parse('2026-10-25T00:00:00Z') / 1000) - 2 * 3600;
  assert.match(queries[1], new RegExp(`after:${cursorAfterFirst}$`));
  const [item] = store.inbox.list();
  assert.equal(item.source_ref, 'gmail:abc123');
  assert.equal(item.source_url, 'https://mail.google.com/mail/u/0/#all/abc123');
  assert.equal(store.settings.collector('gmail').last_error, null);
});

test('gmail without configuration records the error and collects nothing', async () => {
  const store = createStore(freshDb());
  await assert.rejects(createGmailCollector({ store, env: {} })(), /OAuth/);
  assert.match(store.settings.collector('gmail').last_error, /OAuth/);
});

function fakeSpawn({ code, output = '', write }) {
  return (command, args) => {
    const child = new EventEmitter();
    child.pid = undefined;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new PassThrough();
    child.kill = () => {};
    setImmediate(() => {
      if (write) writeFileSync(args[args.indexOf('--output-last-message') + 1], write);
      child.stderr.end(output);
      child.stdout.end();
      child.emit('close', code);
    });
    return child;
  };
}

test('codex runner maps login and rate-limit failures and parses structured output', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'codex-fake-'));
  const exe = join(dir, 'codex.exe');
  writeFileSync(exe, '');
  const env = { MTOS_CODEX_COMMAND: exe };
  try {
    await assert.rejects(createCodexRunner({ env, spawnImpl: fakeSpawn({ code: 1, output: 'Not logged in' }) }).run({ prompt: 'p', schema: {} }), AiAuthError);
    await assert.rejects(createCodexRunner({ env, spawnImpl: fakeSpawn({ code: 1, output: 'usage limit reached' }) }).run({ prompt: 'p', schema: {} }), AiRateLimitError);
    const ok = await createCodexRunner({ env, spawnImpl: fakeSpawn({ code: 0, write: '{"steps":[]}' }) }).run({ prompt: 'p', schema: {} });
    assert.deepEqual(ok.output, { steps: [] });
    assert.throws(() => createCodexRunner({ env: { MTOS_AI_MODEL: 'bad model; rm' } }), /invalid/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('encrypted backup round-trips and keeps the P0 container format', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-bk-'));
  try {
    const db = openAgentDb(join(dir, 'live.db'));
    createStore(db).memos.create({ id: 'keep-me', body: '백업 대상' });
    const key = Buffer.alloc(32, 7);
    const file = await createAgentBackup(db, { outDir: join(dir, 'backups'), key });
    db.close();
    const { path, cleanup } = openAgentBackup(file, key);
    const restored = openAgentDb(path);
    assert.equal(createStore(restored).memos.get('keep-me').body, '백업 대상');
    restored.close();
    cleanup();
    assert.throws(() => openAgentBackup(file, Buffer.alloc(32, 8)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
