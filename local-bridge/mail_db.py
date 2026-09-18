from __future__ import annotations

import hashlib
import os
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable


TARGET_FOLDERS = ('school-work', 'international-office')
ANALYSIS_STATUSES = ('queued', 'processing', 'completed', 'failed')
CANDIDATE_STATUSES = ('pending', 'added', 'ignored')
TASK_STATUSES = ('pending', 'done', 'snoozed', 'dismissed')
SYNC_STATUSES = ('idle', 'running', 'completed', 'failed')
DEFAULT_DB_PATH = Path(__file__).resolve().parent / 'data' / 'mail-analysis.db'


class MailDatabaseError(RuntimeError):
    """Safe database error for the local bridge and CLI."""


@dataclass(frozen=True)
class MailUpsertResult:
    mail_id: str
    inserted: bool
    body_missing: bool


SCHEMA = """
CREATE TABLE IF NOT EXISTS mails (
    id TEXT PRIMARY KEY,
    message_id TEXT,
    source_id TEXT NOT NULL DEFAULT '',
    folder TEXT NOT NULL CHECK(folder IN ('school-work', 'international-office')),
    subject TEXT NOT NULL DEFAULT '',
    sender_name TEXT NOT NULL DEFAULT '',
    sender_email TEXT NOT NULL DEFAULT '',
    received_at TEXT NOT NULL DEFAULT '',
    is_read INTEGER NOT NULL DEFAULT 0,
    body TEXT NOT NULL DEFAULT '',
    synced_at TEXT NOT NULL,
    dedup_key TEXT NOT NULL UNIQUE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mails_message_id
    ON mails(message_id) WHERE message_id IS NOT NULL AND message_id <> '';

CREATE INDEX IF NOT EXISTS idx_mails_folder_received
    ON mails(folder, received_at DESC);

CREATE TABLE IF NOT EXISTS mail_analysis (
    mail_id TEXT PRIMARY KEY REFERENCES mails(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK(status IN ('queued', 'processing', 'completed', 'failed')),
    summary TEXT,
    action TEXT,
    error TEXT,
    analyzed_at TEXT,
    prompt_version TEXT,
    model TEXT,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mail_analysis_status
    ON mail_analysis(status);

CREATE TABLE IF NOT EXISTS mail_tasks (
    id TEXT PRIMARY KEY,
    mail_id TEXT NOT NULL REFERENCES mails(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    due_at TEXT,
    status TEXT NOT NULL CHECK(status IN ('pending', 'done', 'snoozed', 'dismissed')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_mail_tasks_status_due
    ON mail_tasks(status, due_at);

CREATE INDEX IF NOT EXISTS idx_mail_tasks_mail
    ON mail_tasks(mail_id);

CREATE TABLE IF NOT EXISTS calendar_candidates (
    id TEXT PRIMARY KEY,
    mail_id TEXT NOT NULL REFERENCES mails(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    start TEXT,
    end TEXT,
    all_day INTEGER NOT NULL DEFAULT 0,
    type TEXT NOT NULL CHECK(type IN ('event', 'deadline')),
    reason TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL CHECK(status IN ('pending', 'added', 'ignored')),
    calendar_event_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_calendar_candidates_mail
    ON calendar_candidates(mail_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_candidates_event
    ON calendar_candidates(calendar_event_id)
    WHERE calendar_event_id IS NOT NULL AND calendar_event_id <> '';

CREATE TABLE IF NOT EXISTS sync_state (
    folder TEXT PRIMARY KEY CHECK(folder IN ('school-work', 'international-office')),
    last_sync_at TEXT,
    status TEXT NOT NULL DEFAULT 'idle' CHECK(status IN ('idle', 'running', 'completed', 'failed')),
    phase TEXT NOT NULL DEFAULT '',
    processed INTEGER NOT NULL DEFAULT 0,
    total INTEGER NOT NULL DEFAULT 0,
    new_count INTEGER NOT NULL DEFAULT 0,
    analysis_completed INTEGER NOT NULL DEFAULT 0,
    analysis_failed INTEGER NOT NULL DEFAULT 0,
    error TEXT
);
"""


def now_iso(now: datetime | None = None) -> str:
    value = now or datetime.now(timezone.utc)
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat().replace('+00:00', 'Z')


