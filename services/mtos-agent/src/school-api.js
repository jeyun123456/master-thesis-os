import { existsSync, readFileSync } from 'node:fs';
import { parseCursor, attachmentsOf } from './school-store.js';
import { NotFoundError } from './validate.js';

const page = (url) => ({
  limit: Math.min(Math.max(Number(url.searchParams.get('limit')) || 50, 1), 200),
  offset: Math.max(Number(url.searchParams.get('offset')) || 0, 0),
});

const sourceState = (store, source) => {
  const state = store.settings.collector(source);
  const cursor = parseCursor(state);
  return {
    last_checked_at: state.last_checked_at, last_success_at: state.last_success_at, last_error: state.last_error,
    connected: Boolean(cursor.initialized_at), session: cursor.session ?? null, pending: cursor.pending ?? 0,
  };
};

/** Read-only school mail / notice endpoints for the web app. Returns null when the path is not a school route. */
export function handleSchoolRoute({ db, store, method, path, url }) {
  if (method !== 'GET' || !path.startsWith('/school/')) return null;
  let m;

  if (path === '/school/status') {
    const mail = sourceState(store, 'school_mail');
    const notices = sourceState(store, 'school_notices');
    return [200, {
      mail: { ...mail, accounts: parseCursor(store.settings.collector('school_mail')).accounts ?? [] },
      notices: { ...notices, needs_login: notices.session === 'session_expired' || notices.session === 'login_required' },
    }];
  }

  const analysis = (type, id) => db.prepare('SELECT summary, importance, requires_action, suggested_task, deadline, project_id, reason, model, analyzed_at FROM source_ai_analysis WHERE source_type = ? AND source_id = ? ORDER BY analyzed_at DESC LIMIT 1').get(type, id) ?? null;
  const withAnalysis = (type, id) => { const a = analysis(type, id); return a && { ...a, requires_action: Boolean(a.requires_action) }; };

  if (path === '/school/mails') {
    const { limit, offset } = page(url);
    const rows = db.prepare(`SELECT id, folder_id, subject, from_addr, to_addr, received_at, sent_at, read_state, collected_at,
      (SELECT COUNT(*) FROM source_attachments a WHERE a.source_type = 'school_mail' AND a.source_id = school_mails.id) AS attachment_count
      FROM school_mails ORDER BY COALESCE(received_at, sent_at, collected_at) DESC LIMIT ? OFFSET ?`).all(limit, offset);
    return [200, { mails: rows.map((r) => ({ ...r, read_state: Boolean(r.read_state), analysis: withAnalysis('school_mail', r.id) })), total: db.prepare('SELECT COUNT(*) n FROM school_mails').get().n }];
  }
  if ((m = path.match(/^\/school\/mails\/([\w-]+)$/))) {
    const row = db.prepare('SELECT id, account_id, folder_id, message_id, subject, from_addr, to_addr, cc_addr, received_at, sent_at, body_text, body_html, read_state, source, collected_at, updated_at FROM school_mails WHERE id = ?').get(m[1]);
    if (!row) throw new NotFoundError('mail not found');
    // HTML is only shown inside a sandboxed, script-less frame in the web app; cap it so one huge mail cannot bloat the response
    return [200, { mail: { ...row, body_html: row.body_html ? String(row.body_html).slice(0, 300_000) : null, read_state: Boolean(row.read_state), attachments: attachmentsOf(db, 'school_mail', row.id), analysis: withAnalysis('school_mail', row.id) } }];
  }

  if (path === '/school/notices') {
    const { limit, offset } = page(url);
    const type = url.searchParams.get('type');
    const where = type === 'ALL' || type === 'DM' ? 'WHERE notice_type = ?' : '';
    const rows = db.prepare(`SELECT notice_id, notice_type, category, department, title, importance, published_at, deadline, expires_at, source_url, collected_at, changed_at,
      (SELECT COUNT(*) FROM source_attachments a WHERE a.source_type = 'school_notice' AND a.source_id = school_notices.notice_id) AS attachment_count
      FROM school_notices ${where} ORDER BY COALESCE(published_at, collected_at) DESC LIMIT ? OFFSET ?`).all(...(where ? [type] : []), limit, offset);
    return [200, { notices: rows.map((r) => ({ ...r, analysis: withAnalysis('school_notice', r.notice_id) })) }];
  }
  if ((m = path.match(/^\/school\/notices\/([\w.-]+)$/))) {
    const row = db.prepare('SELECT * FROM school_notices WHERE notice_id = ?').get(m[1]);
    if (!row) throw new NotFoundError('notice not found');
    const { content_hash: _hash, ...notice } = row;
    return [200, {
      notice: {
        ...notice, attachments: attachmentsOf(db, 'school_notice', row.notice_id), analysis: withAnalysis('school_notice', row.notice_id),
        history: db.prepare('SELECT field, old_value, new_value, changed_at FROM school_notice_history WHERE notice_id = ? ORDER BY id DESC LIMIT 50').all(row.notice_id),
      },
    }];
  }

  if ((m = path.match(/^\/school\/attachments\/([\w-]+)$/))) {
    const row = db.prepare('SELECT filename, mime, path FROM source_attachments WHERE id = ?').get(m[1]);
    if (!row) throw new NotFoundError('attachment not found');
    if (!row.path || !existsSync(row.path)) throw new NotFoundError('attachment file is not stored on the server');
    return [200, { __file: { data: readFileSync(row.path), filename: row.filename } }];
  }
  return null;
}
