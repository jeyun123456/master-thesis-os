import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nowIso, tx } from './db.js';
import { enqueueForAi, parseCursor, recordAttachment, sha1 } from './school-store.js';

const DAY_MS = 86_400_000;
const PORTAL_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'portal');
const SESSION_CODES = new Set(['login_required', 'session_expired']);
const WATCHED = ['title', 'deadline', 'expires_at', 'published_at'];

export const portalEnv = (env = process.env) => ({
  ...env,
  PYTHONIOENCODING: 'utf-8',
  PYTHONDONTWRITEBYTECODE: '1',
  RITSUMEI_BROWSER_PROFILE_DIR: env.MTOS_PORTAL_PROFILE_DIR ?? `${env.LOCALAPPDATA ?? '.'}/MasterThesisOS/portal-profile`,
});

/** Runs portal_sync.py and returns its single JSON line. The browser session never leaves that process. */
export function runPortalCli(args, { env = process.env, timeoutMs = 10 * 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(env.MTOS_PYTHON ?? 'python', [join(PORTAL_DIR, 'portal_sync.py'), ...args], { env: portalEnv(env), timeout: timeoutMs, windowsHide: true, maxBuffer: 32 * 1024 * 1024, cwd: PORTAL_DIR }, (error, stdout) => {
      const line = String(stdout ?? '').trim().split(/\r?\n/).filter(Boolean).pop();
      try { resolve(JSON.parse(line)); } catch { reject(new Error(error ? `portal sync failed to run (${error.code ?? 'error'})` : 'portal sync returned no result')); }
    });
  });
}