def resolve_db_path(path: str | Path | None = None) -> Path:
    if path is None:
        raw = os.environ.get('MAIL_ANALYSIS_DB_PATH', '').strip()
        path = Path(raw).expanduser() if raw else DEFAULT_DB_PATH
    return Path(path).expanduser().resolve(strict=False)


def _folder(folder: str) -> str:
    value = folder.strip()
    if value not in TARGET_FOLDERS:
        raise MailDatabaseError('unsupported mail analysis folder')
    return value


def _backfill_tasks(connection: sqlite3.Connection) -> None:
    """Create the first task row for action-bearing analyses.

    This is intentionally idempotent. It lets an existing SQLite database
    adopt the task flow without re-running AI analysis or touching candidate
    statuses.
    """
    fallback_time = now_iso()
    connection.execute(
        """
        INSERT OR IGNORE INTO mail_tasks(
            id, mail_id, title, description, due_at, status,
            created_at, updated_at, completed_at
        )
        SELECT
            'mail-task:' || a.mail_id,
            a.mail_id,
            trim(a.action),
            '',
            NULL,
            'pending',
            COALESCE(a.analyzed_at, a.updated_at, ?),
            COALESCE(a.updated_at, a.analyzed_at, ?),
            NULL
          FROM mail_analysis a
         WHERE a.action IS NOT NULL
           AND trim(a.action) <> ''
        """,
        (fallback_time, fallback_time),
    )


def _connect(path: str | Path | None = None) -> sqlite3.Connection:
    db_path = resolve_db_path(path)
    try:
        db_path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(str(db_path), timeout=30)
        connection.row_factory = sqlite3.Row
        connection.execute('PRAGMA foreign_keys = ON')
        connection.execute('PRAGMA busy_timeout = 30000')
        connection.execute('PRAGMA journal_mode = WAL')
        connection.executescript(SCHEMA)
        connection.executemany(
            "INSERT OR IGNORE INTO sync_state(folder) VALUES (?)",
            [(value,) for value in TARGET_FOLDERS],
        )
        _backfill_tasks(connection)
        connection.commit()
        return connection
    except (OSError, sqlite3.Error) as exc:
        raise MailDatabaseError('mail analysis database is unavailable') from exc


def initialize_database(path: str | Path | None = None) -> Path:
    connection = _connect(path)
    connection.close()
    return resolve_db_path(path)


def _mail_payload(row: sqlite3.Row, include_body: bool = False) -> dict[str, object]:
    result: dict[str, object] = {
        'id': str(row['id']),
        'subject': str(row['subject'] or '') or '(제목 없음)',
        'senderName': str(row['sender_name'] or '') or '(발신자 알 수 없음)',
        'senderAddress': str(row['sender_email'] or ''),
        'receivedAt': str(row['received_at'] or ''),
        'isRead': bool(row['is_read']),
    }
    if row['message_id']:
        result['messageId'] = str(row['message_id'])
    if include_body:
        result['body'] = str(row['body'] or '')
    return result


def _analysis_payload(row: sqlite3.Row | None, mail_id: str) -> dict[str, object]:
    if row is None:
        return {
            'mailId': mail_id,
            'status': 'queued',
            'summary': None,
            'action': None,
            'error': None,
            'analyzedAt': None,
            'promptVersion': None,
            'model': None,
        }
    return {
        'mailId': mail_id,
        'status': str(row['analysis_status']),
        'summary': row['summary'],
        'action': row['action'],
        'error': row['analysis_error'],
        'analyzedAt': row['analyzed_at'],
        'promptVersion': row['prompt_version'],
        'model': row['model'],
    }


def _candidate_payload(row: sqlite3.Row) -> dict[str, object]:
    return {
        'id': str(row['id']),
        'mailId': str(row['mail_id']),
        'title': str(row['title'] or ''),
        'start': row['start'],
        'end': row['end'],
        'allDay': bool(row['all_day']),
        'type': str(row['type']),
        'reason': str(row['reason'] or ''),
        'status': str(row['status']),
        **({'calendarEventId': str(row['calendar_event_id'])} if row['calendar_event_id'] else {}),
    }


