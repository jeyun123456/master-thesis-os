import json
import hashlib
import os
import platform
import re
import subprocess
import sys
import tempfile
import threading
from datetime import date, datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit

from bridge_config import CONFIG_ERROR_EXIT_CODE, ConfigError, load_bridge_config, resolve_config_path
from bridge_security import allows_private_network, target_for_endpoint, token_matches
from thunderbird_mail import (
    ThunderbirdMailError,
    clamp_mail_limit,
    get_mail_folders,
    get_mail_message,
    get_recent_mail,
    launch_thunderbird,
    normalize_folder_id,
)


HERE = Path(__file__).resolve().parent
CONFIG = resolve_config_path(HERE)
MAX_BODY_BYTES = 16 * 1024
MAX_PLANNER_BODY_BYTES = 512 * 1024
MAX_INBOX_BODY_BYTES = 4 * 1024 * 1024
MAX_INBOX_STORE_BYTES = 8 * 1024 * 1024
MAX_INBOX_ENTRIES = 10_000
MAX_INBOX_RAW_CHARS = 1_200
BRIDGE_API_VERSION = 5
MAIL_PATH_PREFIX = '/mail/'


def _configure_utf8() -> None:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding='utf-8', errors='replace')
        except (AttributeError, ValueError):
            pass


_configure_utf8()

try:
    bridge_config = load_bridge_config(CONFIG)
except ConfigError as exc:
    print(str(exc), file=sys.stderr)
    raise SystemExit(CONFIG_ERROR_EXIT_CODE) from exc

import mail_cli
import mail_db
import portal_db
from shortcut_launcher import launch_shortcut, normalize_shortcut_request

mail_cli.load_local_env((bridge_config.root, bridge_config.root / 'master-thesis-os'))

ROOT = bridge_config.root
TOKEN = bridge_config.token
PORT = bridge_config.port
ORIGINS = bridge_config.origins


def _resolve_bridge_db_path():
    if os.environ.get('MAIL_ANALYSIS_DB_PATH', '').strip():
        return mail_db.resolve_db_path()
    for root in (bridge_config.root, bridge_config.root / 'master-thesis-os'):
        source_directory = root / 'local-bridge'
        if (source_directory / 'mail_db.py').is_file():
            return (source_directory / 'data' / 'mail-analysis.db').resolve(strict=False)
    return mail_db.resolve_db_path()


DB_PATH = _resolve_bridge_db_path()
INBOX_DATA_PATH = ROOT / 'shared' / 'inbox' / 'inbox.json'
INBOX_STORE_LOCK = threading.Lock()
PLANNER_TASKS_DATA_PATH = ROOT / 'shared' / 'planner' / 'tasks.json'
PLANNER_TASKS_STORE_LOCK = threading.Lock()
PROJECT_METADATA_LOCK = threading.Lock()


def _valid_iso_timestamp(value: object) -> bool:
    if not isinstance(value, str) or not value or len(value) > 64:
        return False
    try:
        datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError:
        return False
    return True


def _explicit_full_year_dates(raw_text: str) -> set[str]:
    patterns = (
        re.compile(r'(?<!\d)(\d{4})[-/.]\s*(\d{1,2})[-/.]\s*(\d{1,2})(?!\d)'),
        re.compile(r'(?<!\d)(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일'),
    )
    result: set[str] = set()
    for pattern in patterns:
        for match in pattern.finditer(raw_text):
            try:
                result.add(date(*(int(part) for part in match.groups())).isoformat())
            except ValueError:
                continue
    return result


def _normalize_inbox_entry(raw: object) -> dict[str, object]:
    if not isinstance(raw, dict):
        raise ValueError('invalid inbox entry')
    entry_id = raw.get('id')
    raw_text = raw.get('rawText')
    created_at = raw.get('createdAt')
    processed = raw.get('processed')
    ai_raw = raw.get('ai')
    if not isinstance(entry_id, str) or not entry_id.strip() or len(entry_id) > 256:
        raise ValueError('invalid inbox entry id')
    if not isinstance(raw_text, str) or not raw_text.strip() or len(raw_text) > MAX_INBOX_RAW_CHARS:
        raise ValueError('invalid inbox raw text')
    if not _valid_iso_timestamp(created_at) or not isinstance(processed, bool):
        raise ValueError('invalid inbox entry metadata')

    ai: dict[str, object] | None = None
    if ai_raw is not None:
        if not isinstance(ai_raw, dict):
            raise ValueError('invalid inbox AI result')
        category = ai_raw.get('category')
        legacy_categories = {
            'Todo': 'todo',
            'Idea': 'idea',
            'Research Note': 'idea',
            'Later / Reference': 'other',
        }
        if not isinstance(category, str):
            raise ValueError('invalid inbox AI category')
        category = legacy_categories.get(category, category)
        if category not in {'idea', 'todo', 'schedule', 'other'}:
            raise ValueError('invalid inbox AI category')
        if ai_raw.get('entryId') != entry_id or not _valid_iso_timestamp(ai_raw.get('processedAt')):
            raise ValueError('invalid inbox AI identity')
        title = ai_raw.get('title')
        summary = ai_raw.get('summary')
        next_action = ai_raw.get('nextAction')
        due_date = ai_raw.get('dueDate')
        related_ids = ai_raw.get('relatedEntryIds')
        if not all(isinstance(value, str) for value in (title, summary, next_action)):
            raise ValueError('invalid inbox AI text')
        if len(title) > 1_200 or len(summary) > 1_200 or len(next_action) > 1_200:
            raise ValueError('inbox AI text is too long')
        if category != 'todo' and next_action:
            next_action = ''
        if due_date is not None:
            if not isinstance(due_date, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', due_date):
                raise ValueError('invalid inbox AI date')
            try:
                date.fromisoformat(due_date)
            except ValueError as exc:
                raise ValueError('invalid inbox AI date') from exc
            if due_date not in _explicit_full_year_dates(raw_text):
                due_date = None
        if not isinstance(related_ids, list) or len(related_ids) > 4 or any(not isinstance(value, str) for value in related_ids):
            raise ValueError('invalid inbox related entries')
        ai = {
            'entryId': entry_id,
            'category': category,
            'title': title,
            'summary': summary,
            'nextAction': next_action,
            'dueDate': due_date,
            'relatedEntryIds': [value for value in related_ids if value != entry_id],
            'processedAt': ai_raw['processedAt'],
        }
    if processed != (ai is not None):
        raise ValueError('inbox processed state does not match AI result')
    return {
        'id': entry_id,
        'rawText': raw_text,
        'createdAt': created_at,
        'processed': processed,
        'ai': ai,
    }


def _read_inbox_entries_unlocked() -> list[dict[str, object]]:
    if not INBOX_DATA_PATH.exists():
        return []
    if INBOX_DATA_PATH.stat().st_size > MAX_INBOX_STORE_BYTES:
        raise ValueError('inbox store is too large')
    with INBOX_DATA_PATH.open('r', encoding='utf-8') as file:
        payload = json.load(file)
    if not isinstance(payload, dict) or payload.get('version') != 1 or not isinstance(payload.get('entries'), list):
        raise ValueError('invalid inbox store')
    if len(payload['entries']) > MAX_INBOX_ENTRIES:
        raise ValueError('too many inbox entries')
    entries = [_normalize_inbox_entry(raw) for raw in payload['entries']]
    ids = [entry['id'] for entry in entries]
    if len(ids) != len(set(ids)):
        raise ValueError('duplicate inbox entry id')
    return entries


def _atomic_write_inbox_entries(entries: list[dict[str, object]]) -> None:
    INBOX_DATA_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps({'version': 1, 'entries': entries}, ensure_ascii=False, indent=2) + '\n'
    if len(payload.encode('utf-8')) > MAX_INBOX_STORE_BYTES:
        raise ValueError('inbox store is too large')
    temporary_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode='w', encoding='utf-8', newline='\n', delete=False,
            dir=INBOX_DATA_PATH.parent, prefix='.inbox-', suffix='.tmp',
        ) as temporary_file:
            temporary_path = Path(temporary_file.name)
            temporary_file.write(payload)
            temporary_file.flush()
            os.fsync(temporary_file.fileno())
        os.replace(temporary_path, INBOX_DATA_PATH)
    finally:
        if temporary_path is not None and temporary_path.exists():
            temporary_path.unlink()