function defaultRunner(env) {
  return async (request) => {
    const dir = mkdtempSync(join(tmpdir(), 'portal-'));
    try {
      const file = join(dir, 'request.json');
      writeFileSync(file, JSON.stringify(request));
      return await runPortalCli(['sync', '--request', file], { env });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  };
}

/**
 * Collects Student Portal notices through the server's saved browser session.
 * An expired session pauses collection (state 'session_expired') until the user
 * signs in again; there is no automatic login and no retry loop.
 */
export function createSchoolNoticeCollector({ db, store, env = process.env, now = () => Date.now(), run = defaultRunner(env) }) {
  const filesDir = join(env.MTOS_SOURCE_FILES_DIR ?? env.MTOS_SOURCE_DIR ?? `${env.LOCALAPPDATA ?? '.'}/MasterThesisOS/agent/sources`, 'attachments');
  const backfillDays = Math.max(1, Number(env.MTOS_SCHOOL_BACKFILL_DAYS) || 90);
  // After the portal asked for a login, one quiet retry per interval: the Microsoft SSO cookie often rebuilds the session by itself.
  const recoverMs = Math.max(5, Number(env.MTOS_PORTAL_RECOVER_MINUTES) || 30) * 60_000;

  function save(detail, stamp, out) {
    const noticeId = String(detail.notice_id);
    const attachments = (detail.attachments ?? []).map((a) => ({ filename: String(a.filename ?? ''), url: a.url || null, path: a.path || null, sha256: a.sha256 || '', size: a.size ?? null })).filter((a) => a.filename);
    const hash = sha1([detail.title, detail.department, detail.published_at, detail.expires_at, detail.deadline, detail.importance, detail.category, detail.body, attachments.map((a) => a.filename).join(',')].join('\n'));
    const existing = db.prepare('SELECT * FROM school_notices WHERE notice_id = ?').get(noticeId);
    const record = () => { for (const a of attachments) recordAttachment(db, { sourceType: 'school_notice', sourceId: noticeId, filename: a.filename, size: a.size, sha256: a.sha256, path: a.path, url: a.url }); };
    if (existing && existing.content_hash === hash) { record(); return; } // same text; a file may have been fetched since
    const row = {
      notice_type: detail.type ?? detail.notice_type ?? '', category: detail.category ?? '', department: detail.department ?? '', title: detail.title ?? '', importance: detail.importance ?? '',
      published_at: detail.published_at || null, deadline: detail.deadline || null, expires_at: detail.expires_at || null, body_text: detail.body ?? '', source_url: detail.source_url || null,
    };
    tx(db, () => {
      if (existing) {
        for (const field of WATCHED) {
          if ((existing[field] ?? null) !== (row[field] ?? null)) {
            db.prepare('INSERT INTO school_notice_history (notice_id, field, old_value, new_value, changed_at) VALUES (?,?,?,?,?)').run(noticeId, field, existing[field], row[field], stamp);
          }
        }
        db.prepare(`UPDATE school_notices SET notice_type = ?, category = ?, department = ?, title = ?, importance = ?, published_at = ?, updated_at = ?, deadline = ?, expires_at = ?,
          body_text = ?, source_url = ?, content_hash = ?, changed_at = ? WHERE notice_id = ?`).run(row.notice_type, row.category, row.department, row.title, row.importance, row.published_at, stamp,
          row.deadline, row.expires_at, row.body_text, row.source_url, hash, stamp, noticeId);
        out.updated += 1;
      } else {
        db.prepare(`INSERT INTO school_notices (notice_id, notice_type, category, department, title, importance, published_at, updated_at, deadline, expires_at, body_text, source_url, content_hash, collected_at, changed_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(noticeId, row.notice_type, row.category, row.department, row.title, row.importance, row.published_at, null, row.deadline, row.expires_at,
          row.body_text, row.source_url, hash, stamp, stamp);
      }
      record();
    });
    out.stored += 1;
    const itemId = enqueueForAi(store, {
      kind: 'portal', sourceId: noticeId, hash, url: row.source_url, receivedAt: row.published_at ?? stamp,
      text: ['[학교 공지]', `제목: ${row.title}`, `구분: ${row.notice_type}`, row.department ? `담당: ${row.department}` : null, row.published_at ? `게시일: ${row.published_at}` : null,
        row.deadline ? `기한: ${row.deadline}` : null, row.expires_at ? `종료일: ${row.expires_at}` : null, row.importance ? `중요도: ${row.importance}` : null,
        attachments.length ? `첨부: ${attachments.map((a) => a.filename).join(', ')}` : null, '', row.body_text || '(본문 없음)'].filter((line) => line !== null).join('\n'),
    });
    if (itemId) out.newItemIds.push(itemId);
  }

  return async function collectSchoolNotices() {
    const startedAt = new Date(now()).toISOString();
    const state = store.settings.collector('school_notices');
    const cursor = parseCursor(state);
    store.settings.setCollector('school_notices', { last_checked_at: startedAt });
    // Paused after the portal asked for a login: stay quiet, but retry every recoverMs; a silent SSO sign-in ends the pause by itself.
    const wasPaused = SESSION_CODES.has(cursor.session);
    if (wasPaused) {
      if (now() - Date.parse(cursor.recover_at ?? 0) < recoverMs) return { fetched: 0, newItemIds: [], paused: true, session: cursor.session };
      cursor.recover_at = startedAt;
      store.settings.setCollector('school_notices', { cursor: JSON.stringify(cursor) });
    }
    try {
      mkdirSync(filesDir, { recursive: true });
      const since = new Date(Date.parse(cursor.initialized_at ?? startedAt) - backfillDays * DAY_MS).toISOString();
      const fingerprints = { ...(cursor.fingerprints ?? {}) };
      const detailAt = { ...(cursor.detail_at ?? {}) };
      const recent = new Set(db.prepare('SELECT notice_id FROM school_notices WHERE published_at >= ?').all(new Date(now() - 14 * DAY_MS).toISOString()).map((r) => r.notice_id));
      const refresh = new Set([...recent].filter((id) => now() - Date.parse(detailAt[id] ?? 0) > DAY_MS));
      // Notices whose files were never downloaded (earlier runs, failed downloads) get a few more tries.
      const tries = { ...(cursor.download_tries ?? {}) };
      for (const { source_id: id } of db.prepare("SELECT DISTINCT source_id FROM source_attachments WHERE source_type = 'school_notice' AND path IS NULL AND (url IS NULL OR url = '')").all()) {
        if ((tries[id] ?? 0) < 3) { refresh.add(id); tries[id] = (tries[id] ?? 0) + 1; }
      }
      const result = await run({ since, known: fingerprints, refresh: [...refresh], files_dir: filesDir });

      if (!result.ok) {
        if (SESSION_CODES.has(result.code)) {
          store.settings.setCollector('school_notices', { cursor: JSON.stringify({ ...cursor, session: result.code, recover_at: startedAt }), last_error: '학교 포털 재로그인 필요' });
          if (!wasPaused) store.audit('portal_session', result.code); // a failed quiet retry is not a new event
          return { fetched: 0, newItemIds: [], paused: true, session: result.code };
        }
        throw new Error(`portal ${result.code}: ${result.message ?? ''}`.trim());
      }

      const out = { stored: 0, updated: 0, newItemIds: [] };
      const stamp = nowIso();
      for (const detail of result.notices) {
        save(detail, stamp, out);
        fingerprints[detail.notice_id] = detail.fingerprint;
        detailAt[detail.notice_id] = stamp;
      }
      store.settings.setCollector('school_notices', {
        last_success_at: startedAt, last_error: null,
        cursor: JSON.stringify({ ...cursor, session: 'ok', recover_at: null, initialized_at: cursor.initialized_at ?? startedAt, fingerprints, detail_at: detailAt, download_tries: tries, pending: result.pending ?? 0 }),
      });
      if (wasPaused) store.audit('portal_session', 'recovered');
      return { fetched: out.stored, newItemIds: out.newItemIds, updated: out.updated, session: 'ok' };
    } catch (error) {
      store.settings.setCollector('school_notices', { last_error: String(error.message).slice(0, 500) });
      throw error;
    }
  };
}

/** Clears a session pause after the user has signed in again (scripts/portal-login.js). */
export function resumePortal(store) {
  const cursor = parseCursor(store.settings.collector('school_notices'));
  store.settings.setCollector('school_notices', { cursor: JSON.stringify({ ...cursor, session: 'ok' }), last_error: null });
}