def _task_payload(row: sqlite3.Row) -> dict[str, object]:
    mail = {
        'id': str(row['mail_id']),
        'subject': str(row['mail_subject'] or '') or '(제목 없음)',
        'senderName': str(row['mail_sender_name'] or '') or '(발신자 알 수 없음)',
        'senderAddress': str(row['mail_sender_email'] or ''),
        'receivedAt': str(row['mail_received_at'] or ''),
        'isRead': bool(row['mail_is_read']),
    }
    if row['mail_message_id']:
        mail['messageId'] = str(row['mail_message_id'])
    return {
        'id': str(row['id']),
        'mailId': str(row['mail_id']),
        'folder': str(row['mail_folder']),
        'title': str(row['title'] or ''),
        'description': str(row['description'] or ''),
        'dueAt': row['due_at'],
        'status': str(row['status']),
        'createdAt': row['created_at'],
        'updatedAt': row['updated_at'],
        'completedAt': row['completed_at'],
        'mail': mail,
    }


def _task_query(
    connection: sqlite3.Connection,
    task_id: str | None = None,
    status: str | None = None,
) -> list[sqlite3.Row]:
    clauses: list[str] = []
    values: list[object] = []
    if task_id is not None:
        clauses.append('t.id = ?')
        values.append(task_id)
    if status is not None:
        if status not in TASK_STATUSES:
            raise MailDatabaseError('invalid mail task status')
        clauses.append('t.status = ?')
        values.append(status)
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ''
    return connection.execute(
        f"""
        SELECT t.id, t.mail_id, t.title, t.description, t.due_at, t.status,
               t.created_at, t.updated_at, t.completed_at,
               m.folder AS mail_folder, m.message_id AS mail_message_id,
               m.subject AS mail_subject, m.sender_name AS mail_sender_name,
               m.sender_email AS mail_sender_email, m.received_at AS mail_received_at,
               m.is_read AS mail_is_read
          FROM mail_tasks t
          JOIN mails m ON m.id = t.mail_id
          {where}
         ORDER BY CASE t.status
                    WHEN 'pending' THEN 0
                    WHEN 'snoozed' THEN 1
                    WHEN 'done' THEN 2
                    ELSE 3
                  END,
                  CASE WHEN t.due_at IS NULL OR t.due_at = '' THEN 1 ELSE 0 END,
                  t.due_at ASC,
                  t.updated_at DESC,
                  t.id ASC
        """,
        values,
    ).fetchall()


def list_tasks(path: str | Path | None = None, status: str | None = None, limit: int = 100) -> list[dict[str, object]]:
    safe_limit = max(1, min(200, int(limit)))
    connection = _connect(path)
    try:
        return [_task_payload(row) for row in _task_query(connection, status=status)[:safe_limit]]
    finally:
        connection.close()


def get_task(path: str | Path | None, task_id: str) -> dict[str, object] | None:
    connection = _connect(path)
    try:
        rows = _task_query(connection, task_id=task_id)
        return _task_payload(rows[0]) if rows else None
    finally:
        connection.close()


def update_task(
    task_id: str,
    status: str,
    title: str | None = None,
    description: str | None = None,
    due_at: str | None = None,
    path: str | Path | None = None,
) -> dict[str, object]:
    if status not in TASK_STATUSES:
        raise MailDatabaseError('invalid mail task status')
    connection = _connect(path)
    try:
        row = connection.execute('SELECT * FROM mail_tasks WHERE id = ?', (task_id,)).fetchone()
        if row is None:
            raise MailDatabaseError('mail task not found')
        next_title = str(title).strip() if isinstance(title, str) and title.strip() else str(row['title'])
        next_description = str(description).strip() if isinstance(description, str) else str(row['description'] or '')
        next_due_at = str(due_at).strip() if isinstance(due_at, str) and due_at.strip() else row['due_at']
        completed_at = now_iso() if status == 'done' else None
        connection.execute(
            """
            UPDATE mail_tasks
               SET title = ?, description = ?, due_at = ?, status = ?,
                   updated_at = ?, completed_at = ?
             WHERE id = ?
            """,
            (next_title, next_description, next_due_at, status, now_iso(), completed_at, task_id),
        )
        connection.commit()
        updated = _task_query(connection, task_id=task_id)
        if not updated:
            raise MailDatabaseError('mail task could not be updated')
        return _task_payload(updated[0])
    except MailDatabaseError:
        connection.rollback()
        raise
    except sqlite3.Error as exc:
        connection.rollback()
        raise MailDatabaseError('mail task could not be updated') from exc
    finally:
        connection.close()