def _merge_and_save_inbox_entries(raw_entries: object) -> list[dict[str, object]]:
    if not isinstance(raw_entries, list) or len(raw_entries) > MAX_INBOX_ENTRIES:
        raise ValueError('invalid inbox entries')
    incoming = [_normalize_inbox_entry(raw) for raw in raw_entries]
    incoming_ids = [entry['id'] for entry in incoming]
    if len(incoming_ids) != len(set(incoming_ids)):
        raise ValueError('duplicate inbox entry id')

    with INBOX_STORE_LOCK:
        try:
            existing = _read_inbox_entries_unlocked()
        except (OSError, ValueError) as exc:
            raise OSError('inbox store could not be read') from exc
        merged = {entry['id']: entry for entry in existing}
        for entry in incoming:
            previous = merged.get(entry['id'])
            if previous is None:
                merged[entry['id']] = entry
                continue

            next_entry = dict(previous)
            next_ai = entry['ai']
            previous_ai = previous['ai']
            if next_ai is not None and (
                previous_ai is None
                or str(next_ai['processedAt']) >= str(previous_ai['processedAt'])
            ):
                next_entry['processed'] = True
                next_entry['ai'] = next_ai
            # For an existing ID, id/rawText/createdAt always come from the Vault.
            merged[entry['id']] = next_entry

        entry_ids = set(merged)
        for entry in merged.values():
            ai = entry['ai']
            if isinstance(ai, dict):
                ai['relatedEntryIds'] = [value for value in ai['relatedEntryIds'] if value in entry_ids]
        result = sorted(merged.values(), key=lambda entry: str(entry['createdAt']), reverse=True)
        if len(result) > MAX_INBOX_ENTRIES:
            raise ValueError('too many inbox entries')
        _atomic_write_inbox_entries(result)
        return result


def _normalize_planner_task(raw: object) -> dict[str, object]:
    if not isinstance(raw, dict):
        raise ValueError('invalid planner task')
    task_id = raw.get('id')
    title = raw.get('title')
    status = raw.get('status')
    if not isinstance(task_id, str) or not task_id.strip() or len(task_id) > 256:
        raise ValueError('invalid planner task id')
    if not isinstance(title, str) or not title.strip() or len(title) > 1200:
        raise ValueError('invalid planner task title')
    if not isinstance(status, str) or status not in {'pending', 'done'}:
        raise ValueError('invalid planner task status')
    created_at = raw.get('createdAt')
    updated_at = raw.get('updatedAt')
    if not _valid_iso_timestamp(created_at) or not _valid_iso_timestamp(updated_at):
        raise ValueError('invalid planner task timestamps')
    due_date = raw.get('dueDate')
    if due_date is not None:
        if not isinstance(due_date, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', due_date):
            raise ValueError('invalid planner task date')
        try:
            date.fromisoformat(due_date)
        except ValueError as exc:
            raise ValueError('invalid planner task date') from exc
    completed_at = raw.get('completedAt')
    if completed_at is not None and not _valid_iso_timestamp(completed_at):
        raise ValueError('invalid planner completion timestamp')
    source_inbox_id = raw.get('sourceInboxId')
    if source_inbox_id is not None and (not isinstance(source_inbox_id, str) or len(source_inbox_id) > 256):
        raise ValueError('invalid planner Inbox source')
    description = raw.get('description', '')
    if not isinstance(description, str) or len(description) > 1200:
        raise ValueError('invalid planner task description')
    if status == 'done' and completed_at is None:
        completed_at = updated_at
    if status == 'pending':
        completed_at = None
    return {
        'id': task_id.strip(),
        'title': title.strip(),
        'description': description,
        'dueDate': due_date,
        'sourceInboxId': source_inbox_id,
        'status': status,
        'createdAt': created_at,
        'updatedAt': updated_at,
        'completedAt': completed_at,
    }


def _read_planner_tasks_unlocked() -> list[dict[str, object]]:
    if not PLANNER_TASKS_DATA_PATH.exists():
        return []
    if PLANNER_TASKS_DATA_PATH.stat().st_size > MAX_PLANNER_BODY_BYTES:
        raise ValueError('planner task store is too large')
    with PLANNER_TASKS_DATA_PATH.open('r', encoding='utf-8') as file:
        payload = json.load(file)
    if not isinstance(payload, dict) or payload.get('version') != 1 or not isinstance(payload.get('tasks'), list):
        raise ValueError('invalid planner task store')
    tasks = [_normalize_planner_task(raw) for raw in payload['tasks']]
    ids = [task['id'] for task in tasks]
    if len(ids) != len(set(ids)):
        raise ValueError('duplicate planner task id')
    return tasks


def _atomic_write_planner_tasks(tasks: list[dict[str, object]]) -> None:
    PLANNER_TASKS_DATA_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps({'version': 1, 'tasks': tasks}, ensure_ascii=False, indent=2) + '\n'
    if len(payload.encode('utf-8')) > MAX_PLANNER_BODY_BYTES:
        raise ValueError('planner task store is too large')
    temporary_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode='w', encoding='utf-8', newline='\n', delete=False,
            dir=PLANNER_TASKS_DATA_PATH.parent, prefix='.tasks-', suffix='.tmp',
        ) as temporary_file:
            temporary_path = Path(temporary_file.name)
            temporary_file.write(payload)
            temporary_file.flush()
            os.fsync(temporary_file.fileno())
        os.replace(temporary_path, PLANNER_TASKS_DATA_PATH)
    finally:
        if temporary_path is not None and temporary_path.exists():
            temporary_path.unlink()


def _merge_and_save_planner_tasks(raw_tasks: object, single_task: object = None) -> list[dict[str, object]]:
    incoming_raw = [single_task] if single_task is not None else raw_tasks
    if not isinstance(incoming_raw, list) or len(incoming_raw) > 10_000:
        raise ValueError('invalid planner tasks')
    incoming = [_normalize_planner_task(raw) for raw in incoming_raw]
    incoming_ids = [task['id'] for task in incoming]
    if len(incoming_ids) != len(set(incoming_ids)):
        raise ValueError('duplicate planner task id')

    with PLANNER_TASKS_STORE_LOCK:
        try:
            existing = _read_planner_tasks_unlocked()
        except (OSError, ValueError, json.JSONDecodeError) as exc:
            raise OSError('planner task store could not be read') from exc
        merged = {task['id']: task for task in existing}
        for task in incoming:
            previous = merged.get(task['id'])
            if previous is None:
                merged[task['id']] = task
            elif single_task is None and str(task['updatedAt']) > str(previous['updatedAt']):
                # Task edits can update completion state, but omitted IDs never delete Vault data.
                merged[task['id']] = {
                    **previous,
                    'status': task['status'],
                    'updatedAt': task['updatedAt'],
                    'completedAt': task['completedAt'],
                }
        result = sorted(merged.values(), key=lambda task: str(task['createdAt']), reverse=True)
        _atomic_write_planner_tasks(result)
        return result


class ProjectManifestConflict(Exception):
    pass


