import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseMessage } from '../src/mime.js';
import { createSchoolMailCollector } from '../src/school-mail.js';
import { createStore } from '../src/store.js';
import { clock, freshDb } from './helpers.js';

const NOW = Date.parse('2026-10-26T03:00:00Z');
const eml = ({ id, subject, date, body = 'hello', extra = '', status = '0001' }) => [
  'From - Mon Oct 26 12:00:00 2026', `X-Mozilla-Status: ${status}`, `Message-ID: <${id}@x.jp>`, `Received: from a by b; ${date}`, `Date: ${date}`,
  'From: =?UTF-8?B?7ZWZ6rWQ?= <office@ed.ritsumei.ac.jp>', 'To: me@ed.ritsumei.ac.jp', `Subject: ${subject}`, 'MIME-Version: 1.0', extra || 'Content-Type: text/plain; charset=utf-8', '', body, '',
].join('\n');
const SUBJECT_B64 = '=?UTF-8?B?7IiY6rCV7Iug7LKt?=';

function profile() {
  const root = mkdtempSync(join(tmpdir(), 'tb-'));
  const prof = join(root, 'Profiles', 'p1');
  const school = join(prof, 'Mail', 'graph.microsoft.com');
  const gmail = join(prof, 'ImapMail', 'imap.gmail.com');
  for (const d of [school, gmail]) mkdirSync(d, { recursive: true });
  writeFileSync(join(prof, 'prefs.js'), [
    'user_pref("mail.server.server2.type", "graph");', 'user_pref("mail.server.server2.name", "me@ed.ritsumei.ac.jp");', 'user_pref("mail.server.server2.hostname", "graph.microsoft.com");',
    'user_pref("mail.server.server2.directory-rel", "[ProfD]Mail/graph.microsoft.com");',
    'user_pref("mail.server.server4.type", "imap");', 'user_pref("mail.server.server4.name", "me@gmail.com");', 'user_pref("mail.server.server4.hostname", "imap.gmail.com");',
    'user_pref("mail.server.server4.directory-rel", "[ProfD]ImapMail/imap.gmail.com");',
  ].join('\n'));
  writeFileSync(join(school, 'INBOX'), eml({ id: 'm1', subject: SUBJECT_B64, date: 'Sun, 25 Oct 2026 10:00:00 +0900', body: '신청은 11/5까지' })
    + eml({ id: 'old', subject: 'Old', date: 'Mon, 01 Jan 2026 10:00:00 +0900' }));
  writeFileSync(join(school, 'Sent Items'), eml({ id: 'sent1', subject: 'Sent', date: 'Sun, 25 Oct 2026 11:00:00 +0900' }));
  writeFileSync(join(gmail, 'INBOX'), eml({ id: 'g1', subject: 'Gmail', date: 'Sun, 25 Oct 2026 12:00:00 +0900' }));
  return { root, prof, school, gmail, env: { MTOS_THUNDERBIRD_PROFILE: prof, MTOS_SOURCE_FILES_DIR: join(root, 'files') } };
}
const setup = () => {
  const t = profile();
  const db = freshDb();
  const store = createStore(db);
  return { ...t, db, store, collect: createSchoolMailCollector({ db, store, env: t.env, now: clock(NOW) }) };
};

test('reads only the school account, skips mail older than 90 days and system folders, and leaves the mailbox untouched', async () => {
  const s = setup();
  const before = createHash('sha1').update(readFileSync(join(s.school, 'INBOX'))).digest('hex');
  const out = await s.collect();
  assert.equal(out.newItemIds.length, 1);
  const rows = s.db.prepare('SELECT subject, account_id, folder_id, read_state, eml_path FROM school_mails').all();
  assert.deepEqual(rows.map((r) => [r.subject, r.account_id, r.folder_id, r.read_state]), [['수강신청', 'me@ed.ritsumei.ac.jp', 'INBOX', 1]]);
  assert.equal(readFileSync(rows[0].eml_path, 'utf8').includes('Message-ID: <m1@x.jp>'), true);
  assert.equal(createHash('sha1').update(readFileSync(join(s.school, 'INBOX'))).digest('hex'), before);
  const item = s.store.inbox.list({ states: ['new'] })[0];
  assert.equal(item.source_kind, 'school_mail');
  assert.match(item.raw_text, /신청은 11\/5까지/);
  assert.equal(item.received_at, '2026-10-25T01:00:00.000Z');
});