def _analysis_query(connection: sqlite3.Connection, folder: str | None = None, mail_id: str | None = None) -> list[sqlite3.Row]:
    clauses: list[str] = []
    values: list[object] = []
    if folder is not None:
        clauses.append('m.folder = ?')
        values.append(_folder(folder))
    if mail_id is not None:
        clauses.append('m.id = ?')
        values.append(mail_id)
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ''
    return connection.execute(
        f"""
        SELECT m.id, m.message_id, m.source_id, m.folder, m.subject, m.sender_name,
               m.sender_email, m.received_at, m.is_read, m.body, m.synced_at,
               a.status AS analysis_status, a.summary, a.action,
               a.error AS analysis_error, a.analyzed_at, a.prompt_version, a.model
          FROM mails m
          LEFT JOIN mail_analysis a ON a.mail_id = m.id
          {where}
         ORDER BY m.received_at DESC, m.id ASC
        """,
        values,
    ).fetchall()


def _view_from_row(connection: sqlite3.Connection, row: sqlite3.Row) -> dict[str, object]:
    candidates = connection.execute(
        'SELECT id, mail_id, title, start, end, all_day, type, reason, status, calendar_event_id '
        'FROM calendar_candidates WHERE mail_id = ? ORDER BY rowid',
        (row['id'],),
    ).fetchall()
    return {
        'mail': _mail_payload(row),
        'folder': str(row['folder']),
        'analysis': _analysis_payload(row, str(row['id'])),
        'candidates': [_candidate_payload(value) for value in candidates],
    }


def list_analysis(path: str | Path | None = None, folder: str | None = None, limit: int = 100) -> list[dict[str, object]]:
    safe_limit = max(1, min(100, int(limit)))
    connection = _connect(path)
    try:
        rows = _analysis_query(connection, folder=folder)
        return [_view_from_row(connection, row) for row in rows[:safe_limit]]
    finally:
        connection.close()


def get_analysis(path: str | Path | None, mail_id: str) -> dict[str, object] | None:
    connection = _connect(path)
    try:
        rows = _analysis_query(connection, mail_id=mail_id)
        return _view_from_row(connection, rows[0]) if rows else None
    finally:
        connection.close()


def get_mail_for_processing(path: str | Path | None, mail_id: str) -> dict[str, object] | None:
    connection = _connect(path)
    try:
        rows = _analysis_query(connection, mail_id=mail_id)
        if not rows:
            return None
        row = rows[0]
        return {
            'id': str(row['id']),
            'source_id': str(row['source_id'] or ''),
            'folder': str(row['folder']),
            'subject': str(row['subject'] or ''),
            'sender_name': str(row['sender_name'] or ''),
            'sender_email': str(row['sender_email'] or ''),
            'received_at': str(row['received_at'] or ''),
            'is_read': bool(row['is_read']),
            'message_id': str(row['message_id']) if row['message_id'] else None,
            'body': str(row['body'] or ''),
            'analysis_status': str(row['analysis_status'] or 'queued'),
        }
    finally:
        connection.close()


def _fallback_key(folder: str, sender: str, subject: str, received_at: str) -> str:
    value = '\x00'.join((folder, sender, subject, received_at))
    return hashlib.sha256(value.encode('utf-8', errors='replace')).hexdigest()