def _project_manifest_path(project_id: object) -> tuple[str, Path, Path]:
    if not isinstance(project_id, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,127}', project_id):
        raise ValueError('invalid project id')
    project_root = ROOT / 'projects' / project_id
    if not project_root.is_dir() or project_root.is_symlink():
        raise FileNotFoundError('project folder not found')
    resolved_root = project_root.resolve(strict=True)
    try:
        resolved_root.relative_to(ROOT.resolve())
    except ValueError as exc:
        raise ValueError('project folder is outside the Vault') from exc
    manifest_path = resolved_root / 'project.md'
    if manifest_path.is_symlink() or not manifest_path.is_file():
        raise FileNotFoundError('project.md not found in Vault')
    resolved_manifest = manifest_path.resolve(strict=True)
    try:
        resolved_manifest.relative_to(resolved_root)
    except ValueError as exc:
        raise ValueError('project.md is outside the project folder') from exc
    return project_id, resolved_root, resolved_manifest


def _project_manifest_snapshot(project_id: object) -> tuple[str, str, Path, bytes]:
    normalized_id, project_root, manifest_path = _project_manifest_path(project_id)
    raw = manifest_path.read_bytes()
    raw.decode('utf-8')
    return raw.decode('utf-8'), hashlib.sha256(raw).hexdigest(), manifest_path, raw


def _update_project_frontmatter(markdown: str, key: str, value: str) -> str:
    match = re.match(r'\A---(?P<first>\r?\n)(?P<body>.*?)(?P<last>\r?\n)---', markdown, flags=re.DOTALL)
    if not match:
        raise ValueError('project.md frontmatter is missing')
    newline = '\r\n' if '\r\n' in match.group(0) else '\n'
    lines = re.split(r'\r?\n', match.group('body'))
    pattern = re.compile(rf'^\s*{re.escape(key)}\s*:', flags=re.IGNORECASE)
    found = False
    updated: list[str] = []
    for line in lines:
        if pattern.match(line):
            updated.append(f'{key}: {value}')
            found = True
        else:
            updated.append(line)
    if not found:
        id_index = next((index for index, line in enumerate(updated) if re.match(r'^\s*id\s*:', line, flags=re.IGNORECASE)), -1)
        updated.insert(id_index + 1 if id_index >= 0 else 0, f'{key}: {value}')
    frontmatter = f"---{match.group('first')}{newline.join(updated)}{match.group('last')}---"
    return frontmatter + markdown[match.end():]


def _update_project_key_file(markdown: str, project_id: str, path: str, pinned: bool) -> str:
    if not path.startswith('projects/') or '\\' in path or '\x00' in path:
        raise ValueError('invalid project file path')
    parts = path.split('/')
    if any(part in {'', '.', '..'} for part in parts):
        raise ValueError('invalid project file path')
    newline = '\r\n' if '\r\n' in markdown else '\n'
    heading = re.compile(r'^##\s+주요 파일\s*$', flags=re.MULTILINE)
    match = heading.search(markdown)
    if not match:
        prefix = '' if not markdown else ('' if markdown.endswith(('\n', '\r')) else newline) + newline
        section = f'## 주요 파일{newline}- {path}{newline}' if pinned else f'## 주요 파일{newline}'
        return f'{markdown}{prefix}{section}'
    next_heading = re.search(r'^##\s+', markdown[match.end():], flags=re.MULTILINE)
    section_end = match.end() + next_heading.start() if next_heading else len(markdown)
    section = markdown[match.end():section_end]
    lines = section.splitlines(keepends=True)
    relative_path = path.removeprefix(f'projects/{project_id}/')
    stored_entries = {f'- {path}', f'* {path}', f'- {relative_path}', f'* {relative_path}'}
    entry = f'- {path}'
    has_entry = any(line.strip() in stored_entries for line in lines)
    if pinned and not has_entry:
        if lines and not lines[-1].endswith(('\n', '\r')):
            lines[-1] += newline
        lines.append(entry + newline)
    elif not pinned:
        lines = [line for line in lines if line.strip() not in stored_entries]
    return markdown[:match.end()] + ''.join(lines) + markdown[section_end:]


def _update_project_metadata(body: dict[str, object]) -> dict[str, object]:
    project_id = body.get('projectId')
    operation = body.get('operation')
    value = body.get('value')
    expected_sha = body.get('expectedSha')
    if not isinstance(expected_sha, str) or not re.fullmatch(r'[a-f0-9]{64}', expected_sha):
        raise ValueError('a valid project metadata revision is required')
    with PROJECT_METADATA_LOCK:
        markdown, current_sha, manifest_path, original = _project_manifest_snapshot(project_id)
        if current_sha != expected_sha:
            raise ProjectManifestConflict('project.md changed. Reload the project before saving again.')
        if operation == 'stage':
            if value not in {'planning', 'collection', 'analysis', 'interpretation', 'writing', 'complete'}:
                raise ValueError('invalid research stage')
            updated = _update_project_frontmatter(markdown, 'stage', str(value))
        elif operation == 'status':
            if value not in {'writing', 'active', 'paused', 'waiting', 'blocked', 'complete'}:
                raise ValueError('invalid project status')
            updated = _update_project_frontmatter(markdown, 'status', str(value))
        elif operation in {'favorite_add', 'favorite_remove'}:
            if not isinstance(value, str):
                raise ValueError('invalid project file path')
            normalized_id = str(project_id)
            if not value.startswith(f'projects/{normalized_id}/'):
                raise ValueError('file must be inside the project folder')
            target = ROOT.joinpath(*value.split('/'))
            if operation == 'favorite_add' and (target.is_symlink() or not target.is_file()):
                raise FileNotFoundError('project file not found')
            try:
                target.resolve(strict=operation == 'favorite_add').relative_to((ROOT / 'projects' / normalized_id).resolve(strict=True))
            except (OSError, ValueError) as exc:
                raise ValueError('project file is outside the project folder') from exc
            updated = _update_project_key_file(markdown, normalized_id, value, operation == 'favorite_add')
        else:
            raise ValueError('invalid project metadata operation')
        if updated == markdown:
            return {'ok': True, 'source': 'vault', 'projectId': project_id, 'manifestText': markdown, 'manifestSha': current_sha}
        if manifest_path.read_bytes() != original:
            raise ProjectManifestConflict('project.md changed. Reload the project before saving again.')
        newline = '\r\n' if b'\r\n' in original else '\n'
        encoded = updated.replace('\r\n', '\n').replace('\n', newline).encode('utf-8')
        temporary_path: Path | None = None
        try:
            with tempfile.NamedTemporaryFile(mode='wb', delete=False, dir=manifest_path.parent, prefix='.project-', suffix='.tmp') as temporary_file:
                temporary_path = Path(temporary_file.name)
                temporary_file.write(encoded)
                temporary_file.flush()
                os.fsync(temporary_file.fileno())
            if manifest_path.read_bytes() != original:
                raise ProjectManifestConflict('project.md changed. Reload the project before saving again.')
            os.replace(temporary_path, manifest_path)
        finally:
            if temporary_path is not None and temporary_path.exists():
                temporary_path.unlink()
        saved = manifest_path.read_bytes()
        return {'ok': True, 'source': 'vault', 'projectId': project_id, 'manifestText': saved.decode('utf-8'), 'manifestSha': hashlib.sha256(saved).hexdigest()}