test('re-collecting is idempotent; appended mail is incremental; folder moves and read-state do not re-trigger AI', async () => {
  const s = setup();
  await s.collect();
  const again = await s.collect();
  assert.equal(again.newItemIds.length, 0);
  assert.equal(s.db.prepare('SELECT COUNT(*) n FROM school_mails').get().n, 1);

  appendFileSync(join(s.school, 'INBOX'), eml({ id: 'm2', subject: 'Second', date: 'Mon, 26 Oct 2026 08:00:00 +0900' }));
  const third = await s.collect();
  assert.equal(third.newItemIds.length, 1);
  assert.equal(s.db.prepare('SELECT COUNT(*) n FROM school_mails').get().n, 2);

  // The same message appearing in another folder is a move, not a new mail.
  writeFileSync(join(s.school, 'Archive'), eml({ id: 'm1', subject: SUBJECT_B64, date: 'Sun, 25 Oct 2026 10:00:00 +0900', body: '신청은 11/5까지', status: '0000' }));
  const moved = await s.collect();
  assert.equal(moved.newItemIds.length, 0);
  const row = s.db.prepare("SELECT folder_id FROM school_mails WHERE message_id = 'm1@x.jp'").get();
  assert.equal(row.folder_id, 'Archive');
  assert.equal(s.db.prepare('SELECT COUNT(*) n FROM inbox_items').get().n, 2);
});

test('changed content creates a new analysis item; attachments are stored once on disk', async () => {
  const s = setup();
  const multipart = (body) => eml({
    id: 'att', subject: 'With file', date: 'Mon, 26 Oct 2026 09:00:00 +0900', extra: 'Content-Type: multipart/mixed; boundary="B"',
    body: `--B\nContent-Type: text/plain; charset=utf-8\n\n${body}\n--B\nContent-Type: application/pdf; name="a.pdf"\nContent-Disposition: attachment; filename="a.pdf"\nContent-Transfer-Encoding: base64\n\nSGVsbG8=\n--B--`,
  });
  appendFileSync(join(s.school, 'INBOX'), multipart('v1'));
  await s.collect();
  const att = s.db.prepare('SELECT filename, size, path FROM source_attachments').all();
  assert.equal(att.length, 1);
  assert.equal(readFileSync(att[0].path, 'utf8'), 'Hello');

  // Thunderbird rewrites the file (e.g. compaction): the edited message is a content change.
  writeFileSync(join(s.school, 'INBOX'), eml({ id: 'm1', subject: 'X', date: 'Sun, 25 Oct 2026 10:00:00 +0900' }) + multipart('v2'));
  const changed = await s.collect();
  assert.equal(changed.newItemIds.length >= 1, true);
  assert.equal(s.db.prepare("SELECT COUNT(*) n FROM school_mails WHERE message_id = 'att@x.jp'").get().n, 1);
  assert.equal(s.db.prepare('SELECT COUNT(*) n FROM source_attachments').get().n, 1);
  assert.match(s.db.prepare("SELECT body_text FROM school_mails WHERE message_id = 'att@x.jp'").get().body_text, /v2/);
});

test('reports a configuration error instead of collecting when no school account exists', async () => {
  const s = setup();
  writeFileSync(join(s.prof, 'prefs.js'), 'user_pref("mail.server.server4.type", "imap");\nuser_pref("mail.server.server4.name", "me@gmail.com");');
  await assert.rejects(() => s.collect(), /학교 Outlook 계정/);
  assert.match(s.store.settings.collector('school_mail').last_error, /학교 Outlook/);
});

test('mime parser decodes encoded words, charsets and nested multipart', () => {
  const raw = Buffer.from(['Subject: =?ISO-2022-JP?B?GyRCRnxLXDhsGyhC?=', 'Content-Type: multipart/alternative; boundary="a"', '', '--a', 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: quoted-printable', '', 'caf=C3=A9', '--a', 'Content-Type: text/html', '', '<p>x</p>', '--a--', ''].join('\r\n'));
  const mail = parseMessage(raw);
  assert.equal(mail.subject, '日本語');
  assert.equal(mail.bodyText, 'café');
  assert.equal(mail.bodyHtml, '<p>x</p>');
});
