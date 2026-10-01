import hashlib
import json
import os
import re
import tempfile
import threading
from datetime import date, datetime, timezone
from pathlib import Path

MAX_INBOX_ENTRIES = 10_000
MAX_INBOX_RAW_CHARS = 1_200
MAX_INBOX_STORE_BYTES = 8 * 1024 * 1024
MAX_PLANNER_BODY_BYTES = 512 * 1024


class ProjectManifestConflict(Exception):
    pass


class WorkspaceStore:
    def __init__(self, root: Path):
        self._root = root
        self._inbox_data_path = root / 'shared' / 'inbox' / 'inbox.json'
        self._inbox_lock = threading.Lock()
        self._planner_tasks_data_path = root / 'shared' / 'planner' / 'tasks.json'
        self._planner_tasks_lock = threading.Lock()
        self._project_metadata_lock = threading.Lock()

    def load_inbox(self) -> list[dict[str, object]]:
        with self._inbox_lock:
            return self._read_inbox_entries_unlocked()

    def load_planner(self) -> tuple[list[dict[str, object]], set[str]]:
        with self._planner_tasks_lock:
            return self._read_planner_store_unlocked()

    def _valid_iso_timestamp(self, value: object) -> bool:
        if not isinstance(value, str) or not value or len(value) > 64:
            return False
        try:
            datetime.fromisoformat(value.replace('Z', '+00:00'))
        except ValueError:
            return False
        return True

    def _timestamp_value(self, value: str) -> datetime:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
        return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed.astimezone(timezone.utc)

    def _explicit_full_year_dates(self, raw_text: str) -> set[str]:
        patterns = (re.compile('(?<!\\d)(\\d{4})[-/.]\\s*(\\d{1,2})[-/.]\\s*(\\d{1,2})(?!\\d)'), re.compile('(?<!\\d)(\\d{4})\\s*년\\s*(\\d{1,2})\\s*월\\s*(\\d{1,2})\\s*일'))
        result: set[str] = set()
        for pattern in patterns:
            for match in pattern.finditer(raw_text):
                try:
                    result.add(date(*(int(part) for part in match.groups())).isoformat())
                except ValueError:
                    continue
        return result

    def _normalize_inbox_entry(self, raw: object) -> dict[str, object]:
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
        if not self._valid_iso_timestamp(created_at) or not isinstance(processed, bool):
            raise ValueError('invalid inbox entry metadata')
        ai: dict[str, object] | None = None
        if ai_raw is not None:
            if not isinstance(ai_raw, dict):
                raise ValueError('invalid inbox AI result')
            category = ai_raw.get('category')
            legacy_categories = {'Todo': 'todo', 'Idea': 'idea', 'Research Note': 'idea', 'Later / Reference': 'other'}
            if not isinstance(category, str):
                raise ValueError('invalid inbox AI category')
            category = legacy_categories.get(category, category)
            if category not in {'idea', 'todo', 'schedule', 'other'}:
                raise ValueError('invalid inbox AI category')
            if ai_raw.get('entryId') != entry_id or not self._valid_iso_timestamp(ai_raw.get('processedAt')):
                raise ValueError('invalid inbox AI identity')
            title = ai_raw.get('title')
            summary = ai_raw.get('summary')
            next_action = ai_raw.get('nextAction')
            due_date = ai_raw.get('dueDate')
            related_ids = ai_raw.get('relatedEntryIds')
            if not all((isinstance(value, str) for value in (title, summary, next_action))):
                raise ValueError('invalid inbox AI text')
            if len(title) > 1200 or len(summary) > 1200 or len(next_action) > 1200:
                raise ValueError('inbox AI text is too long')
            if category != 'todo' and next_action:
                next_action = ''
            if due_date is not None:
                if not isinstance(due_date, str) or not re.fullmatch('\\d{4}-\\d{2}-\\d{2}', due_date):
                    raise ValueError('invalid inbox AI date')
                try:
                    date.fromisoformat(due_date)
                except ValueError as exc:
                    raise ValueError('invalid inbox AI date') from exc
                if due_date not in self._explicit_full_year_dates(raw_text):
                    due_date = None
            if not isinstance(related_ids, list) or len(related_ids) > 4 or any((not isinstance(value, str) for value in related_ids)):
                raise ValueError('invalid inbox related entries')
            ai = {'entryId': entry_id, 'category': category, 'title': title, 'summary': summary, 'nextAction': next_action, 'dueDate': due_date, 'relatedEntryIds': [value for value in related_ids if value != entry_id], 'processedAt': ai_raw['processedAt']}
        if processed != (ai is not None):
            raise ValueError('inbox processed state does not match AI result')
        return {'id': entry_id, 'rawText': raw_text, 'createdAt': created_at, 'processed': processed, 'ai': ai}

    def _read_inbox_store_unlocked(self) -> tuple[list[dict[str, object]], set[str]]:
        if not self._inbox_data_path.exists():
            return ([], set())
        if self._inbox_data_path.stat().st_size > MAX_INBOX_STORE_BYTES:
            raise ValueError('inbox store is too large')
        with self._inbox_data_path.open('r', encoding='utf-8') as file:
            payload = json.load(file)
        if not isinstance(payload, dict) or payload.get('version') != 1 or (not isinstance(payload.get('entries'), list)):
            raise ValueError('invalid inbox store')
        if len(payload['entries']) > MAX_INBOX_ENTRIES:
            raise ValueError('too many inbox entries')
        raw_deleted_ids = payload.get('deletedEntryIds', [])
        if not isinstance(raw_deleted_ids, list) or any((not isinstance(value, str) or not value or len(value) > 256 for value in raw_deleted_ids)):
            raise ValueError('invalid deleted inbox entry ids')
        entries = [self._normalize_inbox_entry(raw) for raw in payload['entries']]
        ids = [entry['id'] for entry in entries]
        if len(ids) != len(set(ids)):
            raise ValueError('duplicate inbox entry id')
        return (entries, set(raw_deleted_ids))

    def _read_inbox_entries_unlocked(self) -> list[dict[str, object]]:
        return self._read_inbox_store_unlocked()[0]

    def _atomic_write_inbox_entries(self, entries: list[dict[str, object]], deleted_entry_ids: set[str] | None=None) -> None:
        self._inbox_data_path.parent.mkdir(parents=True, exist_ok=True)
        payload = json.dumps({'version': 1, 'entries': entries, 'deletedEntryIds': sorted(deleted_entry_ids or set())}, ensure_ascii=False, indent=2) + '\n'
        if len(payload.encode('utf-8')) > MAX_INBOX_STORE_BYTES:
            raise ValueError('inbox store is too large')
        temporary_path: Path | None = None
        try:
            with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', newline='\n', delete=False, dir=self._inbox_data_path.parent, prefix='.inbox-', suffix='.tmp') as temporary_file:
                temporary_path = Path(temporary_file.name)
                temporary_file.write(payload)
                temporary_file.flush()
                os.fsync(temporary_file.fileno())
            os.replace(temporary_path, self._inbox_data_path)
        finally:
            if temporary_path is not None and temporary_path.exists():
                temporary_path.unlink()

    def save_inbox(self, raw_entries: object) -> list[dict[str, object]]:
        if not isinstance(raw_entries, list) or len(raw_entries) > MAX_INBOX_ENTRIES:
            raise ValueError('invalid inbox entries')
        incoming = [self._normalize_inbox_entry(raw) for raw in raw_entries]
        incoming_ids = [entry['id'] for entry in incoming]
        if len(incoming_ids) != len(set(incoming_ids)):
            raise ValueError('duplicate inbox entry id')
        with self._inbox_lock:
            try:
                existing, deleted_entry_ids = self._read_inbox_store_unlocked()
            except (OSError, ValueError) as exc:
                raise OSError('inbox store could not be read') from exc
            merged = {entry['id']: entry for entry in existing}
            for entry in incoming:
                if entry['id'] in deleted_entry_ids:
                    continue
                previous = merged.get(entry['id'])
                if previous is None:
                    merged[entry['id']] = entry
                    continue
                # For an existing ID, id/rawText/createdAt always come from the Vault.
                next_entry = dict(previous)
                next_ai = entry['ai']
                previous_ai = previous['ai']
                if next_ai is not None and (previous_ai is None or str(next_ai['processedAt']) >= str(previous_ai['processedAt'])):
                    next_entry['processed'] = True
                    next_entry['ai'] = next_ai
                merged[entry['id']] = next_entry
            entry_ids = set(merged)
            for entry in merged.values():
                ai = entry['ai']
                if isinstance(ai, dict):
                    ai['relatedEntryIds'] = [value for value in ai['relatedEntryIds'] if value in entry_ids]
            result = sorted(merged.values(), key=lambda entry: str(entry['createdAt']), reverse=True)
            if len(result) > MAX_INBOX_ENTRIES:
                raise ValueError('too many inbox entries')
            self._atomic_write_inbox_entries(result, deleted_entry_ids)
            return result

    def delete_inbox(self, entry_id: object) -> tuple[list[dict[str, object]], list[str]]:
        if not isinstance(entry_id, str) or not entry_id.strip() or len(entry_id) > 256:
            raise ValueError('invalid inbox entry id')
        with self._inbox_lock:
            try:
                existing, deleted_entry_ids = self._read_inbox_store_unlocked()
            except (OSError, ValueError, json.JSONDecodeError) as exc:
                raise OSError('inbox store could not be read') from exc
            result = [entry for entry in existing if entry['id'] != entry_id]
            for entry in result:
                ai = entry['ai']
                if isinstance(ai, dict):
                    ai['relatedEntryIds'] = [value for value in ai['relatedEntryIds'] if value != entry_id]
            deleted_entry_ids.add(entry_id)
            deleted_task_ids: list[str] = []
            with self._planner_tasks_lock:
                try:
                    tasks, deleted_task_ids_set = self._read_planner_store_unlocked()
                except (OSError, ValueError, json.JSONDecodeError) as exc:
                    raise OSError('planner task store could not be read') from exc
                kept: list[dict[str, object]] = []
                for task in tasks:
                    if task.get('inboxItemId') == entry_id:
                        deleted_task_ids.append(str(task['id']))
                        deleted_task_ids_set.add(str(task['id']))
                    else:
                        kept.append(task)
                self._atomic_write_planner_tasks(kept, deleted_task_ids_set)
            self._atomic_write_inbox_entries(result, deleted_entry_ids)
            return (result, deleted_task_ids)

    def _normalize_planner_task(self, raw: object) -> dict[str, object]:
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
        if not self._valid_iso_timestamp(created_at) or not self._valid_iso_timestamp(updated_at):
            raise ValueError('invalid planner task timestamps')
        due_date = raw.get('dueDate')
        if due_date is not None:
            if not isinstance(due_date, str) or not re.fullmatch('\\d{4}-\\d{2}-\\d{2}', due_date):
                raise ValueError('invalid planner task date')
            try:
                date.fromisoformat(due_date)
            except ValueError as exc:
                raise ValueError('invalid planner task date') from exc
        completed_at = raw.get('completedAt')
        if completed_at is not None and (not self._valid_iso_timestamp(completed_at)):
            raise ValueError('invalid planner completion timestamp')
        inbox_item_id = raw.get('inboxItemId', raw.get('sourceInboxId'))
        if inbox_item_id is not None and (not isinstance(inbox_item_id, str) or not inbox_item_id.strip() or len(inbox_item_id) > 256):
            raise ValueError('invalid planner Inbox source')
        project_id = raw.get('projectId')
        if project_id is not None and (not isinstance(project_id, str) or not re.fullmatch('[A-Za-z0-9][A-Za-z0-9._-]{0,127}', project_id)):
            raise ValueError('invalid planner project id')
        source = 'inbox' if inbox_item_id else 'manual'
        description = raw.get('description', '')
        if not isinstance(description, str) or len(description) > 1200:
            raise ValueError('invalid planner task description')
        if status == 'done' and completed_at is None:
            completed_at = updated_at
        if status == 'pending':
            completed_at = None
        return {'id': task_id.strip(), 'title': title.strip(), 'description': description, 'dueDate': due_date, 'source': source, 'inboxItemId': inbox_item_id, 'projectId': project_id, 'status': status, 'createdAt': created_at, 'updatedAt': updated_at, 'completedAt': completed_at}

    def _read_planner_store_unlocked(self) -> tuple[list[dict[str, object]], set[str]]:
        if not self._planner_tasks_data_path.exists():
            return ([], set())
        if self._planner_tasks_data_path.stat().st_size > MAX_PLANNER_BODY_BYTES:
            raise ValueError('planner task store is too large')
        with self._planner_tasks_data_path.open('r', encoding='utf-8') as file:
            payload = json.load(file)
        if not isinstance(payload, dict) or payload.get('version') != 1 or (not isinstance(payload.get('tasks'), list)):
            raise ValueError('invalid planner task store')
        raw_deleted_ids = payload.get('deletedTaskIds', [])
        if not isinstance(raw_deleted_ids, list) or any((not isinstance(value, str) or not value or len(value) > 256 for value in raw_deleted_ids)):
            raise ValueError('invalid deleted planner task ids')
        tasks = [self._normalize_planner_task(raw) for raw in payload['tasks']]
        ids = [task['id'] for task in tasks]
        if len(ids) != len(set(ids)):
            raise ValueError('duplicate planner task id')
        return (tasks, set(raw_deleted_ids))

    def _read_planner_tasks_unlocked(self) -> list[dict[str, object]]:
        return self._read_planner_store_unlocked()[0]

    def _atomic_write_planner_tasks(self, tasks: list[dict[str, object]], deleted_task_ids: set[str] | None=None) -> None:
        self._planner_tasks_data_path.parent.mkdir(parents=True, exist_ok=True)
        payload = json.dumps({'version': 1, 'tasks': tasks, 'deletedTaskIds': sorted(deleted_task_ids or set())}, ensure_ascii=False, indent=2) + '\n'
        if len(payload.encode('utf-8')) > MAX_PLANNER_BODY_BYTES:
            raise ValueError('planner task store is too large')
        temporary_path: Path | None = None
        try:
            with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', newline='\n', delete=False, dir=self._planner_tasks_data_path.parent, prefix='.tasks-', suffix='.tmp') as temporary_file:
                temporary_path = Path(temporary_file.name)
                temporary_file.write(payload)
                temporary_file.flush()
                os.fsync(temporary_file.fileno())
            os.replace(temporary_path, self._planner_tasks_data_path)
        finally:
            if temporary_path is not None and temporary_path.exists():
                temporary_path.unlink()

    def save_planner(self, raw_tasks: object, single_task: object=None) -> list[dict[str, object]]:
        incoming_raw = [single_task] if single_task is not None else raw_tasks
        if not isinstance(incoming_raw, list) or len(incoming_raw) > 10000:
            raise ValueError('invalid planner tasks')
        incoming = [self._normalize_planner_task(raw) for raw in incoming_raw]
        incoming_ids = [task['id'] for task in incoming]
        if len(incoming_ids) != len(set(incoming_ids)):
            raise ValueError('duplicate planner task id')
        with self._planner_tasks_lock:
            try:
                existing, deleted_task_ids = self._read_planner_store_unlocked()
            except (OSError, ValueError, json.JSONDecodeError) as exc:
                raise OSError('planner task store could not be read') from exc
            merged = {task['id']: task for task in existing}
            for task in incoming:
                if task['id'] in deleted_task_ids:
                    continue
                previous = merged.get(task['id'])
                if previous is None:
                    merged[task['id']] = task
                elif single_task is None and self._timestamp_value(str(task['updatedAt'])) > self._timestamp_value(str(previous['updatedAt'])):
                    merged[task['id']] = {**previous, 'status': task['status'], 'updatedAt': task['updatedAt'], 'completedAt': task['completedAt']}
            result = sorted(merged.values(), key=lambda task: str(task['createdAt']), reverse=True)
            self._atomic_write_planner_tasks(result, deleted_task_ids)
            return result

    def sync_inbox_tasks(self) -> tuple[list[dict[str, object]], set[str]]:
        with self._inbox_lock:
            try:
                entries = self._read_inbox_entries_unlocked()
            except (OSError, ValueError, json.JSONDecodeError) as exc:
                raise OSError('inbox store could not be read') from exc
            with self._planner_tasks_lock:
                try:
                    tasks, deleted_task_ids = self._read_planner_store_unlocked()
                except (OSError, ValueError, json.JSONDecodeError) as exc:
                    raise OSError('planner task store could not be read') from exc
                by_id = {str(task['id']): task for task in tasks}
                for entry in entries:
                    ai = entry.get('ai')
                    if not isinstance(ai, dict) or ai.get('category') != 'todo':
                        continue
                    inbox_id = str(entry['id'])
                    task_id = f'inbox:{inbox_id}'
                    if task_id in deleted_task_ids:
                        continue
                    existing = by_id.get(task_id) or next((task for task in by_id.values() if task.get('inboxItemId') == inbox_id), None)
                    if existing is not None:
                        if existing['id'] != task_id:
                            deleted_task_ids.add(str(existing['id']))
                            by_id.pop(str(existing['id']), None)
                        canonical = {**existing, 'id': task_id, 'source': 'inbox', 'inboxItemId': inbox_id}
                        by_id[task_id] = canonical
                        continue
                    title = str(ai.get('nextAction') or ai.get('title') or entry.get('rawText', '')).strip()[:1200]
                    if not title:
                        continue
                    created_at = str(entry.get('createdAt'))
                    updated_at = str(ai.get('processedAt') or created_at)
                    due_date = ai.get('dueDate')
                    task = self._normalize_planner_task({'id': task_id, 'title': title, 'description': str(ai.get('summary') or entry.get('rawText', ''))[:1200], 'dueDate': due_date, 'source': 'inbox', 'inboxItemId': inbox_id, 'projectId': None, 'status': 'pending', 'createdAt': created_at, 'updatedAt': updated_at, 'completedAt': None})
                    by_id[task_id] = task
                result = sorted(by_id.values(), key=lambda task: str(task['createdAt']), reverse=True)
                self._atomic_write_planner_tasks(result, deleted_task_ids)
                return (result, deleted_task_ids)

    def associate_task_project(self, task_id: object, project_id: object) -> tuple[list[dict[str, object]], set[str]]:
        if not isinstance(task_id, str) or not task_id.strip() or len(task_id) > 256:
            raise ValueError('invalid planner task id')
        if not isinstance(project_id, str) or not re.fullmatch('[A-Za-z0-9][A-Za-z0-9._-]{0,127}', project_id):
            raise ValueError('invalid project id')
        self._project_manifest_path(project_id)
        with self._planner_tasks_lock:
            tasks, deleted_task_ids = self._read_planner_store_unlocked()
            updated_tasks: list[dict[str, object]] = []
            found = False
            for task in tasks:
                if task['id'] == task_id:
                    if not task.get('inboxItemId'):
                        raise ValueError('only Inbox tasks can be routed to a project')
                    task = {**task, 'projectId': project_id, 'updatedAt': datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')}
                    found = True
                updated_tasks.append(task)
            if not found:
                raise FileNotFoundError('planner task not found')
            self._atomic_write_planner_tasks(updated_tasks, deleted_task_ids)
            return (updated_tasks, deleted_task_ids)

    def delete_task(self, task_id: object) -> tuple[list[dict[str, object]], set[str]]:
        if not isinstance(task_id, str) or not task_id.strip() or len(task_id) > 256:
            raise ValueError('invalid planner task id')
        with self._planner_tasks_lock:
            tasks, deleted_task_ids = self._read_planner_store_unlocked()
            remaining = [task for task in tasks if task['id'] != task_id]
            deleted_task_ids.add(task_id)
            self._atomic_write_planner_tasks(remaining, deleted_task_ids)
            return (remaining, deleted_task_ids)

    def _project_manifest_path(self, project_id: object) -> tuple[str, Path, Path]:
        if not isinstance(project_id, str) or not re.fullmatch('[A-Za-z0-9][A-Za-z0-9._-]{0,127}', project_id):
            raise ValueError('invalid project id')
        project_root = self._root / 'projects' / project_id
        if not project_root.is_dir() or project_root.is_symlink():
            raise FileNotFoundError('project folder not found')
        resolved_root = project_root.resolve(strict=True)
        try:
            resolved_root.relative_to(self._root.resolve())
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
        return (project_id, resolved_root, resolved_manifest)

    def _project_manifest_snapshot(self, project_id: object) -> tuple[str, str, Path, bytes]:
        normalized_id, project_root, manifest_path = self._project_manifest_path(project_id)
        raw = manifest_path.read_bytes()
        raw.decode('utf-8')
        return (raw.decode('utf-8'), hashlib.sha256(raw).hexdigest(), manifest_path, raw)

    def _update_project_frontmatter(self, markdown: str, key: str, value: str) -> str:
        match = re.match('\\A---(?P<first>\\r?\\n)(?P<body>.*?)(?P<last>\\r?\\n)---', markdown, flags=re.DOTALL)
        if not match:
            raise ValueError('project.md frontmatter is missing')
        newline = '\r\n' if '\r\n' in match.group(0) else '\n'
        lines = re.split('\\r?\\n', match.group('body'))
        pattern = re.compile(f'^\\s*{re.escape(key)}\\s*:', flags=re.IGNORECASE)
        found = False
        updated: list[str] = []
        for line in lines:
            if pattern.match(line):
                updated.append(f'{key}: {value}')
                found = True
            else:
                updated.append(line)
        if not found:
            id_index = next((index for index, line in enumerate(updated) if re.match('^\\s*id\\s*:', line, flags=re.IGNORECASE)), -1)
            updated.insert(id_index + 1 if id_index >= 0 else 0, f'{key}: {value}')
        frontmatter = f"---{match.group('first')}{newline.join(updated)}{match.group('last')}---"
        return frontmatter + markdown[match.end():]

    def _update_project_key_file(self, markdown: str, project_id: str, path: str, pinned: bool) -> str:
        if not path.startswith('projects/') or '\\' in path or '\x00' in path:
            raise ValueError('invalid project file path')
        parts = path.split('/')
        if any((part in {'', '.', '..'} for part in parts)):
            raise ValueError('invalid project file path')
        newline = '\r\n' if '\r\n' in markdown else '\n'
        heading = re.compile('^##\\s+주요 파일\\s*$', flags=re.MULTILINE)
        match = heading.search(markdown)
        if not match:
            prefix = '' if not markdown else ('' if markdown.endswith(('\n', '\r')) else newline) + newline
            section = f'## 주요 파일{newline}- {path}{newline}' if pinned else f'## 주요 파일{newline}'
            return f'{markdown}{prefix}{section}'
        next_heading = re.search('^##\\s+', markdown[match.end():], flags=re.MULTILINE)
        section_end = match.end() + next_heading.start() if next_heading else len(markdown)
        section = markdown[match.end():section_end]
        lines = section.splitlines(keepends=True)
        relative_path = path.removeprefix(f'projects/{project_id}/')
        stored_entries = {f'- {path}', f'* {path}', f'- {relative_path}', f'* {relative_path}'}
        entry = f'- {path}'
        has_entry = any((line.strip() in stored_entries for line in lines))
        if pinned and (not has_entry):
            if lines and (not lines[-1].endswith(('\n', '\r'))):
                lines[-1] += newline
            lines.append(entry + newline)
        elif not pinned:
            lines = [line for line in lines if line.strip() not in stored_entries]
        return markdown[:match.end()] + ''.join(lines) + markdown[section_end:]

    def _append_project_next_task(self, markdown: str, value: object) -> tuple[str, bool]:
        if not isinstance(value, str):
            raise ValueError('invalid project task')
        task = ' '.join(value.split()).strip()
        if not task or len(task) > 1200:
            raise ValueError('project task must contain 1 to 1200 characters')
        newline = '\r\n' if '\r\n' in markdown else '\n'
        task_line = f'- {task}'
        headings = list(re.finditer('^##[ \\t]+다음 작업[ \\t]*\\r?$', markdown, flags=re.MULTILINE))
        if headings:
            start = headings[-1].end()
            next_heading = re.search('^##[ \\t]+', markdown[start:], flags=re.MULTILINE)
            end = start + next_heading.start() if next_heading else len(markdown)
            section = markdown[start:end]
            if any((line.strip() in {task_line, f'* {task}'} for line in section.splitlines())):
                return (markdown, False)
            prefix = newline if section and (not section.endswith(('\n', '\r'))) else ''
            return (f'{markdown[:end]}{prefix}{task_line}{newline}{markdown[end:]}', True)
        separator = newline if markdown and (not markdown.endswith(('\n', '\r'))) else ''
        return (f'{markdown}{separator}{newline}## 다음 작업{newline}{task_line}{newline}', True)

    def _clear_project_next_tasks(self, markdown: str) -> str:
        newline = '\r\n' if '\r\n' in markdown else '\n'
        headings = list(re.finditer('^##[ \\t]+다음 작업[ \\t]*\\r?$', markdown, flags=re.MULTILINE))
        updated = markdown
        for heading in reversed(headings):
            section_start = heading.end()
            following = re.search('^##[ \\t]+', updated[section_start:], flags=re.MULTILINE)
            section_end = section_start + following.start() if following else len(updated)
            updated = updated[:section_start] + newline + updated[section_end:]
        return updated

    def update_project_metadata(self, body: dict[str, object]) -> dict[str, object]:
        project_id = body.get('projectId')
        operation = body.get('operation')
        value = body.get('value')
        expected_sha = body.get('expectedSha')
        if not isinstance(expected_sha, str) or not re.fullmatch('[a-f0-9]{64}', expected_sha):
            raise ValueError('a valid project metadata revision is required')
        with self._project_metadata_lock:
            markdown, current_sha, manifest_path, original = self._project_manifest_snapshot(project_id)
            if current_sha != expected_sha:
                raise ProjectManifestConflict('project.md changed. Reload the project before saving again.')
            task_added: bool | None = None
            if operation == 'stage':
                if value not in {'planning', 'collection', 'analysis', 'interpretation', 'writing', 'complete'}:
                    raise ValueError('invalid research stage')
                updated = self._update_project_frontmatter(markdown, 'stage', str(value))
            elif operation == 'status':
                if value not in {'writing', 'active', 'paused', 'waiting', 'blocked', 'complete'}:
                    raise ValueError('invalid project status')
                updated = self._update_project_frontmatter(markdown, 'status', str(value))
            elif operation in {'favorite_add', 'favorite_remove'}:
                if not isinstance(value, str):
                    raise ValueError('invalid project file path')
                normalized_id = str(project_id)
                if not value.startswith(f'projects/{normalized_id}/'):
                    raise ValueError('file must be inside the project folder')
                target = self._root.joinpath(*value.split('/'))
                if operation == 'favorite_add' and (target.is_symlink() or not target.is_file()):
                    raise FileNotFoundError('project file not found')
                try:
                    target.resolve(strict=operation == 'favorite_add').relative_to((self._root / 'projects' / normalized_id).resolve(strict=True))
                except (OSError, ValueError) as exc:
                    raise ValueError('project file is outside the project folder') from exc
                updated = self._update_project_key_file(markdown, normalized_id, value, operation == 'favorite_add')
            elif operation == 'next_task_add':
                updated, task_added = self._append_project_next_task(markdown, value)
            elif operation == 'next_tasks_reset':
                updated = self._clear_project_next_tasks(markdown)
            else:
                raise ValueError('invalid project metadata operation')
            if updated == markdown:
                result = {'ok': True, 'source': 'vault', 'projectId': project_id, 'manifestText': markdown, 'manifestSha': current_sha}
                if task_added is not None:
                    result['added'] = task_added
                return result
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
            result = {'ok': True, 'source': 'vault', 'projectId': project_id, 'manifestText': saved.decode('utf-8'), 'manifestSha': hashlib.sha256(saved).hexdigest()}
            if task_added is not None:
                result['added'] = task_added
            return result

    def project_workspace(self, project_id: object) -> dict[str, object]:
        if not isinstance(project_id, str) or not re.fullmatch('[A-Za-z0-9][A-Za-z0-9._-]{0,127}', project_id):
            raise ValueError('invalid project id')
        root = self._root / 'projects' / project_id
        if not root.is_dir() or root.is_symlink():
            raise FileNotFoundError('project folder not found')
        resolved_root = root.resolve(strict=True)
        try:
            resolved_root.relative_to(self._root.resolve())
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
            names[:] = [name for name in names if name.lower() not in ignored and (not (current / name).is_symlink())]
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
                relative_path = file_path.relative_to(self._root).as_posix()
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
            manifest_text, manifest_sha, _, _ = self._project_manifest_snapshot(project_id)
        except FileNotFoundError:
            pass
        return {'ok': True, 'source': 'vault', 'projectId': project_id, 'rootPath': f'projects/{project_id}', 'items': sorted(files, key=lambda item: str(item['path']).casefold()), 'folders': sorted(folders, key=str.casefold), 'recentFiles': recent[:10], 'manifestText': manifest_text, 'manifestSha': manifest_sha}