def _project_workspace(project_id: object) -> dict[str, object]:
    if not isinstance(project_id, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,127}', project_id):
        raise ValueError('invalid project id')
    root = ROOT / 'projects' / project_id
    if not root.is_dir() or root.is_symlink():
        raise FileNotFoundError('project folder not found')
    resolved_root = root.resolve(strict=True)
    try:
        resolved_root.relative_to(ROOT.resolve())
    except ValueError as exc:
        raise ValueError('project folder is outside the Vault') from exc
    root = resolved_root
    files: list[dict[str, object]] = []
    folders: set[str] = set()
    recent: list[dict[str, object]] = []
    allowed_recent = {'.ppt', '.pptx', '.md', '.doc', '.docx'}
    ignored = {'.git', '.obsidian', '.trash', '.tmp', '__pycache__', 'node_modules', '.next'}
    for directory, names, filenames in os.walk(root, topdown=True, followlinks=False):
        current = Path(directory)
        names[:] = [name for name in names if name.lower() not in ignored and not (current / name).is_symlink()]
        relative_directory = current.relative_to(root).as_posix()
        if relative_directory != '.':
            folders.add(f'projects/{project_id}/{relative_directory}')
        for name in filenames:
            file_path = current / name
            if file_path.is_symlink() or not file_path.is_file():
                continue
            try:
                metadata = file_path.stat()
            except OSError:
                continue
            relative_path = file_path.relative_to(ROOT).as_posix()
            modified_at = datetime.fromtimestamp(metadata.st_mtime).astimezone().isoformat(timespec='seconds')
            row = {'path': relative_path, 'type': 'blob', 'size': metadata.st_size, 'modifiedAt': modified_at}
            files.append(row)
            if file_path.suffix.lower() in allowed_recent:
                recent.append({**row, 'name': file_path.name, 'extension': file_path.suffix.lower()})
            parent = relative_path.rpartition('/')[0]
            while parent.startswith(f'projects/{project_id}'):
                folders.add(parent)
                if parent == f'projects/{project_id}':
                    break
                parent = parent.rpartition('/')[0]
    recent.sort(key=lambda item: str(item['modifiedAt']), reverse=True)
    manifest_text: str | None = None
    manifest_sha: str | None = None
    try:
        manifest_text, manifest_sha, _, _ = _project_manifest_snapshot(project_id)
    except FileNotFoundError:
        pass
    return {
        'ok': True,
        'source': 'vault',
        'projectId': project_id,
        'rootPath': f'projects/{project_id}',
        'items': sorted(files, key=lambda item: str(item['path']).casefold()),
        'folders': sorted(folders, key=str.casefold),
        'recentFiles': recent[:10],
        'manifestText': manifest_text,
        'manifestSha': manifest_sha,
    }


def _resolve_portal_db_path():
    if os.environ.get('PORTAL_NOTICES_DB_PATH', '').strip():
        return portal_db.resolve_db_path()
    for root in (bridge_config.root, bridge_config.root / 'master-thesis-os'):
        source_directory = root / 'local-bridge'
        if (source_directory / 'portal_db.py').is_file():
            return (source_directory / 'data' / 'portal-notices.db').resolve(strict=False)
    return portal_db.resolve_db_path()


PORTAL_DB_PATH = _resolve_portal_db_path()

MAIL_JOB_LOCK = threading.Lock()
MAIL_JOB_THREAD: threading.Thread | None = None
MAIL_JOB_KIND: str | None = None
MAIL_JOB_ERROR: str | None = None
PORTAL_JOB_LOCK = threading.Lock()
PORTAL_JOB_THREAD: threading.Thread | None = None
PORTAL_JOB_KIND: str | None = None
PORTAL_JOB_ERROR: str | None = None
PORTAL_JOB_ERROR_CODE: str | None = None


def launch(path: Path):
    system = platform.system()
    if system == 'Windows':
        os.startfile(str(path))
    elif system == 'Darwin':
        subprocess.Popen(['open', str(path)])
    else:
        subprocess.Popen(['xdg-open', str(path)])


def _mail_job_active() -> bool:
    return MAIL_JOB_THREAD is not None and MAIL_JOB_THREAD.is_alive()


def _remember_job_end(error: str | None = None) -> None:
    global MAIL_JOB_THREAD, MAIL_JOB_KIND, MAIL_JOB_ERROR
    with MAIL_JOB_LOCK:
        MAIL_JOB_THREAD = None
        MAIL_JOB_KIND = None
        MAIL_JOB_ERROR = error


def _run_sync_job() -> None:
    try:
        mail_cli.sync_mail(bridge_config.thunderbird, DB_PATH)
    except Exception:
        # The database contains per-folder progress. Keep the public error
        # deliberately generic so paths, mail content, and provider details do
        # not enter bridge output or logs.
        message = '메일 동기화 작업이 중단되었어.'
        for folder in mail_db.TARGET_FOLDERS:
            try:
                mail_db.fail_sync_folder(folder, mail_db.now_iso(), message, DB_PATH)
            except mail_db.MailDatabaseError:
                pass
        _remember_job_end(message)
    else:
        _remember_job_end()


def _run_reanalyze_job(mail_id: str) -> None:
    try:
        mail_cli.reanalyze_mail(mail_id, mail_cli.load_settings(), DB_PATH)
    except Exception:
        try:
            _api_url, _api_key, model = mail_cli._provider_config()
            mail_db.save_failed(mail_id, '메일 재분석 작업이 중단되었어.', mail_cli.PROMPT_VERSION, model, DB_PATH)
        except Exception:
            pass
        _remember_job_end('메일 재분석 작업이 중단되었어.')
    else:
        _remember_job_end()


def start_sync_job() -> bool:
    global MAIL_JOB_THREAD, MAIL_JOB_KIND, MAIL_JOB_ERROR
    with MAIL_JOB_LOCK:
        if _mail_job_active():
            return False
        MAIL_JOB_ERROR = None
        MAIL_JOB_KIND = 'sync'
        MAIL_JOB_THREAD = threading.Thread(target=_run_sync_job, name='mail-sync', daemon=True)
        MAIL_JOB_THREAD.start()
        return True


def start_reanalyze_job(mail_id: str) -> bool:
    global MAIL_JOB_THREAD, MAIL_JOB_KIND, MAIL_JOB_ERROR
    with MAIL_JOB_LOCK:
        if _mail_job_active():
            return False
        MAIL_JOB_ERROR = None
        MAIL_JOB_KIND = 'reanalyze'
        MAIL_JOB_THREAD = threading.Thread(target=_run_reanalyze_job, args=(mail_id,), name='mail-reanalyze', daemon=True)
        MAIL_JOB_THREAD.start()
        return True


def _portal_job_active() -> bool:
    return PORTAL_JOB_THREAD is not None and PORTAL_JOB_THREAD.is_alive()


def _remember_portal_job_end(error: str | None = None, error_code: str | None = None) -> None:
    global PORTAL_JOB_THREAD, PORTAL_JOB_KIND, PORTAL_JOB_ERROR, PORTAL_JOB_ERROR_CODE
    with PORTAL_JOB_LOCK:
        PORTAL_JOB_THREAD = None
        PORTAL_JOB_KIND = None
        PORTAL_JOB_ERROR = error
        PORTAL_JOB_ERROR_CODE = error_code


def _run_portal_sync_job() -> None:
    try:
        from portal_cli import sync_portal

        sync_portal(ROOT, PORTAL_DB_PATH)
    except Exception as exc:
        code = getattr(exc, 'code', 'parsing_failed')
        message = getattr(exc, 'message', '학교 공지 동기화가 중단되었어.')
        _remember_portal_job_end(message, code)
    else:
        _remember_portal_job_end()


def _run_portal_login_job() -> None:
    try:
        from portal_cli import login_portal

        login_portal(ROOT, PORTAL_DB_PATH)
    except Exception as exc:
        code = getattr(exc, 'code', 'portal_unreachable')
        message = getattr(exc, 'message', '학교 포털 로그인 창을 처리하지 못했어.')
        _remember_portal_job_end(message, code)
    else:
        _remember_portal_job_end()


