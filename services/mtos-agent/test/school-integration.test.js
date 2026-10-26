import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { AuthError } from '../src/auth.js';
import { openAgentDb } from '../src/db.js';
import { createSchoolMailCollector } from '../src/school-mail.js';
import { createSchoolNoticeCollector } from '../src/school-notices.js';
import { createAgentApp } from '../src/server.js';
import { createStore } from '../src/store.js';
import { createWorker } from '../src/worker.js';
import { createYolo } from '../src/yolo.js';
import { clock, fakeAi, freshDb } from './helpers.js';

const op = (o) => ({ op: 'create', task_id: null, source_type: null, source_id: null, title: null, memo: null, due_date: null, priority: null, category: null, project_id: null, duplicate_of: null, evidence: null, reason: 'test', ...o });

function fakeP0() {
  const tasks = new Map();
  return {
    tasks,
    async listTasks() { return [...tasks.values()].filter((t) => !t.deleted); },
    async create(id, fields) { const t = { id, version: 1, status: 'open', deleted: false, priority: 'normal', category: 'unclassified', project_id: null, due_date: null, memo: '', ...fields }; tasks.set(id, t); return { task: t, duplicate: false }; },
    async update(id, _v, changes) { Object.assign(tasks.get(id), changes); return { task: tasks.get(id), conflicts: [] }; },
    async archive(id) { tasks.get(id).deleted = true; },
    async restore(id) { tasks.get(id).deleted = false; },
    async revisions() { return []; },
  };
}

