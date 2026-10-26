import { randomUUID } from 'node:crypto';
import { statSync } from 'node:fs';
import { nowIso, tx } from './db.js';
import { MailConfigError } from './gmail.js';
import { headerDate, parseMessage } from './mime.js';
import { createSourceFiles, enqueueForAi, parseCursor, recordAttachment, sha1 } from './school-store.js';
import { fileFingerprint, findSchoolAccounts, listFolders, resolveProfile, scanMbox } from './thunderbird.js';

const DAY_MS = 86_400_000;
const AD_SUBJECT = /^\s*[\[(【]?(광고|AD|広告|PR)[\])】]/i;

/**
 * Collects school Outlook mail from the Thunderbird profile on this server.
 * Thunderbird owns syncing; this only reads its mbox files (never writes, never
 * marks read, moves or deletes) and only for accounts on the school domain.
 */
export function createSchoolMailCollector({ db, store, env = process.env, now = () => Date.now() }) {
  const files = createSourceFiles(env.MTOS_SOURCE_FILES_DIR ?? env.MTOS_SOURCE_DIR ?? `${env.LOCALAPPDATA ?? '.'}/MasterThesisOS/agent/sources`);
  const domains = (env.MTOS_SCHOOL_MAIL_DOMAINS ?? 'ritsumei.ac.jp').split(',');
  const backfillDays = Math.max(1, Number(env.MTOS_SCHOOL_BACKFILL_DAYS) || 90);

  const find = db.prepare('SELECT * FROM school_mails WHERE account_id = ? AND message_key = ?');

  function store1(account, folder, raw, since, out) {
    const headDate = headerDate(raw.subarray(0, 65536));
    if (headDate !== null && headDate < since) return;
    const mail = parseMessage(raw);
    const key = mail.messageId ?? `h-${sha1(`${mail.from}|${mail.sentAt}|${mail.subject}|${mail.bodyText.slice(0, 200)}`)}`;
    const hash = sha1([mail.subject, mail.from, mail.to, mail.cc, mail.sentAt ?? '', mail.bodyText].join('\n'));
    const existing = find.get(account.accountId, key);
    const stamp = nowIso();

    if (existing && existing.content_hash === hash) {
      // Same content: only follow folder moves and read state; never re-analyse.
      if (existing.folder_id !== folder.folderId || existing.read_state !== Number(mail.read)) {
        db.prepare('UPDATE school_mails SET folder_id = ?, read_state = ?, updated_at = ? WHERE id = ?').run(folder.folderId, Number(mail.read), stamp, existing.id);
      }
      return;
    }

    const emlPath = files.saveEml(account.accountId, key, hash, raw);
    const saved = mail.attachments.map((a) => ({ ...a, ...files.saveAttachment(a.data, a.filename) }));
    const id = existing?.id ?? randomUUID();
    tx(db, () => {
      if (existing) {
        db.prepare(`UPDATE school_mails SET folder_id = ?, subject = ?, from_addr = ?, to_addr = ?, cc_addr = ?, received_at = ?, sent_at = ?, body_text = ?, body_html = ?,
          read_state = ?, content_hash = ?, eml_path = ?, updated_at = ? WHERE id = ?`).run(folder.folderId, mail.subject, mail.from, mail.to, mail.cc, mail.receivedAt, mail.sentAt,
          mail.bodyText, mail.bodyHtml, Number(mail.read), hash, emlPath, stamp, id);
      } else {
        db.prepare(`INSERT INTO school_mails (id, account_id, message_key, folder_id, message_id, subject, from_addr, to_addr, cc_addr, received_at, sent_at, body_text, body_html,
          read_state, content_hash, eml_path, source, collected_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, account.accountId, key, folder.folderId, mail.messageId,
          mail.subject, mail.from, mail.to, mail.cc, mail.receivedAt, mail.sentAt, mail.bodyText, mail.bodyHtml, Number(mail.read), hash, emlPath, 'thunderbird', stamp, stamp);
      }
      for (const a of saved) recordAttachment(db, { sourceType: 'school_mail', sourceId: id, filename: a.filename, mime: a.mime, size: a.size, sha256: a.sha256, path: a.path });
    });
    out.stored += 1;
    if (existing) out.updated += 1;

    const ad = folder.noAi || (mail.unsubscribe && AD_SUBJECT.test(mail.subject));
    if (ad) return;
    const itemId = enqueueForAi(store, {
      kind: 'school_mail', sourceId: id, hash,
      receivedAt: mail.sentAt ?? stamp,
      text: ['[학교 메일]', `제목: ${mail.subject}`, `보낸 사람: ${mail.from}`, `받는 사람: ${mail.to}`, mail.cc ? `참조: ${mail.cc}` : null,
        `수신일: ${mail.sentAt ?? '알 수 없음'}`, saved.length ? `첨부: ${saved.map((a) => a.filename).join(', ')}` : null, '', mail.bodyText || '(본문 없음)']
        .filter((line) => line !== null).join('\n'),
    });
    if (itemId) out.newItemIds.push(itemId);
  }

  return async function collectSchoolMail() {
    const startedAt = new Date(now()).toISOString();
    const state = store.settings.collector('school_mail');
    store.settings.setCollector('school_mail', { last_checked_at: startedAt });
    try {
      const profile = resolveProfile(env);
      if (!profile) throw new MailConfigError('Thunderbird 프로필을 찾지 못했어.');
      const accounts = findSchoolAccounts(profile, { domains });
      if (!accounts.length) throw new MailConfigError('Thunderbird에서 학교 Outlook 계정을 찾지 못했어.');

      const cursor = parseCursor(state);
      // The 90-day horizon is fixed at the first connection, so re-reading a message later never pulls in older mail.
      const since = Date.parse(cursor.initialized_at ?? startedAt) - backfillDays * DAY_MS;
      const out = { stored: 0, updated: 0, newItemIds: [], folders: 0 };
      const next = { ...cursor, folders: { ...(cursor.folders ?? {}) }, accounts: accounts.map((a) => a.accountId) };

      for (const account of accounts) {
        for (const folder of listFolders(account.dir)) {
          const mapKey = `${account.accountId}|${folder.folderId}`;
          const fp = { ...fileFingerprint(folder.file), mtime: Math.floor(statSync(folder.file).mtimeMs) };
          const prev = next.folders[mapKey];
          if (prev && prev.size === fp.size && prev.head === fp.head && prev.mtime === fp.mtime) continue;
          out.folders += 1;
          const reuse = prev && prev.head === fp.head && fp.size >= prev.size;
          let result = scanMbox(folder.file, reuse ? prev.offset : 0, (raw) => store1(account, folder, raw, since, out));
          if (!result.aligned) result = scanMbox(folder.file, 0, (raw) => store1(account, folder, raw, since, out));
          next.folders[mapKey] = { ...fp, offset: result.lastStart ?? 0 };
        }
      }
      next.initialized_at = cursor.initialized_at ?? startedAt;
      store.settings.setCollector('school_mail', { last_success_at: startedAt, cursor: JSON.stringify(next), last_error: null });
      return { fetched: out.stored, newItemIds: out.newItemIds, folders: out.folders, updated: out.updated };
    } catch (error) {
      store.settings.setCollector('school_mail', { last_error: String(error.message).slice(0, 500) });
      throw error;
    }
  };
}