def _run_portal_ai_job(notice_id: str) -> None:
    try:
        import portal_ai

        notice = portal_db.get_notice(notice_id, PORTAL_DB_PATH)
        if notice is None:
            raise portal_ai.PortalAIError('공지 상세를 찾지 못했어.', 'notice_not_found')
        if not portal_db.claim_notice_analysis(notice_id, PORTAL_DB_PATH):
            raise portal_ai.PortalAIError('공지 AI 분석 작업을 시작하지 못했어.', 'ai_job_already_running')
        result = portal_ai.analyze_notice(notice)
        portal_db.save_notice_analysis(
            notice_id,
            result,
            portal_ai.PROMPT_VERSION,
            portal_ai.provider_model(),
            portal_db.now_iso(),
            PORTAL_DB_PATH,
        )
    except Exception as exc:
        code = getattr(exc, 'code', 'ai_provider_failed')
        message = getattr(exc, 'message', str(exc) or '공지 AI 분석이 중단되었어.')
        try:
            portal_db.save_notice_analysis_failed(notice_id, code, message, PORTAL_DB_PATH)
        except Exception:
            pass
        _remember_portal_job_end(message, code)
    else:
        _remember_portal_job_end()


def start_portal_sync_job() -> bool:
    global PORTAL_JOB_THREAD, PORTAL_JOB_KIND, PORTAL_JOB_ERROR, PORTAL_JOB_ERROR_CODE
    with PORTAL_JOB_LOCK:
        if _portal_job_active():
            return False
        PORTAL_JOB_ERROR = None
        PORTAL_JOB_ERROR_CODE = None
        PORTAL_JOB_KIND = 'sync'
        PORTAL_JOB_THREAD = threading.Thread(target=_run_portal_sync_job, name='portal-sync', daemon=True)
        PORTAL_JOB_THREAD.start()
        return True


def start_portal_login_job() -> bool:
    global PORTAL_JOB_THREAD, PORTAL_JOB_KIND, PORTAL_JOB_ERROR, PORTAL_JOB_ERROR_CODE
    with PORTAL_JOB_LOCK:
        if _portal_job_active():
            return False
        PORTAL_JOB_ERROR = None
        PORTAL_JOB_ERROR_CODE = None
        PORTAL_JOB_KIND = 'login'
        PORTAL_JOB_THREAD = threading.Thread(target=_run_portal_login_job, name='portal-login', daemon=True)
        PORTAL_JOB_THREAD.start()
        return True


def start_portal_notice_analysis(notice_id: str, *, force: bool = False) -> bool:
    global PORTAL_JOB_THREAD, PORTAL_JOB_KIND, PORTAL_JOB_ERROR, PORTAL_JOB_ERROR_CODE
    with PORTAL_JOB_LOCK:
        if _portal_job_active():
            return False
        if not portal_db.queue_notice_analysis(notice_id, PORTAL_DB_PATH, force=force):
            return False
        PORTAL_JOB_ERROR = None
        PORTAL_JOB_ERROR_CODE = None
        PORTAL_JOB_KIND = 'ai'
        PORTAL_JOB_THREAD = threading.Thread(
            target=_run_portal_ai_job,
            args=(notice_id,),
            name='portal-ai-analysis',
            daemon=True,
        )
        PORTAL_JOB_THREAD.start()
        return True


def _safe_query_int(values: dict[str, list[str]], key: str, default: int) -> int:
    raw = values.get(key, [str(default)])[0]
    try:
        return int(raw)
    except (TypeError, ValueError):
        return default