test('migration keeps existing inbox rows when an older database gains the school_mail kind', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mig-'));
  const path = join(dir, 'agent.db');
  const first = openAgentDb(path);
  first.exec("INSERT INTO inbox_items (id, dedupe_key, source_kind, raw_text, received_at, created_at, updated_at) VALUES ('i1','k1','gmail','old mail','2026-10-01T00:00:00Z','2026-10-01T00:00:00Z','2026-10-01T00:00:00Z')");
  // Recreate the pre-migration state: old CHECK constraint and schema_version 1.
  first.exec('ALTER TABLE inbox_items RENAME TO tmp_new');
  first.exec(`CREATE TABLE inbox_items (id TEXT PRIMARY KEY, dedupe_key TEXT NOT NULL UNIQUE, source_kind TEXT NOT NULL CHECK (source_kind IN ('manual','gmail','portal','link')), source_ref TEXT, source_url TEXT,
    raw_text TEXT NOT NULL, received_at TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'new' CHECK (state IN ('new','classifying','classified','auto_pending','applied','undone','duplicate','dismissed','failed')),
    classification TEXT, created_task_id TEXT, duplicate_of_task_id TEXT, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
  first.exec('INSERT INTO inbox_items SELECT * FROM tmp_new; DROP TABLE tmp_new');
  first.exec("UPDATE meta SET value = '1' WHERE key = 'schema_version'");
  first.close();

  const migrated = openAgentDb(path);
  assert.equal(migrated.prepare('SELECT raw_text FROM inbox_items WHERE id = ?').get('i1').raw_text, 'old mail');
  migrated.exec("INSERT INTO inbox_items (id, dedupe_key, source_kind, raw_text, received_at, created_at, updated_at) VALUES ('i2','k2','school_mail','x','2026-10-01T00:00:00Z','2026-10-01T00:00:00Z','2026-10-01T00:00:00Z')");
  assert.equal(migrated.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get().value, '2');
  migrated.close();
  assert.equal(openAgentDb(path).prepare('SELECT COUNT(*) n FROM inbox_items').get().n, 2); // idempotent reopen
  assert.ok(new DatabaseSync(path).prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'inbox_state'").get());
});

test('school notice -> YOLO (gpt-6-luna runner) -> P0 task with source link, AI note and audit trail, then rollback', async () => {
  const db = freshDb();
  const store = createStore(db);
  const collect = createSchoolNoticeCollector({
    db, store, env: { MTOS_SOURCE_FILES_DIR: mkdtempSync(join(tmpdir(), 'n-')) }, now: clock(),
    run: async () => ({
      ok: true, code: 'ok', pending: 0,
      notices: [{ notice_id: 'N1', type: 'ALL', title: '奨学金 申請', department: '学生オフィス', published_at: '2026-10-25T00:00:00Z', deadline: '2026-11-05', expires_at: '', importance: '', category: '', body: '11/5までに申請', source_url: 'https://sp.ritsumei.ac.jp/studentportal/s/r-information/N1/view', attachments: [], fingerprint: 'f1' }],
    }),
  });
  const { newItemIds } = await collect();
  assert.equal(newItemIds.length, 1);

  const p0 = fakeP0();
  const ai = fakeAi({
    ops: [op({ source_type: 'portal', source_id: newItemIds[0], title: '奨学金 申請', due_date: '2026-11-05', category: 'school', priority: 'high' })],
    source_notes: [{ source_type: 'portal', source_id: newItemIds[0], summary: '11/5까지 장학금 신청.', importance: 'high', requires_action: true }],
  });
  ai.model = 'gpt-6-luna';
  const yolo = createYolo({ db, store, p0, ai, labRoot: mkdtempSync(join(tmpdir(), 'lab-')) });
  const run = await yolo.run({});
  assert.equal(run.applied, 1);
  const [task] = [...p0.tasks.values()];
  assert.equal(task.due_date, '2026-11-05');
  assert.equal(task.source_url, 'https://sp.ritsumei.ac.jp/studentportal/s/r-information/N1/view');
  assert.equal(store.taskMeta.get(task.id).source_ref, `portal:${newItemIds[0]}`);
  const note = db.prepare('SELECT * FROM source_ai_analysis').get();
  assert.deepEqual([note.source_type, note.source_id, note.summary, note.importance, note.requires_action, note.suggested_task, note.model], ['school_notice', 'N1', '11/5까지 장학금 신청.', 'high', 1, '奨学金 申請', 'gpt-6-luna']);
  assert.equal(db.prepare('SELECT model FROM yolo_runs').get().model, 'gpt-6-luna');
  assert.equal(yolo.changesOf(run.runId)[0].status, 'applied');

  assert.equal((await yolo.rollback(run.runId)).rolled_back, 1);
  assert.equal(p0.tasks.get(task.id).deleted, true);
});

test('worker schedules school jobs on their own interval, never overlaps, and sends new items to YOLO', async () => {
  const db = freshDb();
  const now = clock(Date.parse('2026-10-26T03:00:00Z'));
  const store = createStore(db);
  let mailRuns = 0;
  let noticeRuns = 0;
  const worker = createWorker({
    db, ai: fakeAi(), now, store, collectMail: async () => ({ fetched: 0, newItemIds: [] }),
    collectSchoolMail: async () => { mailRuns += 1; return { fetched: 1, newItemIds: ['x'] }; },
    collectSchoolNotices: async () => { noticeRuns += 1; return { fetched: 0, newItemIds: [], paused: true, session: 'session_expired' }; },
    schoolConfig: { mailSeconds: 120, noticeSeconds: 300 },
    yolo: { run: async () => ({ status: 'skipped' }) },
  });
  for (let i = 0; i < 6; i += 1) await worker.tick();
  assert.equal(mailRuns, 1);
  assert.equal(noticeRuns, 1);
  for (let i = 0; i < 4; i += 1) await worker.tick();
  assert.equal(mailRuns, 1); // same 120 s slot
  now.advance(121_000);
  for (let i = 0; i < 6; i += 1) await worker.tick();
  assert.equal(mailRuns, 2);
  assert.equal(noticeRuns, 1); // 300 s not reached
  now.advance(200_000);
  for (let i = 0; i < 8; i += 1) await worker.tick();
  assert.equal(noticeRuns, 2);
  const done = db.prepare("SELECT result FROM jobs WHERE type = 'collect_school_notices' AND state = 'done'").get();
  assert.match(done.result, /session_expired/);
  assert.ok(db.prepare("SELECT 1 FROM jobs WHERE type = 'yolo_manage' AND dedupe_key LIKE 'yolo:after:%'").get());
});

test('school endpoints require the P0 session and expose lists, details, status and downloads', async () => {
  const db = freshDb();
  const store = createStore(db);
  const dir = mkdtempSync(join(tmpdir(), 'api-'));
  const mbox = join(dir, 'tb', 'Mail', 'graph.microsoft.com');
  mkdirSync(mbox, { recursive: true });
  writeFileSync(join(dir, 'tb', 'prefs.js'), ['user_pref("mail.server.server2.type", "graph");', 'user_pref("mail.server.server2.name", "me@ed.ritsumei.ac.jp");', 'user_pref("mail.server.server2.directory-rel", "[ProfD]Mail/graph.microsoft.com");'].join('\n'));
  writeFileSync(join(mbox, 'INBOX'), ['From - Mon Oct 26 12:00:00 2026', 'Message-ID: <a@x>', 'Date: Mon, 26 Oct 2026 10:00:00 +0900', 'From: a@b', 'Subject: Hi', 'Content-Type: multipart/mixed; boundary="B"', '', '--B', 'Content-Type: text/plain', '', 'body', '--B', 'Content-Type: application/pdf; name="x.pdf"', 'Content-Transfer-Encoding: base64', '', 'SGVsbG8=', '--B--', ''].join('\n'));
  await createSchoolMailCollector({ db, store, now: clock(Date.parse('2026-10-26T03:00:00Z')), env: { MTOS_THUNDERBIRD_PROFILE: join(dir, 'tb'), MTOS_SOURCE_FILES_DIR: join(dir, 'files') } })();

  const TOKEN = 'valid-session-token-0123456789';
  const server = createServer(createAgentApp({ db, verifySession: async (t) => { if (t !== TOKEN) throw new AuthError('invalid session'); }, codexInfo: () => null }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/agent/api`;
  const get = (path, token = TOKEN) => fetch(`${base}${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  try {
    assert.equal((await get('/school/mails', null)).status, 401);
    const list = await (await get('/school/mails')).json();
    assert.equal(list.total, 1);
    assert.equal(list.mails[0].attachment_count, 1);
    const detail = (await (await get(`/school/mails/${list.mails[0].id}`)).json()).mail;
    assert.equal(detail.body_text, 'body');
    // HTML is now returned (capped) for the web app's sandboxed viewer; mails without HTML get null
    assert.ok('body_html' in detail);
    assert.ok(detail.body_html === null || detail.body_html.length <= 300_000);
    const download = await get(`/school/attachments/${detail.attachments[0].id}`);
    assert.equal(download.headers.get('content-type'), 'application/octet-stream');
    assert.match(download.headers.get('content-disposition'), /^attachment;/);
    assert.equal(await download.text(), 'Hello');
    const status = await (await get('/school/status')).json();
    assert.equal(status.mail.connected, true);
    assert.equal(status.notices.connected, false);
    assert.equal((await get('/school/mails/nope')).status, 404);
  } finally { server.close(); }
});

test('backup mirrors only missing source files', async () => {
  const { syncSourceFiles } = await import('../src/backup.js');
  const src = mkdtempSync(join(tmpdir(), 'src-'));
  const dest = mkdtempSync(join(tmpdir(), 'dest-'));
  mkdirSync(join(src, 'attachments', 'ab'), { recursive: true });
  writeFileSync(join(src, 'attachments', 'ab', 'f.pdf'), 'x');
  assert.equal(syncSourceFiles(src, dest), 1);
  assert.equal(syncSourceFiles(src, dest), 0);
  writeFileSync(join(src, 'attachments', 'ab', 'g.pdf'), 'y');
  assert.equal(syncSourceFiles(src, dest), 1);
});
