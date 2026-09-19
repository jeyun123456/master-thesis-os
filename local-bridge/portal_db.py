"""SQLite persistence for Ritsumei student portal notices.

The portal database is deliberately separate from the mail-analysis database.
The portal session is kept by Playwright; this module stores only notice data
and synchronization metadata, never portal credentials or browser cookies.
"""

from __future__ import annotations

import hashlib
import json
import os
import sqlite3
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path


NOTICE_TYPES = ("ALL", "DM")
SYNC_STATUSES = ("idle", "running", "completed", "failed")
AI_STATUSES = ("idle", "queued", "processing", "completed", "failed")
CANDIDATE_STATUSES = ("pending", "added", "ignored")
CANDIDATE_TYPES = ("event", "deadline")
SOURCE = "ritsumei"
SYNC_INTERRUPTED_CODE = "sync_interrupted"
DEFAULT_DB_PATH = Path(__file__).resolve().parent / "data" / "portal-notices.db"


class PortalDatabaseError(RuntimeError):
    """Safe database error for the bridge and CLI."""


@dataclass(frozen=True)
class NoticeUpsertResult:
    notice_id: str
    inserted: bool
    changed: bool = False


SCHEMA = """
CREATE TABLE IF NOT EXISTS portal_notices (
    notice_id TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK(type IN ('ALL', 'DM')),
    title TEXT NOT NULL DEFAULT '',
    department TEXT NOT NULL DEFAULT '',
    published_at TEXT NOT NULL DEFAULT '',
    expires_at TEXT NOT NULL DEFAULT '',
    deadline TEXT NOT NULL DEFAULT '',
    importance TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    source_url TEXT NOT NULL DEFAULT '',
    synced_at TEXT NOT NULL,
    detail_synced_at TEXT,
    detail_error TEXT,
    summary_hash TEXT NOT NULL DEFAULT '',
    content_hash TEXT NOT NULL DEFAULT '',
    last_changed_at TEXT,
    change_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_portal_notices_type_published
    ON portal_notices(type, published_at DESC, synced_at DESC);

CREATE TABLE IF NOT EXISTS portal_notice_attachments (
    id TEXT PRIMARY KEY,
    notice_id TEXT NOT NULL REFERENCES portal_notices(notice_id) ON DELETE CASCADE,
    filename TEXT NOT NULL DEFAULT '',
    url TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_portal_notice_attachments_notice
    ON portal_notice_attachments(notice_id);

CREATE TABLE IF NOT EXISTS portal_notice_ai (
    notice_id TEXT PRIMARY KEY REFERENCES portal_notices(notice_id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK(status IN ('queued', 'processing', 'completed', 'failed')),
    summary TEXT,
    translation TEXT,
    error_code TEXT,
    error TEXT,
    analyzed_at TEXT,
    prompt_version TEXT,
    model TEXT,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_portal_notice_ai_status
    ON portal_notice_ai(status);

CREATE TABLE IF NOT EXISTS portal_notice_calendar_candidates (
    id TEXT PRIMARY KEY,
    notice_id TEXT NOT NULL REFERENCES portal_notices(notice_id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    start TEXT,
    end TEXT,
    all_day INTEGER NOT NULL DEFAULT 0,
    type TEXT NOT NULL CHECK(type IN ('event', 'deadline')),
    reason TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL CHECK(status IN ('pending', 'added', 'ignored')),
    calendar_event_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_portal_notice_calendar_candidates_notice
    ON portal_notice_calendar_candidates(notice_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_portal_notice_calendar_candidates_event
    ON portal_notice_calendar_candidates(calendar_event_id)
    WHERE calendar_event_id IS NOT NULL AND calendar_event_id <> '';

CREATE TABLE IF NOT EXISTS portal_notice_user_state (
    notice_id TEXT PRIMARY KEY REFERENCES portal_notices(notice_id) ON DELETE CASCADE,
    is_read INTEGER NOT NULL DEFAULT 0 CHECK(is_read IN (0, 1)),
    is_important INTEGER NOT NULL DEFAULT 0 CHECK(is_important IN (0, 1)),
    is_archived INTEGER NOT NULL DEFAULT 0 CHECK(is_archived IN (0, 1)),
    first_seen_at TEXT NOT NULL,
    read_at TEXT,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_portal_notice_user_state_flags
    ON portal_notice_user_state(is_read, is_important, is_archived);

CREATE TABLE IF NOT EXISTS portal_sync_state (
    source TEXT PRIMARY KEY,
    last_sync_at TEXT,
    status TEXT NOT NULL DEFAULT 'idle' CHECK(status IN ('idle', 'running', 'completed', 'failed')),
    last_error_code TEXT,
    last_error TEXT,
    total_count INTEGER NOT NULL DEFAULT 0,
    new_count INTEGER NOT NULL DEFAULT 0,
    updated_count INTEGER NOT NULL DEFAULT 0,
    detail_failed_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS portal_sync_runs (
    sync_id TEXT PRIMARY KEY,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    status TEXT NOT NULL CHECK(status IN ('running', 'completed', 'failed')),
    total_count INTEGER NOT NULL DEFAULT 0,
    new_count INTEGER NOT NULL DEFAULT 0,
    updated_count INTEGER NOT NULL DEFAULT 0,
    detail_count INTEGER NOT NULL DEFAULT 0,
    detail_failed_count INTEGER NOT NULL DEFAULT 0,
    error_code TEXT,
    error TEXT
);

CREATE INDEX IF NOT EXISTS idx_portal_sync_runs_started
    ON portal_sync_runs(started_at DESC);
"""


def now_iso(now: datetime | None = None) -> str:
    value = now or datetime.now(timezone.utc)
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def resolve_db_path(path: str | Path | None = None) -> Path:
    if path is None:
        raw = os.environ.get("PORTAL_NOTICES_DB_PATH", "").strip()
        path = Path(raw).expanduser() if raw else DEFAULT_DB_PATH
    return Path(path).expanduser().resolve(strict=False)


def _notice_type(value: object) -> str:
    normalized = str(value or "").strip().upper()
    if normalized not in NOTICE_TYPES:
        raise PortalDatabaseError("unsupported portal notice type")
    return normalized