class Handler(BaseHTTPRequestHandler):
    def cors(self):
        origin = self.headers.get('Origin', '')
        if origin in ORIGINS:
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Vary', 'Origin')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, X-Bridge-Token')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS, GET')
        if allows_private_network(self.headers.get('Access-Control-Request-Private-Network', '')):
            self.send_header('Access-Control-Allow-Private-Network', 'true')

    def json_out(self, status, obj):
        data = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.cors()
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        origin = self.headers.get('Origin', '')
        if origin not in ORIGINS:
            print('[bridge] rejected preflight origin', file=sys.stderr, flush=True)
        self.send_response(204)
        self.cors()
        self.end_headers()

    def _path(self) -> str:
        return urlsplit(self.path).path

    def _query(self) -> dict[str, list[str]]:
        return parse_qs(urlsplit(self.path).query, keep_blank_values=True)

    def _origin_allowed(self) -> bool:
        origin = self.headers.get('Origin', '')
        if origin in ORIGINS:
            return True
        print('[bridge] rejected origin', file=sys.stderr, flush=True)
        self.json_out(403, {'error': 'origin not allowed'})
        return False

    def _header_authenticated(self) -> bool:
        if not self._origin_allowed():
            return False
        if not token_matches(self.headers.get('X-Bridge-Token', ''), TOKEN):
            self.json_out(403, {'error': 'invalid token'})
            return False
        return True

    def _read_json_body(self, max_bytes: int = MAX_BODY_BYTES) -> dict[str, object] | None:
        if self.headers.get_content_type() != 'application/json':
            self.json_out(415, {'error': 'application/json required'})
            return None
        try:
            length = int(self.headers.get('Content-Length', '0'))
        except (TypeError, ValueError):
            length = 0
        if length <= 0 or length > max_bytes:
            self.json_out(413, {'error': 'invalid request size'})
            return None
        try:
            value = json.loads(self.rfile.read(length))
        except (UnicodeDecodeError, json.JSONDecodeError, ValueError):
            self.json_out(400, {'error': 'invalid JSON'})
            return None
        if not isinstance(value, dict):
            self.json_out(400, {'error': 'JSON object required'})
            return None
        return value

    def _mail_status(self):
        status = mail_db.sync_status(DB_PATH)
        with MAIL_JOB_LOCK:
            active = _mail_job_active()
            job_kind = MAIL_JOB_KIND
            job_error = MAIL_JOB_ERROR
        return {
            'ok': True,
            'source': 'sqlite',
            **status,
            'jobRunning': active,
            **({'jobKind': job_kind} if job_kind else {}),
            **({'jobError': job_error} if job_error else {}),
        }

    def _portal_status(self):
        try:
            from portal_client import profile_session_state, resolve_profile_path

            session_state = profile_session_state(resolve_profile_path(ROOT))
        except Exception:
            session_state = 'unknown'
        with PORTAL_JOB_LOCK:
            active = _portal_job_active()
            job_kind = PORTAL_JOB_KIND
            job_error = PORTAL_JOB_ERROR
            job_error_code = PORTAL_JOB_ERROR_CODE
        if not active and job_kind is None:
            # A Bridge restart loses the in-memory worker flag while SQLite
            # may still contain the previous run's `running` state. Recover
            # that stale state before exposing status to the UI.
            portal_db.recover_interrupted_sync(PORTAL_DB_PATH)
            portal_db.recover_interrupted_ai(PORTAL_DB_PATH)
        status = portal_db.sync_status(PORTAL_DB_PATH)
        persisted_error_code = status.get('lastErrorCode')
        effective_error_code = job_error_code or persisted_error_code
        if effective_error_code in {'login_required', 'session_expired'}:
            session_state = effective_error_code
        return {
            'ok': True,
            **status,
            'source': 'sqlite',
            'session': {'state': session_state},
            'jobRunning': active,
            **({'jobKind': job_kind} if job_kind else {}),
            **({'jobError': job_error} if job_error else {}),
            **({'jobErrorCode': job_error_code} if job_error_code else {}),
        }

    def _portal_notices_response(self):
        query = self._query()
        type_values = query.get('type', [])
        notice_type = type_values[0].strip().upper() if type_values else None
        if notice_type == '':
            notice_type = None
        if notice_type is not None and notice_type not in portal_db.NOTICE_TYPES:
            return self.json_out(400, {'ok': False, 'source': 'sqlite', 'error': 'unsupported portal notice type'})
        department_values = query.get('department', [])
        department = department_values[0].strip() if department_values else None
        if department == '':
            department = None
        limit = max(1, min(500, _safe_query_int(query, 'limit', 100)))
        items = portal_db.list_notices(
            PORTAL_DB_PATH,
            notice_type=notice_type,
            department=department,
            limit=limit,
        )
        return self.json_out(200, {
            'ok': True,
            'source': 'sqlite',
            'items': items,
            'departments': portal_db.notice_departments(PORTAL_DB_PATH),
            'sync': self._portal_status(),
        })

    def _single_portal_notice_response(self, notice_id: str):
        if not notice_id or len(notice_id) > 512:
            return self.json_out(400, {'ok': False, 'source': 'sqlite', 'error': 'notice not found'})
        item = portal_db.get_notice(notice_id, PORTAL_DB_PATH)
        if item is None:
            return self.json_out(404, {'ok': False, 'source': 'sqlite', 'error': 'notice not found'})
        return self.json_out(200, {'ok': True, 'source': 'sqlite', 'item': item})

    def _planner_tasks_response(self):
        with PLANNER_TASKS_STORE_LOCK:
            tasks = _read_planner_tasks_unlocked()
        return self.json_out(200, {'ok': True, 'source': 'vault', 'version': 1, 'tasks': tasks})

    def _analysis_response(self):
        query = self._query()
        folder_values = query.get('folder', [])
        folder = folder_values[0].strip() if folder_values else None
        if folder == '':
            folder = None
        if folder is not None and folder not in mail_db.TARGET_FOLDERS:
            return self.json_out(400, {'ok': False, 'source': 'sqlite', 'error': 'unsupported mail analysis folder'})
        limit = max(1, min(100, _safe_query_int(query, 'limit', 100)))
        items = mail_db.list_analysis(DB_PATH, folder=folder, limit=limit)
        return self.json_out(200, {
            'ok': True,
            'source': 'sqlite',
            'folders': list(mail_db.TARGET_FOLDERS),
            'items': items,
            'sync': self._mail_status(),
        })

    def _planning_response(self):
        return self.json_out(200, {
            'ok': True,
            'source': 'sqlite',
            'folders': list(mail_db.TARGET_FOLDERS),
            'tasks': mail_db.list_tasks(DB_PATH, limit=200),
            'items': mail_db.list_analysis(DB_PATH, limit=100),
            'sync': self._mail_status(),
        })

    def _single_analysis_response(self, mail_id: str):
        if not mail_id or len(mail_id) > 256:
            return self.json_out(400, {'ok': False, 'source': 'sqlite', 'error': 'mail not found'})
        item = mail_db.get_analysis(DB_PATH, mail_id)
        if item is None:
            return self.json_out(404, {'ok': False, 'source': 'sqlite', 'error': 'mail not found'})
        return self.json_out(200, {'ok': True, 'source': 'sqlite', 'item': item})

    def do_GET(self):
        path = self._path()
        if path == '/health':
            return self.json_out(200, {'ok': True, 'apiVersion': BRIDGE_API_VERSION})
        if path == '/inbox':
            if not self._header_authenticated():
                return
            try:
                with INBOX_STORE_LOCK:
                    entries = _read_inbox_entries_unlocked()
            except (OSError, ValueError):
                return self.json_out(503, {
                    'ok': False,
                    'source': 'vault',
                    'errorCode': 'inbox_read_failed',
                    'error': 'Vault 인박스 파일을 읽지 못했어요. 기존 원문 파일은 보존했습니다.',
                })
            return self.json_out(200, {'ok': True, 'source': 'vault', 'version': 1, 'entries': entries})
        if path == '/planner/tasks':
            if not self._header_authenticated():
                return
            try:
                return self._planner_tasks_response()
            except (OSError, ValueError, json.JSONDecodeError):
                return self.json_out(503, {
                    'ok': False,
                    'source': 'vault',
                    'errorCode': 'planner_read_failed',
                    'error': 'Vault Planner 할 일 파일을 읽지 못했어요. 기존 파일은 변경하지 않았습니다.',
                })
        if path == '/portal/status':
            if not self._header_authenticated():
                return
            try:
                return self.json_out(200, self._portal_status())
            except portal_db.PortalDatabaseError:
                return self.json_out(503, {'ok': False, 'source': 'sqlite', 'error': 'database_error'})
        if path == '/portal/notices':
            if not self._header_authenticated():
                return
            try:
                return self._portal_notices_response()
            except portal_db.PortalDatabaseError:
                return self.json_out(503, {'ok': False, 'source': 'sqlite', 'error': 'database_error'})
        if path.startswith('/portal/notices/'):
            if not self._header_authenticated():
                return
            notice_id = unquote(path[len('/portal/notices/'):])
            try:
                return self._single_portal_notice_response(notice_id)
            except portal_db.PortalDatabaseError:
                return self.json_out(503, {'ok': False, 'source': 'sqlite', 'error': 'database_error'})
        if path == '/mail/sync-status':
            if not self._header_authenticated():
                return
            try:
                return self.json_out(200, self._mail_status())
            except mail_db.MailDatabaseError:
                return self.json_out(503, {'ok': False, 'source': 'sqlite', 'error': 'database_unavailable'})
        if path == '/mail/analysis':
            if not self._header_authenticated():
                return
            try:
                return self._analysis_response()
            except mail_db.MailDatabaseError:
                return self.json_out(503, {'ok': False, 'source': 'sqlite', 'error': 'database_unavailable'})
        if path == '/mail/planning':
            if not self._header_authenticated():
                return
            try:
                return self._planning_response()
            except mail_db.MailDatabaseError:
                return self.json_out(503, {'ok': False, 'source': 'sqlite', 'error': 'database_unavailable'})
        if path.startswith('/mail/analysis/'):
            if not self._header_authenticated():
                return
            mail_id = unquote(path[len('/mail/analysis/'):])
            try:
                return self._single_analysis_response(mail_id)
            except mail_db.MailDatabaseError:
                return self.json_out(503, {'ok': False, 'source': 'sqlite', 'error': 'database_unavailable'})
        return self.json_out(404, {'error': 'not found'})

    def _legacy_mail_post(self, path: str, body: dict[str, object]):
        if path == '/mail/recent':
            try:
                folder = normalize_folder_id(body.get('folder', 'inbox'))
                account, items = get_recent_mail(bridge_config.thunderbird, clamp_mail_limit(body.get('limit', 5)), folder)
            except ThunderbirdMailError as exc:
                return self.json_out(exc.http_status, {'ok': False, 'source': 'thunderbird', 'error': exc.code})
            return self.json_out(200, {
                'ok': True,
                'source': 'thunderbird',
                'account': account,
                'folder': folder,
                'items': [item.to_dict() for item in items],
            })
        if path == '/mail/folders':
            try:
                account, folders = get_mail_folders(bridge_config.thunderbird)
            except ThunderbirdMailError as exc:
                return self.json_out(exc.http_status, {'ok': False, 'source': 'thunderbird', 'error': exc.code})
            return self.json_out(200, {
                'ok': True,
                'source': 'thunderbird',
                'account': account,
                'folders': [folder.to_dict() for folder in folders],
            })
        if path == '/mail/message':
            try:
                folder = normalize_folder_id(body.get('folder', 'inbox'))
                account, message = get_mail_message(bridge_config.thunderbird, body.get('mailId'), folder)
            except ThunderbirdMailError as exc:
                return self.json_out(exc.http_status, {'ok': False, 'source': 'thunderbird', 'error': exc.code})
            return self.json_out(200, {
                'ok': True,
                'source': 'thunderbird',
                'account': account,
                'folder': folder,
                'item': message.item.to_dict(),
                'body': message.body,
            })
        if path == '/mail/open':
            try:
                message_id = body.get('messageId') if 'messageId' in body else None
                launch_thunderbird(message_id)
            except ThunderbirdMailError as exc:
                return self.json_out(exc.http_status, {'ok': False, 'source': 'thunderbird', 'error': exc.code})
            return self.json_out(200, {'ok': True, 'source': 'thunderbird'})
        return None

    def _analysis_post(self, path: str, body: dict[str, object]):
        if path == '/mail/sync':
            if not start_sync_job():
                return self.json_out(409, {'ok': False, 'source': 'sqlite', 'error': 'sync_already_running'})
            return self.json_out(202, {'ok': True, 'source': 'sqlite', 'status': 'running', 'jobKind': 'sync'})

        if path == '/mail/analysis/candidate':
            mail_id = body.get('mailId')
            candidate_id = body.get('candidateId')
            status = body.get('status')
            if not all(isinstance(value, str) and value.strip() for value in (mail_id, candidate_id, status)):
                return self.json_out(400, {'ok': False, 'source': 'sqlite', 'error': 'invalid candidate request'})
            try:
                candidate = mail_db.update_candidate(
                    mail_id.strip(),
                    candidate_id.strip(),
                    status.strip(),
                    title=body.get('title') if isinstance(body.get('title'), str) else None,
                    start=body.get('start') if isinstance(body.get('start'), str) else None,
                    end=body.get('end') if isinstance(body.get('end'), str) else None,
                    all_day=body.get('allDay') if isinstance(body.get('allDay'), bool) else None,
                    calendar_event_id=body.get('calendarEventId') if isinstance(body.get('calendarEventId'), str) else None,
                    path=DB_PATH,
                )
            except mail_db.MailDatabaseError as exc:
                return self.json_out(404 if 'not found' in str(exc) else 400, {'ok': False, 'source': 'sqlite', 'error': str(exc)})
            return self.json_out(200, {'ok': True, 'source': 'sqlite', 'candidate': candidate})

        if path == '/mail/task':
            task_id = body.get('taskId')
            status = body.get('status')
            if not isinstance(task_id, str) or not task_id.strip() or len(task_id) > 256 or not isinstance(status, str) or not status.strip():
                return self.json_out(400, {'ok': False, 'source': 'sqlite', 'error': 'invalid mail task request'})
            try:
                task = mail_db.update_task(
                    task_id.strip(),
                    status.strip(),
                    title=body.get('title') if isinstance(body.get('title'), str) else None,
                    description=body.get('description') if isinstance(body.get('description'), str) else None,
                    due_at=body.get('dueAt') if isinstance(body.get('dueAt'), str) else None,
                    path=DB_PATH,
                )
            except mail_db.MailDatabaseError as exc:
                return self.json_out(404 if 'not found' in str(exc) else 400, {'ok': False, 'source': 'sqlite', 'error': str(exc)})
            return self.json_out(200, {'ok': True, 'source': 'sqlite', 'task': task})

        prefix = '/mail/analysis/'
        if path.startswith(prefix) and path.endswith('/reanalyze'):
            mail_id = unquote(path[len(prefix):-len('/reanalyze')]).strip()
            if not mail_id or len(mail_id) > 256:
                return self.json_out(400, {'ok': False, 'source': 'sqlite', 'error': 'mail not found'})
            try:
                if mail_db.get_analysis(DB_PATH, mail_id) is None:
                    return self.json_out(404, {'ok': False, 'source': 'sqlite', 'error': 'mail not found'})
                if not mail_db.queue_analysis(mail_id, DB_PATH, force=True):
                    return self.json_out(400, {'ok': False, 'source': 'sqlite', 'error': 'mail analysis could not be queued'})
            except mail_db.MailDatabaseError:
                return self.json_out(503, {'ok': False, 'source': 'sqlite', 'error': 'database_unavailable'})
            if not start_reanalyze_job(mail_id):
                return self.json_out(409, {'ok': False, 'source': 'sqlite', 'error': 'mail_job_already_running'})
            return self.json_out(202, {'ok': True, 'source': 'sqlite', 'status': 'queued', 'mailId': mail_id})
        return None

    def _portal_post(self, path: str, body: dict[str, object] | None = None):
        if path == '/inbox/organize' and body is not None:
            import portal_ai

            try:
                entries = portal_ai.organize_inbox_entries(body.get('entries'))
            except portal_ai.PortalAIError as exc:
                status = 400 if exc.code == 'inbox_entries_invalid' else 503
                return self.json_out(status, {
                    'ok': False,
                    'source': 'ai_provider',
                    'errorCode': exc.code,
                    'error': str(exc),
                })
            return self.json_out(200, {
                'ok': True,
                'source': 'ai_provider',
                'model': portal_ai.provider_model(),
                'entries': entries,
            })
        if path == '/portal/sync':
            if not start_portal_sync_job():
                return self.json_out(409, {'ok': False, 'source': 'sqlite', 'error': 'sync_already_running'})
            return self.json_out(202, {'ok': True, 'source': 'sqlite', 'status': 'running', 'jobKind': 'sync'})
        if path == '/portal/login':
            if not start_portal_login_job():
                return self.json_out(409, {'ok': False, 'source': 'sqlite', 'error': 'portal_job_already_running'})
            return self.json_out(202, {'ok': True, 'source': 'sqlite', 'status': 'running', 'jobKind': 'login'})
        if path == '/portal/open-url':
            url = body.get('url') if body is not None else None
            if not isinstance(url, str) or not url.strip():
                return self.json_out(400, {
                    'ok': False,
                    'source': 'default_browser',
                    'errorCode': 'invalid_url',
                    'error': '브라우저로 열 URL이 필요해.',
                })
            try:
                from portal_client import PortalError, open_url_in_default_browser

                open_url_in_default_browser(url)
            except PortalError as exc:
                status = 400 if exc.code == 'invalid_url' else 503
                return self.json_out(status, {
                    'ok': False,
                    'source': 'default_browser',
                    'errorCode': exc.code,
                    'error': exc.message,
                })
            return self.json_out(200, {'ok': True, 'source': 'default_browser'})
        prefix = '/portal/notices/'
        if body is not None and path.startswith(prefix) and path.endswith('/analyze'):
            notice_id = unquote(path[len(prefix):-len('/analyze')]).strip()
            if not notice_id or len(notice_id) > 512:
                return self.json_out(400, {'ok': False, 'source': 'sqlite', 'error': 'notice not found'})
            if portal_db.get_notice(notice_id, PORTAL_DB_PATH) is None:
                return self.json_out(404, {'ok': False, 'source': 'sqlite', 'error': 'notice not found'})
            if not start_portal_notice_analysis(notice_id, force=body.get('force') is True):
                return self.json_out(409, {'ok': False, 'source': 'sqlite', 'error': 'ai_job_already_running'})
            return self.json_out(202, {'ok': True, 'source': 'sqlite', 'status': 'queued', 'jobKind': 'ai', 'noticeId': notice_id})
        if body is not None and path.startswith(prefix) and path.endswith('/candidate'):
            notice_id = unquote(path[len(prefix):-len('/candidate')]).strip()
            candidate_id = body.get('candidateId')
            status = body.get('status')
            if not notice_id or len(notice_id) > 512 or not isinstance(candidate_id, str) or not candidate_id.strip() or not isinstance(status, str) or not status.strip():
                return self.json_out(400, {'ok': False, 'source': 'sqlite', 'error': 'invalid portal notice candidate request'})
            try:
                candidate = portal_db.update_notice_calendar_candidate(
                    notice_id,
                    candidate_id.strip(),
                    status.strip(),
                    title=body.get('title') if isinstance(body.get('title'), str) else None,
                    start=body.get('start') if isinstance(body.get('start'), str) else None,
                    end=body.get('end') if isinstance(body.get('end'), str) else None,
                    all_day=body.get('allDay') if isinstance(body.get('allDay'), bool) else None,
                    calendar_event_id=body.get('calendarEventId') if isinstance(body.get('calendarEventId'), str) else None,
                    path=PORTAL_DB_PATH,
                )
            except portal_db.PortalDatabaseError as exc:
                return self.json_out(404 if 'not found' in str(exc) else 400, {'ok': False, 'source': 'sqlite', 'error': str(exc)})
            return self.json_out(200, {'ok': True, 'source': 'sqlite', 'candidate': candidate})
        if body is not None and path.startswith(prefix) and path.endswith('/state'):
            notice_id = unquote(path[len(prefix):-len('/state')]).strip()
            if not notice_id or len(notice_id) > 512:
                return self.json_out(400, {'ok': False, 'source': 'sqlite', 'error': 'notice not found'})
            state_fields = {
                'isRead': 'is_read',
                'isImportant': 'is_important',
                'isInterested': 'is_interested',
                'interest': 'interest',
                'isArchived': 'is_archived',
            }
            provided = {key: body.get(key) for key in state_fields if key in body}
            invalid_state = not provided or any(
                (key == 'interest' and (not isinstance(value, int) or isinstance(value, bool) or value not in {0, 1, 2, 3}))
                or (key != 'interest' and not isinstance(value, bool))
                for key, value in provided.items()
            )
            if invalid_state:
                return self.json_out(400, {'ok': False, 'source': 'sqlite', 'error': 'invalid notice state'})
            try:
                item = portal_db.update_notice_state(
                    notice_id,
                    **{
                        state_fields[key]: value
                        for key, value in provided.items()
                    },
                    path=PORTAL_DB_PATH,
                )
            except portal_db.PortalDatabaseError as exc:
                if 'not found' in str(exc):
                    return self.json_out(404, {'ok': False, 'source': 'sqlite', 'error': 'notice not found'})
                raise
            return self.json_out(200, {'ok': True, 'source': 'sqlite', 'item': item})
        return None

    def do_POST(self):
        path = self._path()
        allowed = (
            '/open', '/open-folder', '/launch', '/mail/recent', '/mail/folders',
            '/mail/message', '/mail/open', '/mail/sync', '/mail/analysis/candidate', '/mail/task',
            '/portal/sync', '/portal/login', '/portal/open-url', '/inbox', '/inbox/organize', '/planner/tasks',
            '/projects/workspace', '/projects/update',
        )
        is_portal_state = path.startswith('/portal/notices/') and path.endswith('/state')
        is_portal_analyze = path.startswith('/portal/notices/') and path.endswith('/analyze')
        is_portal_candidate = path.startswith('/portal/notices/') and path.endswith('/candidate')
        if path not in allowed and not is_portal_state and not is_portal_analyze and not is_portal_candidate and not (path.startswith('/mail/analysis/') and path.endswith('/reanalyze')):
            return self.json_out(404, {'error': 'not found'})
        if not self._origin_allowed():
            return
        body_limit = MAX_INBOX_BODY_BYTES if path == '/inbox' else MAX_PLANNER_BODY_BYTES if path == '/planner/tasks' else MAX_BODY_BYTES
        body = self._read_json_body(body_limit)
        if body is None:
            return
        if not token_matches(body.get('token', ''), TOKEN):
            return self.json_out(403, {'error': 'invalid token'})
        try:
            if path == '/inbox':
                entries = _merge_and_save_inbox_entries(body.get('entries'))
                return self.json_out(200, {'ok': True, 'source': 'vault', 'version': 1, 'entries': entries})
            if path == '/planner/tasks':
                task = body.get('task')
                tasks = _merge_and_save_planner_tasks(body.get('tasks'), single_task=task)
                return self.json_out(200, {'ok': True, 'source': 'vault', 'version': 1, 'tasks': tasks})
            if path == '/projects/workspace':
                return self.json_out(200, _project_workspace(body.get('projectId')))
            if path == '/projects/update':
                return self.json_out(200, _update_project_metadata(body))
            portal_response = self._portal_post(path, body)
            if portal_response is not None:
                return portal_response
            analysis_response = self._analysis_post(path, body)
            if analysis_response is not None:
                return analysis_response
            legacy_response = self._legacy_mail_post(path, body)
            if legacy_response is not None:
                return legacy_response
            if path == '/launch':
                request = normalize_shortcut_request(body)
                launch_shortcut(request)
                return self.json_out(200, {'ok': True, 'type': request['type']})
            target = target_for_endpoint(ROOT, path, str(body.get('path', '')))
            launch(target)
            return self.json_out(200, {'ok': True, 'path': str(target)})
        except FileNotFoundError as exc:
            if path == '/inbox':
                return self.json_out(503, {
                    'ok': False,
                    'source': 'vault',
                    'errorCode': 'inbox_persist_failed',
                    'error': 'Vault에 인박스를 저장하지 못했어요. 브라우저 캐시는 유지됩니다.',
                })
            if path == '/planner/tasks':
                return self.json_out(503, {
                    'ok': False,
                    'source': 'vault',
                    'errorCode': 'planner_persist_failed',
                    'error': 'Vault Planner 할 일을 저장하지 못했어요. 브라우저 캐시는 유지됩니다.',
                })
            if path == '/projects/workspace':
                return self.json_out(404, {'ok': False, 'source': 'vault', 'error': 'project workspace item not found'})
            if path == '/projects/update':
                return self.json_out(404, {'ok': False, 'source': 'vault', 'error': 'project metadata not found'})
            if path.startswith(MAIL_PATH_PREFIX):
                return self.json_out(503, {'ok': False, 'source': 'thunderbird', 'error': 'profile_not_found'})
            return self.json_out(404, {'error': 'local file not found', 'detail': str(exc)})
        except ThunderbirdMailError as exc:
            return self.json_out(exc.http_status, {'ok': False, 'source': 'thunderbird', 'error': exc.code})
        except mail_db.MailDatabaseError:
            return self.json_out(503, {'ok': False, 'source': 'sqlite', 'error': 'database_unavailable'})
        except portal_db.PortalDatabaseError:
            return self.json_out(503, {'ok': False, 'source': 'sqlite', 'error': 'database_error'})
        except ProjectManifestConflict as exc:
            return self.json_out(409, {'ok': False, 'source': 'vault', 'error': str(exc)})
        except ValueError as exc:
            if path == '/inbox':
                return self.json_out(400, {
                    'ok': False,
                    'source': 'vault',
                    'errorCode': 'invalid_inbox_data',
                    'error': '인박스 데이터 형식을 확인해 주세요. 기존 원문은 변경하지 않았습니다.',
                })
            if path == '/planner/tasks':
                return self.json_out(400, {
                    'ok': False,
                    'source': 'vault',
                    'errorCode': 'invalid_planner_data',
                    'error': 'Planner 할 일 데이터 형식을 확인해 주세요. 기존 파일은 변경하지 않았습니다.',
                })
            if path == '/projects/update':
                return self.json_out(400, {'ok': False, 'source': 'vault', 'error': str(exc)})
            if path.startswith(MAIL_PATH_PREFIX):
                return self.json_out(400, {'ok': False, 'source': 'sqlite', 'error': 'request_failed'})
            return self.json_out(400, {'error': 'request failed'})
        except OSError:
            if path == '/inbox':
                return self.json_out(503, {
                    'ok': False,
                    'source': 'vault',
                    'errorCode': 'inbox_persist_failed',
                    'error': 'Vault에 인박스를 저장하지 못했어요. 브라우저 캐시는 유지됩니다.',
                })
            if path.startswith(MAIL_PATH_PREFIX):
                return self.json_out(400, {'ok': False, 'source': 'sqlite', 'error': 'request_failed'})
            return self.json_out(400, {'error': 'request failed'})
        except Exception:
            if path.startswith(MAIL_PATH_PREFIX):
                return self.json_out(400, {'ok': False, 'source': 'sqlite', 'error': 'request_failed'})
            return self.json_out(400, {'error': 'request failed'})

    def log_message(self, fmt, *args):
        # Do not log URL paths, query strings, mail IDs, request bodies, or
        # bridge tokens. The status code is enough for local diagnostics.
        print('[bridge] request', flush=True)


print(f'Master Thesis OS Bridge: http://127.0.0.1:{PORT}')
ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
