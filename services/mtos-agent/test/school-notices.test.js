import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createSchoolNoticeCollector, resumePortal } from '../src/school-notices.js';
import { createStore } from '../src/store.js';
import { clock, freshDb } from './helpers.js';

const notice = (id, extra = {}) => ({
  notice_id: id, type: 'ALL', title: `공지 ${id}`, department: '국제과', published_at: '2026-10-20T00:00:00Z', expires_at: '', deadline: '', importance: '', category: '',
  body: `본문 ${id}`, source_url: `https://sp.ritsumei.ac.jp/studentportal/s/r-information/${id}/view`, attachments: [], fingerprint: `fp-${id}`, ...extra,
});

function setup(responses) {
  const db = freshDb();
  const store = createStore(db);
  const requests = [];
  const run = async (request) => { requests.push(request); const next = responses.shift(); if (next instanceof Error) throw next; return next; };
  const env = { MTOS_SOURCE_FILES_DIR: mkdtempSync(join(tmpdir(), 'notices-')) };
  const now = clock(Date.parse('2026-10-26T03:00:00Z'));
  return { db, store, requests, now, collect: createSchoolNoticeCollector({ db, store, env, now, run }) };
}
const ok = (notices) => ({ ok: true, code: 'ok', notices, pending: 0 });

test('stores notices once, hands each new one to the AI inbox, and sends known fingerprints on the next run', async () => {
  const s = setup([ok([notice('A'), notice('B', { attachments: [{ filename: 'form.pdf', url: 'https://sp.ritsumei.ac.jp/f', path: null, sha256: null, size: null }] })]), ok([])]);
  const first = await s.collect();
  assert.equal(first.newItemIds.length, 2);
  assert.equal(s.db.prepare('SELECT COUNT(*) n FROM school_notices').get().n, 2);
  assert.deepEqual(s.db.prepare('SELECT filename, url FROM source_attachments').all().map((a) => [a.filename, a.url]), [['form.pdf', 'https://sp.ritsumei.ac.jp/f']]);
  const items = s.store.inbox.list({ states: ['new'] });
  assert.equal(items.every((i) => i.source_kind === 'portal' && i.source_url.includes('/r-information/')), true);
  assert.match(items.find((i) => i.raw_text.includes('공지 B')).raw_text, /첨부: form\.pdf/);

  const second = await s.collect();
  assert.equal(second.newItemIds.length, 0);
  assert.deepEqual(s.requests[1].known, { A: 'fp-A', B: 'fp-B' });
  assert.equal(new Date(s.requests[0].since).toISOString().slice(0, 10), '2026-07-28'); // 90 days before the first connection
});

test('a changed notice updates the same record, keeps a deadline history and triggers one new analysis', async () => {
  const s = setup([ok([notice('A')]), ok([notice('A', { deadline: '2026-11-05', body: '본문 수정', fingerprint: 'fp-A2' })]), ok([notice('A', { deadline: '2026-11-05', body: '본문 수정', fingerprint: 'fp-A2' })])]);
  await s.collect();
  const changed = await s.collect();
  assert.equal(changed.newItemIds.length, 1);
  assert.equal(s.db.prepare('SELECT COUNT(*) n FROM school_notices').get().n, 1);
  const history = s.db.prepare('SELECT field, old_value, new_value FROM school_notice_history').all();
  assert.deepEqual(history.map((h) => [h.field, h.old_value, h.new_value]), [['deadline', null, '2026-11-05']]);
  const repeat = await s.collect();
  assert.equal(repeat.newItemIds.length, 0);
});

test('an expired session pauses collection without retrying logins and keeps stored notices', async () => {
  const s = setup([ok([notice('A')]), { ok: false, code: 'session_expired', message: 'expired' }, ok([notice('B')])]);
  await s.collect();
  const paused = await s.collect();
  assert.equal(paused.paused, true);
  assert.equal(s.store.settings.collector('school_notices').last_error, '학교 포털 재로그인 필요');
  const calls = s.requests.length;
  assert.equal((await s.collect()).paused, true);
  assert.equal(s.requests.length, calls); // no browser launch while paused
  assert.equal(s.db.prepare('SELECT COUNT(*) n FROM school_notices').get().n, 1);

  resumePortal(s.store);
  const resumed = await s.collect();
  assert.equal(resumed.newItemIds.length, 1);
});

test('other portal failures keep existing data and are retried', async () => {
  const s = setup([ok([notice('A')]), { ok: false, code: 'parsing_failed', message: 'x' }]);
  await s.collect();
  await assert.rejects(() => s.collect(), /parsing_failed/);
  assert.equal(s.db.prepare('SELECT COUNT(*) n FROM school_notices').get().n, 1);
});