def _ai_status(value: object) -> str:
    normalized = str(value or "").strip().lower()
    if normalized not in AI_STATUSES:
        raise PortalDatabaseError("unsupported portal notice AI status")
    return normalized


def _candidate_status(value: object) -> str:
    normalized = str(value or "").strip().lower()
    if normalized not in CANDIDATE_STATUSES:
        raise PortalDatabaseError("unsupported portal notice calendar candidate status")
    return normalized


def _candidate_type(value: object) -> str:
    normalized = str(value or "").strip().lower()
    if normalized not in CANDIDATE_TYPES:
        raise PortalDatabaseError("unsupported portal notice calendar candidate type")
    return normalized


def _text(value: object) -> str:
    return str(value or "").strip()


def _notice_id(value: object) -> str:
    notice_id = _text(value)
    if not notice_id or len(notice_id) > 512:
        raise PortalDatabaseError("invalid portal notice id")
    return notice_id


def _normalized_body(value: object) -> str:
    return "\n".join(
        line.rstrip()
        for line in _text(value).replace("\r\n", "\n").replace("\r", "\n").split("\n")
    ).strip()


def notice_content_hash(value: object) -> str:
    return hashlib.sha256(_normalized_body(value).encode("utf-8")).hexdigest()


def notice_summary_hash(notice: Mapping[str, object]) -> str:
    values = [
        _notice_id(notice.get("notice_id")),
        _notice_type(notice.get("type")),
        _text(notice.get("title")),
        _text(notice.get("department")),
        _text(notice.get("published_at")),
        _text(notice.get("expires_at")),
        _text(notice.get("deadline")),
        _text(notice.get("importance")),
        _text(notice.get("category")),
        _text(notice.get("source_url")),
    ]
    return hashlib.sha256(
        json.dumps(values, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    ).hexdigest()


def _connect(path: str | Path | None = None) -> sqlite3.Connection:
    db_path = resolve_db_path(path)
    try:
        db_path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(str(db_path), timeout=30)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA busy_timeout = 30000")
        connection.execute("PRAGMA journal_mode = WAL")
        connection.executescript(SCHEMA)
        existing_columns = {
            str(row["name"])
            for row in connection.execute("PRAGMA table_info(portal_notices)").fetchall()
        }
        if "detail_synced_at" not in existing_columns:
            connection.execute("ALTER TABLE portal_notices ADD COLUMN detail_synced_at TEXT")
        if "detail_error" not in existing_columns:
            connection.execute("ALTER TABLE portal_notices ADD COLUMN detail_error TEXT")
        if "summary_hash" not in existing_columns:
            connection.execute("ALTER TABLE portal_notices ADD COLUMN summary_hash TEXT NOT NULL DEFAULT ''")
        if "content_hash" not in existing_columns:
            connection.execute("ALTER TABLE portal_notices ADD COLUMN content_hash TEXT NOT NULL DEFAULT ''")
        if "last_changed_at" not in existing_columns:
            connection.execute("ALTER TABLE portal_notices ADD COLUMN last_changed_at TEXT")
        if "change_count" not in existing_columns:
            connection.execute("ALTER TABLE portal_notices ADD COLUMN change_count INTEGER NOT NULL DEFAULT 0")
        sync_columns = {
            str(row["name"])
            for row in connection.execute("PRAGMA table_info(portal_sync_state)").fetchall()
        }
        if "updated_count" not in sync_columns:
            connection.execute("ALTER TABLE portal_sync_state ADD COLUMN updated_count INTEGER NOT NULL DEFAULT 0")
        # Existing installations predate hash-based change detection. Leave
        # their new hash columns empty so the first sync establishes a
        # baseline from the live portal instead of treating legacy formatting
        # differences as edits. Rows with an empty content hash are also
        # deliberately revalidated once by notice_ids_needing_detail().
        connection.execute(
            "INSERT OR IGNORE INTO portal_sync_state(source) VALUES (?)",
            (SOURCE,),
        )
        migration_now = now_iso()
        connection.execute(
            """
            INSERT OR IGNORE INTO portal_notice_user_state(
                notice_id, first_seen_at, updated_at
            )
            SELECT notice_id, COALESCE(NULLIF(synced_at, ''), ?),
                   COALESCE(NULLIF(synced_at, ''), ?)
              FROM portal_notices
            """,
            (migration_now, migration_now),
        )
        connection.commit()
        return connection
    except (OSError, sqlite3.Error) as exc:
        raise PortalDatabaseError("portal database is unavailable") from exc


def initialize_database(path: str | Path | None = None) -> Path:
    connection = _connect(path)
    connection.close()
    return resolve_db_path(path)


def _attachment_id(notice_id: str, filename: str, url: str, index: int) -> str:
    raw = "\0".join((notice_id, filename, url, str(index)))
    return "portal-attachment:" + hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _ai_payload(row: sqlite3.Row | None, notice_id: str) -> dict[str, object]:
    if row is None or "ai_status" not in row.keys() or row["ai_status"] is None:
        return {
            "noticeId": notice_id,
            "status": "idle",
            "summary": None,
            "translation": None,
            "errorCode": None,
            "error": None,
            "analyzedAt": None,
            "promptVersion": None,
            "model": None,
        }
    return {
        "noticeId": notice_id,
        "status": _ai_status(row["ai_status"]),
        "summary": row["ai_summary"],
        "translation": row["ai_translation"],
        "errorCode": row["ai_error_code"],
        "error": row["ai_error"],
        "analyzedAt": row["ai_analyzed_at"],
        "promptVersion": row["ai_prompt_version"],
        "model": row["ai_model"],
    }


def _candidate_payload(row: sqlite3.Row) -> dict[str, object]:
    return {
        "id": str(row["id"]),
        "noticeId": str(row["notice_id"]),
        "title": str(row["title"] or ""),
        "start": str(row["start"] or ""),
        "end": str(row["end"] or "") or None,
        "allDay": bool(int(row["all_day"] or 0)),
        "type": _candidate_type(row["type"]),
        "reason": str(row["reason"] or ""),
        "status": _candidate_status(row["status"]),
        "calendarEventId": str(row["calendar_event_id"] or "") or None,
    }


def _notice_payload(
    row: sqlite3.Row,
    attachments: Iterable[sqlite3.Row] = (),
    *,
    include_body: bool = True,
) -> dict[str, object]:
    row_keys = set(row.keys())

    def state_text(key: str) -> str:
        return str(row[key] or '') if key in row_keys else ''

    def state_bool(key: str) -> bool:
        return bool(int(row[key] or 0)) if key in row_keys else False

    payload: dict[str, object] = {
        "noticeId": str(row["notice_id"]),
        "type": str(row["type"]),
        "title": str(row["title"] or ""),
        "department": str(row["department"] or ""),
        "publishedAt": str(row["published_at"] or ""),
        "expiresAt": str(row["expires_at"] or ""),
        "deadline": str(row["deadline"] or ""),
        "importance": str(row["importance"] or ""),
        "category": str(row["category"] or ""),
        "sourceUrl": str(row["source_url"] or ""),
        "syncedAt": str(row["synced_at"] or ""),
        "isRead": state_bool("is_read"),
        "isImportant": state_bool("is_important"),
        "isArchived": state_bool("is_archived"),
        "firstSeenAt": state_text("first_seen_at"),
        "readAt": row["read_at"] if "read_at" in row_keys and row["read_at"] else None,
        "stateUpdatedAt": state_text("updated_at"),
        "lastChangedAt": row["last_changed_at"] if "last_changed_at" in row_keys and row["last_changed_at"] else None,
        "changeCount": int(row["change_count"] or 0) if "change_count" in row_keys else 0,
        "attachments": [
            {
                "id": str(attachment["id"]),
                "noticeId": str(attachment["notice_id"]),
                "filename": str(attachment["filename"] or ""),
                "url": str(attachment["url"] or ""),
            }
            for attachment in attachments
        ],
    }
    if include_body:
        payload["body"] = str(row["body"] or "")
    else:
        # Keep the rendered list fields separate while allowing the local UI
        # to search notice bodies without fetching every detail again.
        payload["searchText"] = str(row["body"] or "")
    if "ai_status" in row_keys:
        payload["ai"] = _ai_payload(row, str(row["notice_id"]))
    return payload


def _summary_values(notice: Mapping[str, object], synced_at: str) -> tuple[object, ...]:
    return (
        _notice_id(notice.get("notice_id")),
        _notice_type(notice.get("type")),
        _text(notice.get("title")),
        _text(notice.get("department")),
        _text(notice.get("published_at")),
        _text(notice.get("expires_at")),
        _text(notice.get("deadline")),
        _text(notice.get("importance")),
        _text(notice.get("category")),
        _text(notice.get("source_url")),
        notice_summary_hash(notice),
        _text(synced_at),
    )


def _ensure_notice_state(
    connection: sqlite3.Connection,
    notice_id: str,
    first_seen_at: str,
) -> None:
    observed_at = _text(first_seen_at) or now_iso()
    connection.execute(
        """
        INSERT OR IGNORE INTO portal_notice_user_state(
            notice_id, first_seen_at, updated_at
        ) VALUES (?, ?, ?)
        """,
        (notice_id, observed_at, observed_at),
    )


def upsert_notice_summary(
    notice: Mapping[str, object],
    synced_at: str,
    path: str | Path | None = None,
) -> NoticeUpsertResult:
    values = _summary_values(notice, synced_at)
    connection = _connect(path)
    try:
        existing = connection.execute(
            "SELECT * FROM portal_notices WHERE notice_id = ?",
            (values[0],),
        ).fetchone()
        summary_hash_value = str(values[10])
        if existing is not None:
            effective_notice = dict(notice)
            for notice_key, column in (
                ("title", "title"),
                ("department", "department"),
                ("published_at", "published_at"),
                ("expires_at", "expires_at"),
                ("importance", "importance"),
                ("category", "category"),
                ("source_url", "source_url"),
            ):
                if not _text(effective_notice.get(notice_key)):
                    effective_notice[notice_key] = existing[column]
            summary_hash_value = notice_summary_hash(effective_notice)
            values = (*values[:10], summary_hash_value, values[11])
        existing_summary_hash = str(existing["summary_hash"] or "") if existing is not None else ""
        summary_changed = bool(
            existing is not None
            and existing_summary_hash
            and existing_summary_hash != summary_hash_value
        )
        connection.execute(
            """
            INSERT INTO portal_notices(
                notice_id, type, title, department, published_at, expires_at,
                deadline, importance, category, source_url, summary_hash, synced_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(notice_id) DO UPDATE SET
                type = excluded.type,
                title = CASE WHEN excluded.title <> '' THEN excluded.title ELSE portal_notices.title END,
                department = CASE WHEN excluded.department <> '' THEN excluded.department ELSE portal_notices.department END,
                published_at = CASE WHEN excluded.published_at <> '' THEN excluded.published_at ELSE portal_notices.published_at END,
                expires_at = CASE WHEN excluded.expires_at <> '' THEN excluded.expires_at ELSE portal_notices.expires_at END,
                -- The list JSON is the canonical deadline source. Allow an
                -- empty current value to clear stale detail/footer text.
                deadline = excluded.deadline,
                importance = CASE WHEN excluded.importance <> '' THEN excluded.importance ELSE portal_notices.importance END,
                category = CASE WHEN excluded.category <> '' THEN excluded.category ELSE portal_notices.category END,
                source_url = CASE WHEN excluded.source_url <> '' THEN excluded.source_url ELSE portal_notices.source_url END,
                summary_hash = excluded.summary_hash,
                synced_at = excluded.synced_at
            """,
            values,
        )
        if summary_changed:
            connection.execute(
                """
                UPDATE portal_notices
                   SET last_changed_at = ?,
                       change_count = COALESCE(change_count, 0) + 1,
                       detail_synced_at = NULL,
                       detail_error = NULL
                 WHERE notice_id = ?
                """,
                (_text(values[11]), values[0]),
            )
        _ensure_notice_state(connection, str(values[0]), str(values[11]))
        connection.commit()
        return NoticeUpsertResult(str(values[0]), existing is None, summary_changed)
    except PortalDatabaseError:
        connection.rollback()
        raise
    except sqlite3.Error as exc:
        connection.rollback()
        raise PortalDatabaseError("portal notice could not be saved") from exc
    finally:
        connection.close()


def upsert_notice_detail(
    notice: Mapping[str, object],
    attachments: Iterable[Mapping[str, object]],
    synced_at: str,
    path: str | Path | None = None,
    *,
    summary_changed: bool = False,
) -> NoticeUpsertResult:
    values = _summary_values(notice, synced_at)
    body = _text(notice.get("body"))
    content_hash_value = notice_content_hash(body)
    connection = _connect(path)
    try:
        existing = connection.execute(
            "SELECT * FROM portal_notices WHERE notice_id = ?",
            (values[0],),
        ).fetchone()
        content_changed = bool(
            existing is not None
            and existing["detail_synced_at"] is not None
            and str(existing["content_hash"] or "")
            and str(existing["content_hash"] or "") != content_hash_value
        )
        # The list response is the canonical source for summary metadata. A
        # detail page can render equivalent fields with different formatting,
        # so never replace the list hash with a detail-derived hash. This
        # keeps a successful detail fetch from looking like a summary change
        # on the next sync.
        summary_hash_value = (
            str(existing["summary_hash"] or "")
            if existing is not None and str(existing["summary_hash"] or "")
            else str(values[10])
        )
        changed = bool(existing is not None and content_changed and not summary_changed)
        connection.execute(
            """
            INSERT INTO portal_notices(
                notice_id, type, title, department, published_at, expires_at,
                deadline, importance, category, body, source_url, summary_hash,
                content_hash, synced_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(notice_id) DO UPDATE SET
                type = excluded.type,
                title = excluded.title,
                department = excluded.department,
                published_at = excluded.published_at,
                expires_at = excluded.expires_at,
                deadline = excluded.deadline,
                importance = excluded.importance,
                category = excluded.category,
                body = excluded.body,
                source_url = excluded.source_url,
                summary_hash = excluded.summary_hash,
                content_hash = excluded.content_hash,
                synced_at = excluded.synced_at
            """,
            (*values[:9], body, values[9], summary_hash_value, content_hash_value, values[11]),
        )
        if changed:
            connection.execute(
                """
                UPDATE portal_notices
                   SET last_changed_at = ?,
                       change_count = COALESCE(change_count, 0) + 1
                 WHERE notice_id = ?
                """,
                (_text(values[11]), values[0]),
            )
        _ensure_notice_state(connection, str(values[0]), str(values[11]))
        connection.execute(
            "UPDATE portal_notices SET detail_synced_at = ?, detail_error = NULL WHERE notice_id = ?",
            (_text(synced_at), values[0]),
        )
        connection.execute(
            "DELETE FROM portal_notice_attachments WHERE notice_id = ?",
            (values[0],),
        )
        for index, attachment in enumerate(attachments):
            filename = _text(attachment.get("filename"))
            url = _text(attachment.get("url"))
            attachment_id = _text(attachment.get("id")) or _attachment_id(str(values[0]), filename, url, index)
            connection.execute(
                "INSERT OR REPLACE INTO portal_notice_attachments(id, notice_id, filename, url) VALUES (?, ?, ?, ?)",
                (attachment_id, values[0], filename, url),
            )
        connection.commit()
        return NoticeUpsertResult(str(values[0]), existing is None, changed)
    except PortalDatabaseError:
        connection.rollback()
        raise
    except sqlite3.Error as exc:
        connection.rollback()
        raise PortalDatabaseError("portal notice detail could not be saved") from exc
    finally:
        connection.close()


def notice_exists(notice_id: str, path: str | Path | None = None) -> bool:
    normalized = _notice_id(notice_id)
    connection = _connect(path)
    try:
        return connection.execute(
            "SELECT 1 FROM portal_notices WHERE notice_id = ?",
            (normalized,),
        ).fetchone() is not None
    finally:
        connection.close()


def existing_notice_ids(notice_ids: Iterable[str], path: str | Path | None = None) -> set[str]:
    normalized = [_notice_id(value) for value in notice_ids]
    if not normalized:
        return set()
    connection = _connect(path)
    try:
        placeholders = ",".join("?" for _ in normalized)
        rows = connection.execute(
            f"SELECT notice_id FROM portal_notices WHERE notice_id IN ({placeholders})",
            normalized,
        ).fetchall()
        return {str(row["notice_id"]) for row in rows}
    finally:
        connection.close()


def notice_ids_needing_detail(
    notice_ids: Iterable[str],
    path: str | Path | None = None,
    *,
    refresh_before: str | None = None,
) -> set[str]:
    normalized = [_notice_id(value) for value in notice_ids]
    if not normalized:
        return set()
    connection = _connect(path)
    try:
        placeholders = ",".join("?" for _ in normalized)
        parameters: list[object] = [*normalized]
        refresh_clause = "(detail_synced_at IS NULL OR content_hash = '')"
        if refresh_before:
            refresh_clause = "(detail_synced_at IS NULL OR content_hash = '' OR detail_synced_at < ?)"
            parameters.append(_text(refresh_before))
        rows = connection.execute(
            f"SELECT notice_id FROM portal_notices WHERE notice_id IN ({placeholders}) AND {refresh_clause}",
            parameters,
        ).fetchall()
        return {str(row["notice_id"]) for row in rows}
    finally:
        connection.close()


def mark_detail_error(
    notice_id: str,
    error: str,
    *,
    path: str | Path | None = None,
) -> None:
    normalized = _notice_id(notice_id)
    connection = _connect(path)
    try:
        connection.execute(
            "UPDATE portal_notices SET detail_error = ? WHERE notice_id = ?",
            (_text(error)[:1000], normalized),
        )
        connection.commit()
    except sqlite3.Error as exc:
        connection.rollback()
        raise PortalDatabaseError("portal detail error could not be saved") from exc
    finally:
        connection.close()


def queue_notice_analysis(
    notice_id: str,
    path: str | Path | None = None,
    *,
    force: bool = False,
) -> bool:
    normalized = _notice_id(notice_id)
    connection = _connect(path)
    try:
        exists = connection.execute(
            "SELECT 1 FROM portal_notices WHERE notice_id = ?",
            (normalized,),
        ).fetchone()
        if exists is None:
            raise PortalDatabaseError("portal notice not found")
        current = connection.execute(
            "SELECT status FROM portal_notice_ai WHERE notice_id = ?",
            (normalized,),
        ).fetchone()
        current_status = str(current["status"]) if current else "idle"
        if current_status in {"queued", "processing"}:
            return False
        if current_status == "completed" and not force:
            return False
        observed_at = now_iso()
        connection.execute(
            """
            INSERT INTO portal_notice_ai(
                notice_id, status, summary, translation, error_code, error,
                analyzed_at, prompt_version, model, updated_at
            ) VALUES (?, 'queued', NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?)
            ON CONFLICT(notice_id) DO UPDATE SET
                status = 'queued',
                error_code = NULL,
                error = NULL,
                updated_at = excluded.updated_at
            """,
            (normalized, observed_at),
        )
        connection.commit()
        return True
    except PortalDatabaseError:
        connection.rollback()
        raise
    except sqlite3.Error as exc:
        connection.rollback()
        raise PortalDatabaseError("portal notice AI analysis could not be queued") from exc
    finally:
        connection.close()


def claim_notice_analysis(notice_id: str, path: str | Path | None = None) -> bool:
    normalized = _notice_id(notice_id)
    connection = _connect(path)
    try:
        cursor = connection.execute(
            """
            UPDATE portal_notice_ai
               SET status = 'processing', error_code = NULL, error = NULL,
                   updated_at = ?
             WHERE notice_id = ? AND status = 'queued'
            """,
            (now_iso(), normalized),
        )
        connection.commit()
        return cursor.rowcount > 0
    except sqlite3.Error as exc:
        connection.rollback()
        raise PortalDatabaseError("portal notice AI analysis could not start") from exc
    finally:
        connection.close()


def recover_interrupted_ai(path: str | Path | None = None) -> int:
    connection = _connect(path)
    try:
        recovered_at = now_iso()
        cursor = connection.execute(
            """
            UPDATE portal_notice_ai
               SET status = 'failed', error_code = 'ai_interrupted',
                   error = ?, updated_at = ?
             WHERE status IN ('queued', 'processing')
            """,
            ("이전 공지 AI 분석이 정상적으로 끝나지 않아 중단 상태로 정리했어.", recovered_at),
        )
        connection.commit()
        return cursor.rowcount
    except sqlite3.Error as exc:
        connection.rollback()
        raise PortalDatabaseError("portal notice AI state could not be recovered") from exc
    finally:
        connection.close()


def save_notice_analysis(
    notice_id: str,
    result: Mapping[str, object],
    prompt_version: str,
    model: str,
    analyzed_at: str,
    path: str | Path | None = None,
) -> None:
    normalized = _notice_id(notice_id)
    summary = _text(result.get("summary"))
    translation = _text(result.get("translation"))
    raw_candidates = result.get("calendarCandidates")
    candidates = raw_candidates if isinstance(raw_candidates, list) else []
    connection = _connect(path)
    try:
        connection.execute("BEGIN IMMEDIATE")
        exists = connection.execute(
            "SELECT 1 FROM portal_notices WHERE notice_id = ?",
            (normalized,),
        ).fetchone()
        if exists is None:
            raise PortalDatabaseError("portal notice not found")
        connection.execute(
            """
            UPDATE portal_notice_ai
               SET status = 'completed', summary = ?, translation = ?,
                   error_code = NULL, error = NULL, analyzed_at = ?,
                   prompt_version = ?, model = ?, updated_at = ?
             WHERE notice_id = ?
            """,
            (summary, translation, _text(analyzed_at), _text(prompt_version), _text(model), now_iso(), normalized),
        )
        candidate_ids: list[str] = []
        for candidate in candidates:
            if not isinstance(candidate, Mapping):
                continue
            candidate_id = _text(candidate.get("id"))
            title = _text(candidate.get("title"))
            start = _text(candidate.get("start"))
            if not candidate_id or not title or not start:
                continue
            candidate_ids.append(candidate_id)
            existing = connection.execute(
                "SELECT status, calendar_event_id FROM portal_notice_calendar_candidates WHERE id = ? AND notice_id = ?",
                (candidate_id, normalized),
            ).fetchone()
            status = str(existing["status"]) if existing and str(existing["status"]) in CANDIDATE_STATUSES else "pending"
            event_id = str(existing["calendar_event_id"] or "") if existing else ""
            connection.execute(
                """
                INSERT INTO portal_notice_calendar_candidates(
                    id, notice_id, title, start, end, all_day, type, reason,
                    status, calendar_event_id
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    notice_id = excluded.notice_id,
                    title = excluded.title,
                    start = excluded.start,
                    end = excluded.end,
                    all_day = excluded.all_day,
                    type = excluded.type,
                    reason = excluded.reason,
                    status = excluded.status,
                    calendar_event_id = excluded.calendar_event_id
                """,
                (
                    candidate_id,
                    normalized,
                    title[:500],
                    start[:100],
                    _text(candidate.get("end"))[:100] or None,
                    1 if candidate.get("allDay") is True else 0,
                    "deadline" if candidate.get("type") == "deadline" else "event",
                    _text(candidate.get("reason"))[:500],
                    status,
                    event_id or None,
                ),
            )
        if candidate_ids:
            placeholders = ",".join("?" for _ in candidate_ids)
            connection.execute(
                f"DELETE FROM portal_notice_calendar_candidates WHERE notice_id = ? AND status = 'pending' AND id NOT IN ({placeholders})",
                [normalized, *candidate_ids],
            )
        else:
            connection.execute(
                "DELETE FROM portal_notice_calendar_candidates WHERE notice_id = ? AND status = 'pending'",
                (normalized,),
            )
        connection.commit()
    except PortalDatabaseError:
        connection.rollback()
        raise
    except sqlite3.Error as exc:
        connection.rollback()
        raise PortalDatabaseError("portal notice AI analysis could not be saved") from exc
    finally:
        connection.close()


def save_notice_analysis_failed(
    notice_id: str,
    error_code: str,
    error: str,
    path: str | Path | None = None,
) -> None:
    normalized = _notice_id(notice_id)
    connection = _connect(path)
    try:
        connection.execute(
            """
            UPDATE portal_notice_ai
               SET status = 'failed', error_code = ?, error = ?, updated_at = ?
             WHERE notice_id = ?
            """,
            (_text(error_code)[:100], _text(error)[:1000], now_iso(), normalized),
        )
        connection.commit()
    except sqlite3.Error as exc:
        connection.rollback()
        raise PortalDatabaseError("portal notice AI failure could not be saved") from exc
    finally:
        connection.close()


def update_notice_calendar_candidate(
    notice_id: str,
    candidate_id: str,
    status: str,
    *,
    title: str | None = None,
    start: str | None = None,
    end: str | None = None,
    all_day: bool | None = None,
    calendar_event_id: str | None = None,
    path: str | Path | None = None,
) -> dict[str, object]:
    normalized_notice_id = _notice_id(notice_id)
    normalized_candidate_id = _text(candidate_id)
    if not normalized_candidate_id or len(normalized_candidate_id) > 256:
        raise PortalDatabaseError("invalid portal notice calendar candidate id")
    normalized_status = _candidate_status(status)
    connection = _connect(path)
    try:
        row = connection.execute(
            "SELECT * FROM portal_notice_calendar_candidates WHERE id = ? AND notice_id = ?",
            (normalized_candidate_id, normalized_notice_id),
        ).fetchone()
        if row is None:
            raise PortalDatabaseError("portal notice calendar candidate not found")
        next_title = _text(title) if title is not None else str(row["title"] or "")
        next_start = _text(start) if start is not None else str(row["start"] or "")
        next_end = _text(end) if end is not None else (str(row["end"] or "") or None)
        next_all_day = all_day if all_day is not None else bool(int(row["all_day"] or 0))
        next_event_id = _text(calendar_event_id) if calendar_event_id is not None else (str(row["calendar_event_id"] or "") or None)
        if not next_title or not next_start:
            raise PortalDatabaseError("portal notice calendar candidate requires title and start")
        connection.execute(
            """
            UPDATE portal_notice_calendar_candidates
               SET title = ?, start = ?, end = ?, all_day = ?, status = ?, calendar_event_id = ?
             WHERE id = ? AND notice_id = ?
            """,
            (next_title[:500], next_start[:100], next_end[:100] if next_end else None, 1 if next_all_day else 0, normalized_status, next_event_id, normalized_candidate_id, normalized_notice_id),
        )
        updated = connection.execute(
            "SELECT * FROM portal_notice_calendar_candidates WHERE id = ? AND notice_id = ?",
            (normalized_candidate_id, normalized_notice_id),
        ).fetchone()
        connection.commit()
        if updated is None:
            raise PortalDatabaseError("portal notice calendar candidate could not be updated")
        return _candidate_payload(updated)
    except PortalDatabaseError:
        connection.rollback()
        raise
    except sqlite3.Error as exc:
        connection.rollback()
        raise PortalDatabaseError("portal notice calendar candidate could not be updated") from exc
    finally:
        connection.close()


def _attachments_for(connection: sqlite3.Connection, notice_id: str) -> list[sqlite3.Row]:
    return connection.execute(
        "SELECT id, notice_id, filename, url FROM portal_notice_attachments WHERE notice_id = ? ORDER BY id",
        (notice_id,),
    ).fetchall()


def _calendar_candidates_for(connection: sqlite3.Connection, notice_id: str) -> list[sqlite3.Row]:
    return connection.execute(
        "SELECT id, notice_id, title, start, end, all_day, type, reason, status, calendar_event_id "
        "FROM portal_notice_calendar_candidates WHERE notice_id = ? ORDER BY rowid",
        (notice_id,),
    ).fetchall()


def list_notices(
    path: str | Path | None = None,
    *,
    notice_type: str | None = None,
    department: str | None = None,
    limit: int = 100,
) -> list[dict[str, object]]:
    normalized_type = _notice_type(notice_type) if notice_type else None
    normalized_department = _text(department) if department is not None else None
    capped_limit = max(1, min(500, int(limit)))
    connection = _connect(path)
    try:
        conditions: list[str] = []
        parameters: list[object] = []
        if normalized_type:
            conditions.append("n.type = ?")
            parameters.append(normalized_type)
        if normalized_department is not None:
            conditions.append("n.department = ?")
            parameters.append(normalized_department)
        where = f"WHERE {' AND '.join(conditions)}" if conditions else ''
        parameters.append(capped_limit)
        rows = connection.execute(
            f"""
            SELECT n.notice_id, n.type, n.title, n.department, n.published_at,
                   n.expires_at, n.deadline, n.importance, n.category, n.body,
                   n.source_url, n.synced_at,
                   n.last_changed_at, n.change_count,
                   s.is_read, s.is_important, s.is_archived, s.first_seen_at,
                   s.read_at, s.updated_at
              FROM portal_notices AS n
              LEFT JOIN portal_notice_user_state AS s ON s.notice_id = n.notice_id
              {where}
             ORDER BY n.published_at DESC, n.synced_at DESC, n.notice_id DESC
             LIMIT ?
            """,
            parameters,
        ).fetchall()
        return [_notice_payload(row, include_body=False) for row in rows]
    finally:
        connection.close()


def notice_departments(
    path: str | Path | None = None,
    *,
    notice_type: str | None = None,
) -> list[dict[str, object]]:
    normalized_type = _notice_type(notice_type) if notice_type else None
    connection = _connect(path)
    try:
        parameters: list[object] = []
        where = ''
        if normalized_type:
            where = 'WHERE type = ?'
            parameters.append(normalized_type)
        rows = connection.execute(
            f"""
            SELECT department AS value,
                   CASE WHEN TRIM(department) = '' THEN '담당부서 미상' ELSE department END AS name,
                   COUNT(*) AS count,
                   SUM(CASE WHEN type = 'ALL' THEN 1 ELSE 0 END) AS all_count,
                   SUM(CASE WHEN type = 'DM' THEN 1 ELSE 0 END) AS dm_count
              FROM portal_notices
              {where}
             GROUP BY department
             ORDER BY count DESC, name ASC
            """,
            parameters,
        ).fetchall()
        return [
            {
                'value': str(row['value'] or ''),
                'name': str(row['name'] or '담당부서 미상'),
                'count': int(row['count'] or 0),
                'counts': {
                    'ALL': int(row['all_count'] or 0),
                    'DM': int(row['dm_count'] or 0),
                },
            }
            for row in rows
        ]
    finally:
        connection.close()


def get_notice(notice_id: str, path: str | Path | None = None) -> dict[str, object] | None:
    normalized = _notice_id(notice_id)
    connection = _connect(path)
    try:
        row = connection.execute(
            """
            SELECT n.notice_id, n.type, n.title, n.department, n.published_at,
                   n.expires_at, n.deadline, n.importance, n.category, n.body,
                   n.source_url, n.synced_at,
                   n.last_changed_at, n.change_count,
                   s.is_read, s.is_important, s.is_archived, s.first_seen_at,
                   s.read_at, s.updated_at,
                   a.status AS ai_status, a.summary AS ai_summary,
                   a.translation AS ai_translation, a.error_code AS ai_error_code,
                   a.error AS ai_error, a.analyzed_at AS ai_analyzed_at,
                   a.prompt_version AS ai_prompt_version, a.model AS ai_model
              FROM portal_notices AS n
              LEFT JOIN portal_notice_user_state AS s ON s.notice_id = n.notice_id
              LEFT JOIN portal_notice_ai AS a ON a.notice_id = n.notice_id
             WHERE n.notice_id = ?
            """,
            (normalized,),
        ).fetchone()
        if row is None:
            return None
        payload = _notice_payload(row, _attachments_for(connection, normalized), include_body=True)
        payload["calendarCandidates"] = [
            _candidate_payload(candidate)
            for candidate in _calendar_candidates_for(connection, normalized)
        ]
        return payload
    finally:
        connection.close()


def update_notice_state(
    notice_id: str,
    *,
    is_read: bool | None = None,
    is_important: bool | None = None,
    is_archived: bool | None = None,
    path: str | Path | None = None,
) -> dict[str, object]:
    normalized = _notice_id(notice_id)
    if is_read is None and is_important is None and is_archived is None:
        raise PortalDatabaseError('notice state update is empty')
    connection = _connect(path)
    try:
        exists = connection.execute(
            'SELECT synced_at FROM portal_notices WHERE notice_id = ?',
            (normalized,),
        ).fetchone()
        if exists is None:
            raise PortalDatabaseError('portal notice not found')
        _ensure_notice_state(connection, normalized, str(exists['synced_at'] or ''))
        updates: list[str] = []
        parameters: list[object] = []
        if is_read is not None:
            updates.append('is_read = ?')
            parameters.append(1 if is_read else 0)
            updates.append('read_at = ?')
            parameters.append(now_iso() if is_read else None)
        if is_important is not None:
            updates.append('is_important = ?')
            parameters.append(1 if is_important else 0)
        if is_archived is not None:
            updates.append('is_archived = ?')
            parameters.append(1 if is_archived else 0)
        updates.append('updated_at = ?')
        parameters.append(now_iso())
        parameters.append(normalized)
        connection.execute(
            f"UPDATE portal_notice_user_state SET {', '.join(updates)} WHERE notice_id = ?",
            parameters,
        )
        row = connection.execute(
            """
            SELECT n.notice_id, n.type, n.title, n.department, n.published_at,
                   n.expires_at, n.deadline, n.importance, n.category, n.body,
                   n.source_url, n.synced_at,
                   n.last_changed_at, n.change_count,
                   s.is_read, s.is_important, s.is_archived, s.first_seen_at,
                   s.read_at, s.updated_at,
                   a.status AS ai_status, a.summary AS ai_summary,
                   a.translation AS ai_translation, a.error_code AS ai_error_code,
                   a.error AS ai_error, a.analyzed_at AS ai_analyzed_at,
                   a.prompt_version AS ai_prompt_version, a.model AS ai_model
              FROM portal_notices AS n
              LEFT JOIN portal_notice_user_state AS s ON s.notice_id = n.notice_id
              LEFT JOIN portal_notice_ai AS a ON a.notice_id = n.notice_id
             WHERE n.notice_id = ?
            """,
            (normalized,),
        ).fetchone()
        payload = _notice_payload(row, _attachments_for(connection, normalized), include_body=True)
        payload["calendarCandidates"] = [
            _candidate_payload(candidate)
            for candidate in _calendar_candidates_for(connection, normalized)
        ]
        connection.commit()
        return payload
    except PortalDatabaseError:
        connection.rollback()
        raise
    except sqlite3.Error as exc:
        connection.rollback()
        raise PortalDatabaseError('portal notice state could not be saved') from exc
    finally:
        connection.close()


def begin_sync(
    path: str | Path | None = None,
    started_at: str | None = None,
) -> None:
    observed_at = _text(started_at) or now_iso()
    connection = _connect(path)
    try:
        connection.execute(
            """
            UPDATE portal_sync_state
               SET status = 'running', last_error_code = NULL, last_error = NULL,
                   total_count = 0, new_count = 0, updated_count = 0,
                   detail_failed_count = 0
             WHERE source = ?
            """,
            (SOURCE,),
        )
        connection.execute(
            """
            INSERT INTO portal_sync_runs(sync_id, started_at, status)
            VALUES (?, ?, 'running')
            """,
            (f"sync:{observed_at}", observed_at),
        )
        connection.commit()
    finally:
        connection.close()


def recover_interrupted_sync(path: str | Path | None = None) -> bool:
    """Mark a persisted running sync as interrupted after its owner stopped.

    The Bridge keeps live job state in memory. If the process is restarted
    while SQLite still says ``running``, the next status request must not leave
    the UI waiting forever. The caller checks for a live in-process job before
    invoking this recovery helper.
    """
    connection = _connect(path)
    try:
        recovered_at = now_iso()
        cursor = connection.execute(
            """
            UPDATE portal_sync_state
               SET status = 'failed', last_sync_at = ?,
                   last_error_code = ?,
                   last_error = ?
             WHERE source = ? AND status = 'running'
            """,
            (
                recovered_at,
                SYNC_INTERRUPTED_CODE,
                "이전 학교 공지 동기화가 정상적으로 끝나지 않아 중단 상태로 정리했어.",
                SOURCE,
            ),
        )
        connection.execute(
            """
            UPDATE portal_sync_runs
               SET status = 'failed', finished_at = ?, error_code = ?, error = ?
             WHERE sync_id = (
                 SELECT sync_id
                   FROM portal_sync_runs
                  WHERE status = 'running'
                  ORDER BY started_at DESC
                  LIMIT 1
             )
            """,
            (
                recovered_at,
                SYNC_INTERRUPTED_CODE,
                "이전 학교 공지 동기화가 정상적으로 끝나지 않아 중단 상태로 정리했어.",
            ),
        )
        connection.commit()
        return cursor.rowcount > 0
    finally:
        connection.close()


def finish_sync(
    last_sync_at: str,
    *,
    total_count: int,
    new_count: int,
    updated_count: int = 0,
    detail_count: int = 0,
    detail_failed_count: int,
    error_code: str | None = None,
    error: str | None = None,
    path: str | Path | None = None,
) -> None:
    connection = _connect(path)
    try:
        finished_at = now_iso()
        connection.execute(
            """
            UPDATE portal_sync_state
               SET status = 'completed', last_sync_at = ?, last_error_code = ?,
                   last_error = ?, total_count = ?, new_count = ?, updated_count = ?,
                   detail_failed_count = ?
             WHERE source = ?
            """,
            (
                _text(last_sync_at),
                _text(error_code) or None,
                _text(error) or None,
                max(0, int(total_count)),
                max(0, int(new_count)),
                max(0, int(updated_count)),
                max(0, int(detail_failed_count)),
                SOURCE,
            ),
        )
        connection.execute(
            """
            UPDATE portal_sync_runs
               SET status = 'completed', finished_at = ?, total_count = ?,
                   new_count = ?, updated_count = ?, detail_count = ?,
                   detail_failed_count = ?, error_code = ?, error = ?
             WHERE sync_id = (
                 SELECT sync_id
                   FROM portal_sync_runs
                  WHERE status = 'running'
                  ORDER BY started_at DESC
                  LIMIT 1
             )
            """,
            (
                finished_at,
                max(0, int(total_count)),
                max(0, int(new_count)),
                max(0, int(updated_count)),
                max(0, int(detail_count)),
                max(0, int(detail_failed_count)),
                _text(error_code) or None,
                _text(error) or None,
            ),
        )
        connection.commit()
    finally:
        connection.close()


def fail_sync(
    last_sync_at: str,
    error_code: str,
    error: str,
    *,
    path: str | Path | None = None,
) -> None:
    connection = _connect(path)
    try:
        finished_at = now_iso()
        connection.execute(
            """
            UPDATE portal_sync_state
               SET status = 'failed', last_sync_at = ?, last_error_code = ?, last_error = ?
             WHERE source = ?
            """,
            (_text(last_sync_at), _text(error_code), _text(error)[:1000], SOURCE),
        )
        connection.execute(
            """
            UPDATE portal_sync_runs
               SET status = 'failed', finished_at = ?, error_code = ?, error = ?
             WHERE sync_id = (
                 SELECT sync_id
                   FROM portal_sync_runs
                  WHERE status = 'running'
                  ORDER BY started_at DESC
                  LIMIT 1
             )
            """,
            (finished_at, _text(error_code), _text(error)[:1000]),
        )
        connection.commit()
    finally:
        connection.close()


def sync_status(path: str | Path | None = None) -> dict[str, object]:
    connection = _connect(path)
    try:
        row = connection.execute(
            """
            SELECT last_sync_at, status, last_error_code, last_error,
                   total_count, new_count, updated_count, detail_failed_count
              FROM portal_sync_state
             WHERE source = ?
            """,
            (SOURCE,),
        ).fetchone()
        counts = connection.execute(
            "SELECT type, COUNT(*) AS count FROM portal_notices GROUP BY type"
        ).fetchall()
        count_map = {str(value["type"]): int(value["count"]) for value in counts}
        result: dict[str, object] = {
            "source": SOURCE,
            "lastSyncAt": row["last_sync_at"] if row else None,
            "status": str(row["status"]) if row else "idle",
            "storedCount": sum(count_map.values()),
            "counts": {value: count_map.get(value, 0) for value in NOTICE_TYPES},
            "totalCount": int(row["total_count"]) if row else 0,
            "newCount": int(row["new_count"]) if row else 0,
            "updatedCount": int(row["updated_count"]) if row else 0,
            "detailFailedCount": int(row["detail_failed_count"]) if row else 0,
            "history": [
                {
                    "syncId": str(run["sync_id"]),
                    "startedAt": str(run["started_at"] or ""),
                    "finishedAt": str(run["finished_at"] or "") or None,
                    "status": str(run["status"]),
                    "totalCount": int(run["total_count"] or 0),
                    "newCount": int(run["new_count"] or 0),
                    "updatedCount": int(run["updated_count"] or 0),
                    "detailCount": int(run["detail_count"] or 0),
                    "detailFailedCount": int(run["detail_failed_count"] or 0),
                    "errorCode": str(run["error_code"] or "") or None,
                    "error": str(run["error"] or "") or None,
                }
                for run in connection.execute(
                    """
                    SELECT sync_id, started_at, finished_at, status,
                           total_count, new_count, updated_count, detail_count,
                           detail_failed_count, error_code, error
                      FROM portal_sync_runs
                     ORDER BY started_at DESC
                     LIMIT 10
                    """
                ).fetchall()
            ],
        }
        if row and row["last_error_code"]:
            result["lastErrorCode"] = str(row["last_error_code"])
        if row and row["last_error"]:
            result["lastError"] = str(row["last_error"])
        return result
    finally:
        connection.close()


def stored_notice_count(path: str | Path | None = None) -> int:
    connection = _connect(path)
    try:
        return int(connection.execute("SELECT COUNT(*) FROM portal_notices").fetchone()[0])
    finally:
        connection.close()
