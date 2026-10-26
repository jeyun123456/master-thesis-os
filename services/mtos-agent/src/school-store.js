import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { nowIso } from './db.js';

export const sha1 = (value) => createHash('sha1').update(value).digest('hex');
export const sha256 = (value) => createHash('sha256').update(value).digest('hex');

const safeSegment = (value) => String(value).replace(/[^A-Za-z0-9._@-]+/g, '_').slice(0, 80);

/** Files are content-addressed or key-addressed, so rewriting the same item never duplicates data. */
export function createSourceFiles(rootDir) {
  const write = (path, data) => {
    if (existsSync(path)) return path;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, data, { flag: 'wx' });
    return path;
  };
  return {
    rootDir,
    saveEml(accountId, key, hash, raw) {
      const name = sha1(key);
      return write(join(rootDir, 'mail', safeSegment(accountId), name.slice(0, 2), `${name}-${hash.slice(0, 8)}.eml`), raw);
    },
    saveAttachment(data, filename) {
      const digest = sha256(data);
      const ext = extname(String(filename)).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 10);
      return { sha256: digest, path: write(join(rootDir, 'attachments', digest.slice(0, 2), `${digest}${ext}`), data), size: data.length };
    },
  };
}

/** Attachment metadata rows; the same file under the same source is stored once. */
export function recordAttachment(db, { sourceType, sourceId, filename, mime = null, size = null, sha256: digest = null, path = null, url = null }) {
  db.prepare(`INSERT OR IGNORE INTO source_attachments (id, source_type, source_id, filename, mime, size, sha256, path, url, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(randomUUID(), sourceType, sourceId, String(filename).slice(0, 300), mime, size, digest ?? '', path, url, nowIso());
}

export const attachmentsOf = (db, sourceType, sourceId) => db.prepare(
  'SELECT id, filename, mime, size, sha256, (path IS NOT NULL) AS stored, url FROM source_attachments WHERE source_type = ? AND source_id = ? ORDER BY filename',
).all(sourceType, sourceId).map((a) => ({ ...a, stored: Boolean(a.stored) }));

/**
 * Hands a new or changed school item to the YOLO task manager through the
 * normal inbox. The dedupe key carries the content hash, so only real content
 * changes (never read-state or folder moves) trigger another analysis.
 */
export function enqueueForAi(store, { kind, sourceId, hash, text, url = null, receivedAt }) {
  const { item, duplicate } = store.inbox.capture({
    text: text.slice(0, 20000),
    dedupe_key: `${kind}:${sourceId}:${hash.slice(0, 12)}`,
    source_ref: `${kind}:${sourceId}`,
    source_url: url,
    received_at: receivedAt,
  }, kind);
  return duplicate ? null : item.id;
}

export const parseCursor = (state) => { try { return JSON.parse(state.cursor ?? '{}') ?? {}; } catch { return {}; } };