def upsert_mail(item: object, folder: str, body: str, synced_at: str, path: str | Path | None = None) -> MailUpsertResult:
    folder = _folder(folder)
    source_id = str(getattr(item, 'id', '') or '').strip()
    message_id = str(getattr(item, 'message_id', '') or '').strip() or None
    subject = str(getattr(item, 'subject', '') or '')
    sender_name = str(getattr(item, 'sender_name', '') or '')
    sender_email = str(getattr(item, 'sender_address', '') or '')
    received_at = str(getattr(item, 'received_at', '') or '')
    is_read = 1 if bool(getattr(item, 'is_read', False)) else 0
    body_value = str(body or '')
    if message_id:
        dedup_key = f'message:{message_id}'
    elif source_id:
        dedup_key = f'id:{source_id}'
    else:
        dedup_key = f'fallback:{_fallback_key(folder, sender_email, subject, received_at)}'

    connection = _connect(path)
    try:
        connection.execute('BEGIN IMMEDIATE')
        existing: sqlite3.Row | None = None
        if message_id:
            existing = connection.execute('SELECT * FROM mails WHERE message_id = ?', (message_id,)).fetchone()
        if existing is None and source_id:
            existing = connection.execute('SELECT * FROM mails WHERE id = ?', (source_id,)).fetchone()
        if existing is None:
            existing = connection.execute('SELECT * FROM mails WHERE dedup_key = ?', (dedup_key,)).fetchone()

        if existing is not None:
            mail_id = str(existing['id'])
            stored_body = str(existing['body'] or '')
            connection.execute(
                """
                UPDATE mails
                   SET message_id = ?, source_id = ?, folder = ?, subject = ?, sender_name = ?,
                       sender_email = ?, received_at = ?, is_read = ?, body = ?, synced_at = ?, dedup_key = ?
                 WHERE id = ?
                """,
                (
                    message_id or existing['message_id'],
                    source_id or existing['source_id'],
                    folder,
                    subject,
                    sender_name,
                    sender_email,
                    received_at,
                    is_read,
                    body_value if body_value else stored_body,
                    synced_at,
                    dedup_key,
                    mail_id,
                ),
            )
            inserted = False
            body_missing = not bool(body_value or stored_body)
        else:
            mail_id = source_id or dedup_key
            connection.execute(
                """
                INSERT INTO mails(
                    id, message_id, source_id, folder, subject, sender_name, sender_email,
                    received_at, is_read, body, synced_at, dedup_key
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (mail_id, message_id, source_id, folder, subject, sender_name, sender_email, received_at, is_read, body_value, synced_at, dedup_key),
            )
            inserted = True
            body_missing = not bool(body_value)
        connection.execute(
            """
            INSERT OR IGNORE INTO mail_analysis(mail_id, status, updated_at)
            VALUES (?, 'queued', ?)
            """,
            (mail_id, synced_at),
        )
        connection.commit()
        return MailUpsertResult(mail_id, inserted, body_missing)
    except sqlite3.IntegrityError as exc:
        connection.rollback()
        raise MailDatabaseError('mail could not be stored without a duplicate key') from exc
    except sqlite3.Error as exc:
        connection.rollback()
        raise MailDatabaseError('mail could not be stored') from exc
    finally:
        connection.close()


def update_mail_body(mail_id: str, body: str, synced_at: str, path: str | Path | None = None) -> None:
    connection = _connect(path)
    try:
        connection.execute('UPDATE mails SET body = ?, synced_at = ? WHERE id = ?', (body, synced_at, mail_id))
        connection.commit()
    except sqlite3.Error as exc:
        connection.rollback()
        raise MailDatabaseError('mail body could not be stored') from exc
    finally:
        connection.close()


def queued_mail(path: str | Path | None = None, mail_id: str | None = None) -> list[dict[str, object]]:
    connection = _connect(path)
    try:
        rows = _analysis_query(connection, mail_id=mail_id)
        result: list[dict[str, object]] = []
        for row in rows:
            if str(row['analysis_status'] or 'queued') != 'queued':
                continue
            result.append({
                'id': str(row['id']),
                'source_id': str(row['source_id'] or ''),
                'folder': str(row['folder']),
                'subject': str(row['subject'] or ''),
                'sender_name': str(row['sender_name'] or ''),
                'sender_email': str(row['sender_email'] or ''),
                'received_at': str(row['received_at'] or ''),
                'is_read': bool(row['is_read']),
                'message_id': str(row['message_id']) if row['message_id'] else None,
                'body': str(row['body'] or ''),
            })
        return result
    finally:
        connection.close()


def queue_analysis(mail_id: str, path: str | Path | None = None, force: bool = False) -> bool:
    connection = _connect(path)
    try:
        if force:
            cursor = connection.execute(
                """
                UPDATE mail_analysis
                   SET status = 'queued', summary = NULL, action = NULL, error = NULL,
                       analyzed_at = NULL, updated_at = ?
                 WHERE mail_id = ?
                """,
                (now_iso(), mail_id),
            )
        else:
            cursor = connection.execute(
                "UPDATE mail_analysis SET status = 'queued', error = NULL, updated_at = ? WHERE mail_id = ? AND status <> 'completed'",
                (now_iso(), mail_id),
            )
        connection.commit()
        return cursor.rowcount > 0
    except sqlite3.Error as exc:
        connection.rollback()
        raise MailDatabaseError('mail analysis could not be queued') from exc
    finally:
        connection.close()


def claim_analysis(mail_id: str, path: str | Path | None = None) -> bool:
    connection = _connect(path)
    try:
        cursor = connection.execute(
            "UPDATE mail_analysis SET status = 'processing', error = NULL, updated_at = ? WHERE mail_id = ? AND status = 'queued'",
            (now_iso(), mail_id),
        )
        connection.commit()
        return cursor.rowcount > 0
    except sqlite3.Error as exc:
        connection.rollback()
        raise MailDatabaseError('mail analysis could not be started') from exc
    finally:
        connection.close()


def _upsert_action_task(
    connection: sqlite3.Connection,
    mail_id: str,
    action: str | None,
    due_at: str | None,
    updated_at: str,
) -> None:
    task_id = f'mail-task:{mail_id}'
    if action:
        connection.execute(
            """
            INSERT INTO mail_tasks(
                id, mail_id, title, description, due_at, status,
                created_at, updated_at, completed_at
            ) VALUES (?, ?, ?, '', ?, 'pending', ?, ?, NULL)
            ON CONFLICT(id) DO UPDATE SET
                title = excluded.title,
                due_at = excluded.due_at,
                updated_at = excluded.updated_at
             WHERE mail_tasks.status IN ('pending', 'snoozed')
            """,
            (task_id, mail_id, action, due_at, updated_at, updated_at),
        )
    else:
        # Keep done/dismissed history, but remove a stale open task if a
        # re-analysis no longer finds an action.
        connection.execute(
            """
            UPDATE mail_tasks
               SET status = 'dismissed', updated_at = ?, completed_at = NULL
             WHERE mail_id = ? AND status IN ('pending', 'snoozed')
            """,
            (updated_at, mail_id),
        )


def save_completed(
    mail_id: str,
    result: dict[str, object],
    prompt_version: str,
    model: str,
    analyzed_at: str,
    path: str | Path | None = None,
) -> None:
    summary = str(result.get('summary') or '').strip()
    action_value = result.get('action')
    action = str(action_value).strip() if isinstance(action_value, str) and action_value.strip() else None
    raw_candidates = result.get('calendarCandidates')
    candidates = raw_candidates if isinstance(raw_candidates, list) else []
    connection = _connect(path)
    try:
        connection.execute('BEGIN IMMEDIATE')
        connection.execute(
            """
            UPDATE mail_analysis
               SET status = 'completed', summary = ?, action = ?, error = NULL,
                   analyzed_at = ?, prompt_version = ?, model = ?, updated_at = ?
             WHERE mail_id = ?
            """,
            (summary, action, analyzed_at, prompt_version, model or None, analyzed_at, mail_id),
        )
        candidate_ids: list[str] = []
        for candidate in candidates:
            if not isinstance(candidate, dict):
                continue
            candidate_id = str(candidate.get('id') or '').strip()
            title = str(candidate.get('title') or '').strip()
            if not candidate_id or not title:
                continue
            candidate_ids.append(candidate_id)
            existing = connection.execute(
                'SELECT status, title, start, end, all_day, type, reason, calendar_event_id FROM calendar_candidates WHERE id = ? AND mail_id = ?',
                (candidate_id, mail_id),
            ).fetchone()
            if existing is not None and str(existing['status']) in ('added', 'ignored'):
                continue
            connection.execute(
                """
                INSERT INTO calendar_candidates(id, mail_id, title, start, end, all_day, type, reason, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')
                ON CONFLICT(id) DO UPDATE SET
                    title = excluded.title,
                    start = excluded.start,
                    end = excluded.end,
                    all_day = excluded.all_day,
                    type = excluded.type,
                    reason = excluded.reason
                """,
                (
                    candidate_id,
                    mail_id,
                    title,
                    candidate.get('start'),
                    candidate.get('end'),
                    1 if candidate.get('allDay') is True else 0,
                    'deadline' if candidate.get('type') == 'deadline' else 'event',
                    str(candidate.get('reason') or ''),
                ),
            )
        if candidate_ids:
            placeholders = ','.join('?' for _ in candidate_ids)
            connection.execute(
                f"DELETE FROM calendar_candidates WHERE mail_id = ? AND status = 'pending' AND id NOT IN ({placeholders})",
                [mail_id, *candidate_ids],
            )
        else:
            connection.execute("DELETE FROM calendar_candidates WHERE mail_id = ? AND status = 'pending'", (mail_id,))
        deadline_starts = sorted(
            str(candidate.get('start')).strip()
            for candidate in candidates
            if isinstance(candidate, dict)
            and candidate.get('type') == 'deadline'
            and str(candidate.get('start') or '').strip()
        )
        _upsert_action_task(connection, mail_id, action, deadline_starts[0] if deadline_starts else None, analyzed_at)
        connection.commit()
    except sqlite3.Error as exc:
        connection.rollback()
        raise MailDatabaseError('completed mail analysis could not be stored') from exc
    finally:
        connection.close()


def save_failed(
    mail_id: str,
    error: str,
    prompt_version: str,
    model: str,
    path: str | Path | None = None,
) -> None:
    connection = _connect(path)
    try:
        connection.execute(
            """
            UPDATE mail_analysis
               SET status = 'failed', error = ?, prompt_version = ?, model = ?, updated_at = ?
             WHERE mail_id = ?
            """,
            (str(error or 'AI 분석에 실패했어.')[:1000], prompt_version, model or None, now_iso(), mail_id),
        )
        connection.commit()
    except sqlite3.Error as exc:
        connection.rollback()
        raise MailDatabaseError('failed mail analysis could not be stored') from exc
    finally:
        connection.close()


def update_candidate(
    mail_id: str,
    candidate_id: str,
    status: str,
    title: str | None = None,
    start: str | None = None,
    end: str | None = None,
    all_day: bool | None = None,
    calendar_event_id: str | None = None,
    path: str | Path | None = None,
) -> dict[str, object]:
    if status not in CANDIDATE_STATUSES:
        raise MailDatabaseError('invalid calendar candidate status')
    connection = _connect(path)
    try:
        row = connection.execute('SELECT * FROM calendar_candidates WHERE id = ? AND mail_id = ?', (candidate_id, mail_id)).fetchone()
        if row is None:
            raise MailDatabaseError('calendar candidate not found')
        next_title = str(title).strip() if isinstance(title, str) and title.strip() else str(row['title'])
        next_start = str(start).strip() if isinstance(start, str) and start.strip() else row['start']
        next_end = str(end).strip() if isinstance(end, str) and end.strip() else None
        next_all_day = int(all_day) if isinstance(all_day, bool) else int(row['all_day'])
        next_event_id = str(calendar_event_id).strip() if isinstance(calendar_event_id, str) and calendar_event_id.strip() else row['calendar_event_id']
        connection.execute(
            """
            UPDATE calendar_candidates
               SET title = ?, start = ?, end = ?, all_day = ?, status = ?, calendar_event_id = ?
             WHERE id = ? AND mail_id = ?
            """,
            (next_title, next_start, next_end, next_all_day, status, next_event_id, candidate_id, mail_id),
        )
        connection.commit()
        updated = connection.execute('SELECT * FROM calendar_candidates WHERE id = ? AND mail_id = ?', (candidate_id, mail_id)).fetchone()
        if updated is None:
            raise MailDatabaseError('calendar candidate could not be updated')
        return _candidate_payload(updated)
    except MailDatabaseError:
        connection.rollback()
        raise
    except sqlite3.Error as exc:
        connection.rollback()
        raise MailDatabaseError('calendar candidate could not be updated') from exc
    finally:
        connection.close()


def begin_sync(path: str | Path | None = None) -> None:
    connection = _connect(path)
    try:
        # A process terminated during analysis must not leave work permanently
        # locked in ``processing`` on the next explicit synchronization.
        connection.execute("UPDATE mail_analysis SET status = 'queued', updated_at = ? WHERE status = 'processing'", (now_iso(),))
        connection.executemany(
            """
            UPDATE sync_state
               SET status = 'running', phase = 'collecting', processed = 0, total = 0,
                   new_count = 0, analysis_completed = 0, analysis_failed = 0, error = NULL
             WHERE folder = ?
            """,
            [(folder,) for folder in TARGET_FOLDERS],
        )
        connection.commit()
    finally:
        connection.close()


def update_sync_progress(
    folder: str,
    phase: str,
    processed: int,
    total: int,
    new_count: int | None = None,
    analysis_completed: int | None = None,
    analysis_failed: int | None = None,
    error: str | None = None,
    path: str | Path | None = None,
) -> None:
    folder = _folder(folder)
    connection = _connect(path)
    try:
        values: list[object] = [phase, max(0, processed), max(0, total)]
        assignments = ['phase = ?', 'processed = ?', 'total = ?']
        if new_count is not None:
            assignments.append('new_count = ?')
            values.append(max(0, new_count))
        if analysis_completed is not None:
            assignments.append('analysis_completed = ?')
            values.append(max(0, analysis_completed))
        if analysis_failed is not None:
            assignments.append('analysis_failed = ?')
            values.append(max(0, analysis_failed))
        if error is not None:
            assignments.append('error = ?')
            values.append(error[:1000])
        values.append(folder)
        connection.execute(f"UPDATE sync_state SET {', '.join(assignments)} WHERE folder = ?", values)
        connection.commit()
    finally:
        connection.close()


def finish_sync_folder(
    folder: str,
    last_sync_at: str,
    new_count: int,
    analysis_completed: int,
    analysis_failed: int,
    error: str | None = None,
    path: str | Path | None = None,
) -> None:
    folder = _folder(folder)
    connection = _connect(path)
    try:
        connection.execute(
            """
            UPDATE sync_state
               SET status = 'completed', phase = 'completed', last_sync_at = ?,
                   processed = total, new_count = ?, analysis_completed = ?,
                   analysis_failed = ?, error = ?
             WHERE folder = ?
            """,
            (last_sync_at, max(0, new_count), max(0, analysis_completed), max(0, analysis_failed), error, folder),
        )
        connection.commit()
    finally:
        connection.close()


def fail_sync_folder(folder: str, last_sync_at: str, error: str, path: str | Path | None = None) -> None:
    folder = _folder(folder)
    connection = _connect(path)
    try:
        connection.execute(
            "UPDATE sync_state SET status = 'failed', phase = 'failed', last_sync_at = ?, error = ? WHERE folder = ?",
            (last_sync_at, error[:1000], folder),
        )
        connection.commit()
    finally:
        connection.close()


def sync_status(path: str | Path | None = None) -> dict[str, object]:
    connection = _connect(path)
    try:
        states = connection.execute(
            'SELECT folder, last_sync_at, status, phase, processed, total, new_count, analysis_completed, analysis_failed, error FROM sync_state ORDER BY CASE folder WHEN \'school-work\' THEN 0 ELSE 1 END'
        ).fetchall()
        counts = connection.execute('SELECT status, COUNT(*) AS count FROM mail_analysis GROUP BY status').fetchall()
        count_map = {str(row['status']): int(row['count']) for row in counts}
        running = any(str(row['status']) == 'running' for row in states)
        failed = any(str(row['status']) == 'failed' for row in states)
        state = 'running' if running else 'failed' if failed else 'completed' if any(str(row['status']) == 'completed' for row in states) else 'idle'
        sync_times = [str(row['last_sync_at']) for row in states if row['last_sync_at']]
        last_sync_at = max(sync_times) if sync_times else None
        progress_current = sum(int(row['processed']) for row in states if str(row['status']) == 'running')
        progress_total = sum(int(row['total']) for row in states if str(row['status']) == 'running')
        phase = next((str(row['phase']) for row in states if str(row['status']) == 'running' and row['phase']), '')
        return {
            'status': state,
            'phase': phase,
            'lastSyncAt': last_sync_at,
            'newCount': sum(int(row['new_count']) for row in states),
            'analysisCompleted': sum(int(row['analysis_completed']) for row in states),
            'analysisFailed': sum(int(row['analysis_failed']) for row in states),
            'progress': {'current': progress_current, 'total': progress_total},
            'counts': {value: count_map.get(value, 0) for value in ANALYSIS_STATUSES},
            'folders': [
                {
                    'folder': str(row['folder']),
                    'lastSyncAt': row['last_sync_at'],
                    'status': str(row['status']),
                    'phase': str(row['phase'] or ''),
                    'processed': int(row['processed']),
                    'total': int(row['total']),
                    'newCount': int(row['new_count']),
                    'analysisCompleted': int(row['analysis_completed']),
                    'analysisFailed': int(row['analysis_failed']),
                    **({'error': str(row['error'])} if row['error'] else {}),
                }
                for row in states
            ],
        }
    finally:
        connection.close()


def stored_mail_count(path: str | Path | None = None) -> int:
    connection = _connect(path)
    try:
        return int(connection.execute('SELECT COUNT(*) FROM mails').fetchone()[0])
    finally:
        connection.close()
