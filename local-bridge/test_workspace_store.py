from __future__ import annotations

import ast
import builtins
import copy
import hashlib
import importlib.util
import json
import os
import re
import tempfile
import threading
import types
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

from workspace_test_safety import WorkspaceTestSafetyMixin


_BRIDGE_PATH = Path(__file__).with_name('bridge.py')
_RAW_FSYNC = os.fsync
_RAW_NAMED_TEMPORARY_FILE = tempfile.NamedTemporaryFile
_INBOX_ENTRY_ID = 'entry-1'
_T0 = '2026-09-28T10:00:00Z'
_T1 = '2026-09-29T10:00:00Z'
_T2 = '2026-09-30T10:00:00Z'
_T3 = '2026-10-01T10:00:00Z'


class _FrozenDateTime(datetime):
    @classmethod
    def now(cls, tz=None):
        value = cls(2026, 10, 1, 12, tzinfo=timezone.utc)
        return value if tz is None else value.astimezone(tz)


class _RecordingLock:
    def __init__(self, name, events):
        self.name = name
        self.events = events
        self.held = False

    def __enter__(self):
        self.held = True
        self.events.append((f'{self.name}.enter', None, None))
        return self

    def __exit__(self, *_args):
        self.events.append((f'{self.name}.exit', None, None))
        self.held = False


class _TrackedTemporaryFile:
    def __init__(self, wrapped, events, release_fd):
        self.wrapped = wrapped
        self.events = events
        self.release_fd = release_fd

    def __enter__(self):
        self.wrapped.__enter__()
        return self

    def __exit__(self, *args):
        fd = self.wrapped.fileno()
        try:
            return self.wrapped.__exit__(*args)
        finally:
            self.release_fd(fd)
            self.events.append(('close', None, None))

    def write(self, value):
        self.events.append(('write', None, None))
        return self.wrapped.write(value)

    def flush(self):
        self.events.append(('flush', None, None))
        return self.wrapped.flush()

    def __getattr__(self, name):
        return getattr(self.wrapped, name)


class WorkspaceFixture:
    """Test-only instrumentation around the real WorkspaceStore owner."""

    def __init__(self, test_case, root: Path):
        import workspace_store as workspace_store_module

        self.test_case = test_case
        self.safety = test_case
        self.root = root
        self.events: list[tuple[str, str | None, tuple[bool, bool, bool] | None]] = []
        self.inbox_lock = _RecordingLock('inbox', self.events)
        self.planner_lock = _RecordingLock('planner', self.events)
        self.project_lock = _RecordingLock('project', self.events)
        self.fail_replace_path: Path | None = None
        self.after_fsync = None
        self.owner = workspace_store_module.WorkspaceStore(root)
        self.inbox_path = self.owner._inbox_data_path
        self.planner_path = self.owner._planner_tasks_data_path
        self.owner._inbox_lock = self.inbox_lock
        self.owner._planner_tasks_lock = self.planner_lock
        self.owner._project_metadata_lock = self.project_lock
        self.ProjectManifestConflict = workspace_store_module.ProjectManifestConflict
        self._guarded_replace = os.replace

        def safe_fsync(fd):
            self.safety._workspace_check_path(fd, 'workspace.os.fsync')
            self.events.append(('fsync', None, self.lock_state()))
            result = _RAW_FSYNC(fd)
            if self.after_fsync is not None:
                callback, self.after_fsync = self.after_fsync, None
                callback()
            return result

        def safe_replace(source, destination):
            self.safety._workspace_check_path(source, 'workspace.os.replace')
            target = self.safety._workspace_check_path(destination, 'workspace.os.replace')
            self.events.append(('replace', target.name, self.lock_state()))
            if self.fail_replace_path == target:
                raise OSError('synthetic replace failure')
            return self._guarded_replace(source, destination)

        def tracked_named_temporary_file(*args, **kwargs):
            self.events.append(('temp.open', Path(kwargs['dir']).name, self.lock_state()))
            raw = _RAW_NAMED_TEMPORARY_FILE(*args, **kwargs)
            return _TrackedTemporaryFile(
                raw,
                self.events,
                lambda fd: self.safety._workspace_safe_fds.pop(fd, None),
            )

        self.safe_os = types.SimpleNamespace(
            fsync=safe_fsync,
            replace=safe_replace,
            walk=os.walk,
            path=os.path,
        )
        self.safe_tempfile = types.SimpleNamespace(
            NamedTemporaryFile=tracked_named_temporary_file,
        )
        self._module_patches = (
            patch.object(workspace_store_module, 'os', self.safe_os),
            patch.object(workspace_store_module, 'tempfile', self.safe_tempfile),
            patch.object(workspace_store_module, 'datetime', _FrozenDateTime),
        )
        for module_patch in self._module_patches:
            module_patch.start()
            test_case.addCleanup(module_patch.stop)

        self.namespace = {
            '_valid_iso_timestamp': self.owner._valid_iso_timestamp,
            '_timestamp_value': self.owner._timestamp_value,
            '_explicit_full_year_dates': self.owner._explicit_full_year_dates,
            '_normalize_inbox_entry': self.owner._normalize_inbox_entry,
            '_read_inbox_store_unlocked': self.owner._read_inbox_store_unlocked,
            '_read_inbox_entries_unlocked': self.owner._read_inbox_entries_unlocked,
            '_atomic_write_inbox_entries': self.owner._atomic_write_inbox_entries,
            '_merge_and_save_inbox_entries': self.owner.save_inbox,
            '_delete_inbox_entry': self.owner.delete_inbox,
            '_normalize_planner_task': self.owner._normalize_planner_task,
            '_read_planner_store_unlocked': self.owner._read_planner_store_unlocked,
            '_read_planner_tasks_unlocked': self.owner._read_planner_tasks_unlocked,
            '_atomic_write_planner_tasks': self.owner._atomic_write_planner_tasks,
            '_merge_and_save_planner_tasks': self.owner.save_planner,
            '_sync_inbox_planner_tasks': self.owner.sync_inbox_tasks,
            '_update_planner_task_project': self.owner.associate_task_project,
            '_delete_planner_task': self.owner.delete_task,
            '_project_manifest_path': self.owner._project_manifest_path,
            '_project_manifest_snapshot': self.owner._project_manifest_snapshot,
            '_update_project_frontmatter': self.owner._update_project_frontmatter,
            '_update_project_key_file': self.owner._update_project_key_file,
            '_append_project_next_task': self.owner._append_project_next_task,
            '_clear_project_next_tasks': self.owner._clear_project_next_tasks,
            '_update_project_metadata': self.owner.update_project_metadata,
            '_project_workspace': self.owner.project_workspace,
            'MAX_INBOX_ENTRIES': workspace_store_module.MAX_INBOX_ENTRIES,
            'MAX_INBOX_RAW_CHARS': workspace_store_module.MAX_INBOX_RAW_CHARS,
            'MAX_INBOX_STORE_BYTES': workspace_store_module.MAX_INBOX_STORE_BYTES,
            'MAX_PLANNER_BODY_BYTES': workspace_store_module.MAX_PLANNER_BODY_BYTES,
            'ProjectManifestConflict': self.ProjectManifestConflict,
        }
        self.inbox_path.parent.mkdir(parents=True, exist_ok=True)
        self.planner_path.parent.mkdir(parents=True, exist_ok=True)

    def lock_state(self):
        return (self.inbox_lock.held, self.planner_lock.held, self.project_lock.held)

    def clear_events(self):
        self.events.clear()

    def replace_names(self):
        return [event[1] for event in self.events if event[0] == 'replace']

    def load_inbox(self):
        with self.inbox_lock:
            return self.namespace['_read_inbox_entries_unlocked']()

    def save_inbox(self, entries):
        return self.namespace['_merge_and_save_inbox_entries'](entries)

    def delete_inbox(self, entry_id):
        return self.namespace['_delete_inbox_entry'](entry_id)

    def load_planner(self):
        with self.planner_lock:
            return self.namespace['_read_planner_store_unlocked']()

    def save_planner(self, tasks, single_task=None):
        return self.namespace['_merge_and_save_planner_tasks'](tasks, single_task=single_task)

    def sync_inbox_tasks(self):
        return self.namespace['_sync_inbox_planner_tasks']()

    def associate_task_project(self, task_id, project_id):
        return self.namespace['_update_planner_task_project'](task_id, project_id)

    def delete_task(self, task_id):
        return self.namespace['_delete_planner_task'](task_id)

    def project_workspace(self, project_id):
        return self.namespace['_project_workspace'](project_id)

    def update_project_metadata(self, body):
        return self.namespace['_update_project_metadata'](body)


def _raw_entry(entry_id=_INBOX_ENTRY_ID, raw_text='2026-11-03: 작업 메모', created_at=_T0):
    return {
        'id': entry_id,
        'rawText': raw_text,
        'createdAt': created_at,
        'processed': False,
        'ai': None,
    }


def _ai_entry(entry_id, *, category='todo', processed_at=_T1, title='정리하기',
              next_action='자료 정리', raw_text='2026-11-03: 작업 메모', related=None,
              due_date='2026-11-03'):
    return {
        **_raw_entry(entry_id, raw_text),
        'processed': True,
        'ai': {
            'entryId': entry_id,
            'category': category,
            'title': title,
            'summary': '작업 요약',
            'nextAction': next_action,
            'dueDate': due_date,
            'relatedEntryIds': list(related or []),
            'processedAt': processed_at,
        },
    }


def _planner_task(task_id='manual-1', *, title='기존 제목', status='pending',
                  updated_at=_T0, project_id=None, inbox_item_id=None,
                  completed_at=None, description='기존 설명'):
    return {
        'id': task_id,
        'title': title,
        'description': description,
        'dueDate': None,
        'inboxItemId': inbox_item_id,
        'projectId': project_id,
        'status': status,
        'createdAt': _T0,
        'updatedAt': updated_at,
        'completedAt': completed_at,
    }


class WorkspaceSafetySentinelTests(WorkspaceTestSafetyMixin, unittest.TestCase):
    def test_external_reads_writes_metadata_and_replace_fail_closed_when_swallowed(self):
        outside = self.workspace_temp_root.parent / 'workspace-outside-sentinel.txt'
        local_source = self.workspace_temp_root / 'replace-source.txt'
        local_source.write_text('scratch', encoding='utf-8')
        expected = [
            'builtins.open', 'io.open', 'os.open', 'os.stat', 'os.replace', 'builtins.open',
        ]
        attempts = [
            lambda: builtins.open(outside, 'r', encoding='utf-8'),
            lambda: Path(outside).read_text(encoding='utf-8'),
            lambda: os.open(outside, os.O_WRONLY | os.O_CREAT, 0o600),
            lambda: os.stat(outside),
            lambda: os.replace(local_source, outside),
        ]
        for attempt in attempts:
            with self.assertRaises(AssertionError):
                attempt()

        try:
            builtins.open(outside, 'r', encoding='utf-8')
        except Exception:
            pass
        with self.assertRaises(AssertionError):
            self._assert_no_workspace_safety_attempts()
        self.clear_expected_workspace_safety_attempts(expected)


class WorkspaceStoreTests(WorkspaceTestSafetyMixin, unittest.TestCase):
    def setUp(self):
        super().setUp()
        self.root = self.workspace_temp_root / 'vault'
        self.root.mkdir()
        self.store = WorkspaceFixture(self, self.root)

    def write_manifest(self, project_id, content):
        project_root = self.root / 'projects' / project_id
        project_root.mkdir(parents=True, exist_ok=True)
        path = project_root / 'project.md'
        path.write_bytes(content.encode('utf-8'))
        return path

    def manifest_revision(self, path):
        return hashlib.sha256(path.read_bytes()).hexdigest()

    def assert_no_temp_files(self, directory, pattern):
        self.assertEqual(list(directory.glob(pattern)), [])

    def test_inbox_raw_authority_newest_ai_cleanup_and_tombstone(self):
        original = _raw_entry(raw_text='보낼 자료는 2026-11-03까지 정리')
        self.store.save_inbox([original, _raw_entry('entry-2', '연관 메모')])
        incoming = _ai_entry(
            _INBOX_ENTRY_ID,
            category='Todo',
            processed_at=_T2,
            raw_text='변조 시도 2026-11-03',
            related=[_INBOX_ENTRY_ID, 'entry-2', 'missing'],
        )
        saved = {entry['id']: entry for entry in self.store.save_inbox([incoming])}
        self.assertEqual(saved[_INBOX_ENTRY_ID]['rawText'], original['rawText'])
        self.assertEqual(saved[_INBOX_ENTRY_ID]['createdAt'], original['createdAt'])
        self.assertEqual(saved[_INBOX_ENTRY_ID]['ai']['category'], 'todo')
        self.assertEqual(saved[_INBOX_ENTRY_ID]['ai']['processedAt'], _T2)
        self.assertEqual(saved[_INBOX_ENTRY_ID]['ai']['dueDate'], '2026-11-03')
        self.assertEqual(saved[_INBOX_ENTRY_ID]['ai']['relatedEntryIds'], ['entry-2'])

        stale = _ai_entry(_INBOX_ENTRY_ID, processed_at=_T1, title='낡은 결과')
        merged = {entry['id']: entry for entry in self.store.save_inbox([stale])}
        self.assertEqual(merged[_INBOX_ENTRY_ID]['ai']['title'], '정리하기')
        normalized = self.store.namespace['_normalize_inbox_entry'](
            _ai_entry('idea-1', category='Idea', next_action='버려질 동작',
                      raw_text='날짜 없음', due_date='2026-12-31', related=['idea-1'])
        )
        self.assertEqual(normalized['ai']['category'], 'idea')
        self.assertEqual(normalized['ai']['nextAction'], '')
        self.assertIsNone(normalized['ai']['dueDate'])
        self.assertEqual(normalized['ai']['relatedEntryIds'], [])

        self.store.save_planner([
            _planner_task('inbox:entry-1', inbox_item_id=_INBOX_ENTRY_ID, project_id='thesis'),
        ])
        _, deleted_task_ids = self.store.delete_inbox(_INBOX_ENTRY_ID)
        self.assertEqual(deleted_task_ids, ['inbox:entry-1'])
        stale_save = self.store.save_inbox([original])
        self.assertNotIn(_INBOX_ENTRY_ID, {entry['id'] for entry in stale_save})
        self.assertIn(_INBOX_ENTRY_ID, self.store.namespace['_read_inbox_store_unlocked']()[1])

    def test_planner_single_bulk_merge_completion_and_legacy_link(self):
        self.store.save_planner([
            _planner_task('task-1', title='원래 제목', project_id='thesis',
                          status='pending', description='원래 설명'),
        ])
        self.store.save_planner(None, single_task=_planner_task(
            'task-1', title='덮어쓰면 안 됨', project_id='other', status='done',
            updated_at=_T2, completed_at=_T2, description='새 설명',
        ))
        tasks, _ = self.store.load_planner()
        single = tasks[0]
        self.assertEqual((single['title'], single['description'], single['projectId']),
                         ('원래 제목', '원래 설명', 'thesis'))
        self.assertEqual(single['status'], 'pending')
        self.assertIsNone(single['completedAt'])

        self.store.save_planner([_planner_task(
            'task-1', title='bulk title ignored', project_id='other', status='done',
            updated_at=_T2, completed_at=_T2,
        )])
        tasks, _ = self.store.load_planner()
        bulk = tasks[0]
        self.assertEqual((bulk['title'], bulk['projectId']), ('원래 제목', 'thesis'))
        self.assertEqual((bulk['status'], bulk['updatedAt'], bulk['completedAt']),
                         ('done', _T2, _T2))
        self.store.save_planner([_planner_task(
            'task-1', title='bulk title ignored', project_id='other', status='pending',
            updated_at=_T3, completed_at=_T2,
        )])
        tasks, _ = self.store.load_planner()
        uncompleted = tasks[0]
        self.assertEqual((uncompleted['title'], uncompleted['projectId']), ('원래 제목', 'thesis'))
        self.assertEqual((uncompleted['status'], uncompleted['updatedAt'], uncompleted['completedAt']),
                         ('pending', _T3, None))
        self.store.save_planner([_planner_task(
            'task-1', status='pending', updated_at=_T1, completed_at=None,
        )])
        tasks, _ = self.store.load_planner()
        self.assertEqual((tasks[0]['status'], tasks[0]['updatedAt'], tasks[0]['completedAt']),
                         ('pending', _T3, None))

        done = self.store.namespace['_normalize_planner_task'](
            _planner_task('done-task', status='done', updated_at=_T1)
        )
        pending = self.store.namespace['_normalize_planner_task'](
            _planner_task('pending-task', status='pending', completed_at=_T2)
        )
        self.assertEqual(done['completedAt'], _T1)
        self.assertIsNone(pending['completedAt'])

        self.store.save_inbox([_ai_entry('linked-entry')])
        self.store.save_planner([_planner_task(
            'legacy-todo', title='완료한 작업', status='done', updated_at=_T2,
            project_id='thesis', inbox_item_id='linked-entry', completed_at=_T2,
        )])
        first, deleted = self.store.sync_inbox_tasks()
        second, _ = self.store.sync_inbox_tasks()
        linked = [task for task in second if task['inboxItemId'] == 'linked-entry']
        self.assertEqual(len(linked), 1)
        self.assertEqual(linked[0]['id'], 'inbox:linked-entry')
        self.assertEqual((linked[0]['status'], linked[0]['completedAt'], linked[0]['projectId']),
                         ('done', _T2, 'thesis'))
        self.assertIn('legacy-todo', deleted)
        self.assertEqual(len(first), len(second))
        after_stale_replay = self.store.save_planner([_planner_task(
            'legacy-todo', inbox_item_id='linked-entry', status='pending',
        )])
        self.assertNotIn('legacy-todo', {task['id'] for task in after_stale_replay})

    def test_association_target_validation_and_operation_lock_ownership(self):
        project = self.write_manifest('thesis', '---\nid: thesis\n---\n')
        self.store.save_inbox([_ai_entry('route-me')])
        self.store.sync_inbox_tasks()
        self.store.clear_events()
        tasks, _ = self.store.associate_task_project('inbox:route-me', 'thesis')
        associated = next(task for task in tasks if task['id'] == 'inbox:route-me')
        self.assertEqual(associated['projectId'], 'thesis')
        self.assertEqual(associated['updatedAt'], '2026-10-01T12:00:00Z')
        self.assertTrue(any(event[0] == 'planner.enter' for event in self.store.events))

        self.store.clear_events()
        with self.assertRaisesRegex(ValueError, '^invalid project id$'):
            self.store.associate_task_project('inbox:route-me', '../outside')
        self.assertFalse(any(event[0] == 'planner.enter' for event in self.store.events))
        with self.assertRaisesRegex(FileNotFoundError, '^project folder not found$'):
            self.store.associate_task_project('inbox:route-me', 'missing-project')
        self.assertFalse(any(event[0] == 'planner.enter' for event in self.store.events))
        self.store.save_planner([_planner_task('manual-task')])
        with self.assertRaisesRegex(ValueError, '^only Inbox tasks can be routed to a project$'):
            self.store.associate_task_project('manual-task', 'thesis')
        with self.assertRaisesRegex(ValueError, '^invalid project id$'):
            self.store.namespace['_project_manifest_path']('../outside')

        self.store.clear_events()
        self.store.load_inbox()
        self.assertEqual([event[0] for event in self.store.events], ['inbox.enter', 'inbox.exit'])
        self.store.clear_events()
        self.store.load_planner()
        self.assertEqual([event[0] for event in self.store.events], ['planner.enter', 'planner.exit'])
        self.store.clear_events()
        self.store.project_workspace('thesis')
        self.assertEqual(self.store.events, [])
        self.store.clear_events()
        self.store.update_project_metadata({
            'projectId': 'thesis', 'operation': 'next_task_add', 'value': '수동 다음 작업',
            'expectedSha': self.manifest_revision(project),
        })
        self.assertEqual([event[0] for event in self.store.events],
                         ['project.enter', 'temp.open', 'write', 'flush', 'fsync',
                          'close', 'replace', 'project.exit'])

    def test_metadata_byte_format_manual_next_tasks_noop_and_sha_rechecks(self):
        for project_id, newline in (('lf', '\n'), ('crlf', '\r\n')):
            original = '---' + newline + 'id: ' + project_id + newline + 'status: active' + newline + '---' + newline + newline + '# Memo' + newline
            path = self.write_manifest(project_id, original)
            result = self.store.update_project_metadata({
                'projectId': project_id, 'operation': 'stage', 'value': 'analysis',
                'expectedSha': self.manifest_revision(path),
            })
            expected = ('---' + newline + 'id: ' + project_id + newline + 'stage: analysis' + newline
                        + 'status: active' + newline + '---' + newline + newline + '# Memo' + newline)
            self.assertEqual(path.read_bytes(), expected.encode('utf-8'))
            self.assertEqual(result['manifestText'], expected)

        manifest = self.write_manifest(
            'manual', '---\nid: manual\n---\n\n# Notes\n\n## 다음 작업\n- 이미 적힌 항목\n'
        )
        self.store.save_planner([_planner_task('planner-independent')])
        planner_before = self.store.planner_path.read_bytes()
        initial_sha = self.manifest_revision(manifest)
        first = self.store.update_project_metadata({
            'projectId': 'manual', 'operation': 'next_task_add',
            'value': '교수님께 결과 보내기', 'expectedSha': initial_sha,
        })
        self.assertTrue(first['added'])
        self.assertIn('## 다음 작업\n- 이미 적힌 항목\n- 교수님께 결과 보내기\n',
                      manifest.read_bytes().decode('utf-8'))
        self.assertEqual(self.store.planner_path.read_bytes(), planner_before)
        self.store.clear_events()
        duplicate = self.store.update_project_metadata({
            'projectId': 'manual', 'operation': 'next_task_add',
            'value': '교수님께 결과 보내기', 'expectedSha': first['manifestSha'],
        })
        self.assertFalse(duplicate['added'])
        self.assertEqual(self.store.replace_names(), [])
        self.assertEqual(manifest.read_bytes(), first['manifestText'].encode('utf-8'))

        before_stale = manifest.read_bytes()
        with self.assertRaisesRegex(
            self.store.ProjectManifestConflict,
            r'^project.md changed\. Reload the project before saving again\.$',
        ):
            self.store.update_project_metadata({
                'projectId': 'manual', 'operation': 'stage', 'value': 'writing',
                'expectedSha': initial_sha,
            })
        self.assertEqual(manifest.read_bytes(), before_stale)
        self.assertIs(self.store.ProjectManifestConflict,
                      self.store.namespace['ProjectManifestConflict'])

        concurrent = self.write_manifest('recheck', '---\nid: recheck\n---\n\nexternal edit\n')
        original = concurrent.read_bytes()
        original_sha = hashlib.sha256(original).hexdigest()
        external = b'---\nid: recheck\n---\n\nconcurrent writer\n'
        self.store.after_fsync = lambda: concurrent.write_bytes(external)
        with self.assertRaisesRegex(
            self.store.ProjectManifestConflict,
            r'^project.md changed\. Reload the project before saving again\.$',
        ):
            self.store.update_project_metadata({
                'projectId': 'recheck', 'operation': 'stage', 'value': 'writing',
                'expectedSha': original_sha,
            })
        self.assertEqual(concurrent.read_bytes(), external)
        self.assertNotIn('project.md', self.store.replace_names())
        self.assert_no_temp_files(concurrent.parent, '.project-*.tmp')

    def test_exact_malformed_missing_and_size_errors(self):
        self.assertEqual(self.store.load_inbox(), [])
        self.assertEqual(self.store.load_planner(), ([], set()))
        self.store.inbox_path.write_text('', encoding='utf-8')
        with self.assertRaises(json.JSONDecodeError) as inbox_error:
            self.store.load_inbox()
        self.assertEqual(str(inbox_error.exception), 'Expecting value: line 1 column 1 (char 0)')
        self.store.inbox_path.write_text('{}', encoding='utf-8')
        with self.assertRaisesRegex(ValueError, '^invalid inbox store$'):
            self.store.load_inbox()
        self.store.inbox_path.write_bytes(b'x' * (8 * 1024 * 1024 + 1))
        with self.assertRaisesRegex(ValueError, '^inbox store is too large$'):
            self.store.load_inbox()

        self.store.planner_path.write_text('', encoding='utf-8')
        with self.assertRaises(json.JSONDecodeError) as planner_error:
            self.store.load_planner()
        self.assertEqual(str(planner_error.exception), 'Expecting value: line 1 column 1 (char 0)')
        self.store.planner_path.write_bytes(b'x' * (512 * 1024 + 1))
        with self.assertRaisesRegex(ValueError, '^planner task store is too large$'):
            self.store.load_planner()
        with self.assertRaisesRegex(ValueError, '^invalid inbox entry id$'):
            self.store.save_inbox([{**_raw_entry(), 'id': '  '}])

    def test_inbox_and_planner_store_json_bytes_and_sorted_tombstones(self):
        entry = self.store.namespace['_normalize_inbox_entry'](
            _raw_entry('byte-inbox', '한글 원문')
        )
        self.store.namespace['_atomic_write_inbox_entries'](
            [entry], {'z-deleted-inbox', 'a-deleted-inbox'}
        )
        expected_inbox = (
            '{\n'
            '  "version": 1,\n'
            '  "entries": [\n'
            '    {\n'
            '      "id": "byte-inbox",\n'
            '      "rawText": "한글 원문",\n'
            f'      "createdAt": "{_T0}",\n'
            '      "processed": false,\n'
            '      "ai": null\n'
            '    }\n'
            '  ],\n'
            '  "deletedEntryIds": [\n'
            '    "a-deleted-inbox",\n'
            '    "z-deleted-inbox"\n'
            '  ]\n'
            '}\n'
        )
        self.assertEqual(self.store.inbox_path.read_bytes(), expected_inbox.encode('utf-8'))

        task = self.store.namespace['_normalize_planner_task'](
            _planner_task('byte-task', title='작업', description='설명')
        )
        self.store.namespace['_atomic_write_planner_tasks'](
            [task], {'z-deleted-task', 'a-deleted-task'}
        )
        expected_planner = (
            '{\n'
            '  "version": 1,\n'
            '  "tasks": [\n'
            '    {\n'
            '      "id": "byte-task",\n'
            '      "title": "작업",\n'
            '      "description": "설명",\n'
            '      "dueDate": null,\n'
            '      "source": "manual",\n'
            '      "inboxItemId": null,\n'
            '      "projectId": null,\n'
            '      "status": "pending",\n'
            f'      "createdAt": "{_T0}",\n'
            f'      "updatedAt": "{_T0}",\n'
            '      "completedAt": null\n'
            '    }\n'
            '  ],\n'
            '  "deletedTaskIds": [\n'
            '    "a-deleted-task",\n'
            '    "z-deleted-task"\n'
            '  ]\n'
            '}\n'
        )
        self.assertEqual(self.store.planner_path.read_bytes(), expected_planner.encode('utf-8'))

    def test_atomic_order_pre_replace_preservation_and_delete_partial_commit(self):
        self.store.save_inbox([_raw_entry()])
        before = self.store.inbox_path.read_bytes()
        self.store.clear_events()
        self.store.fail_replace_path = self.store.inbox_path.resolve()
        with self.assertRaisesRegex(OSError, '^synthetic replace failure$'):
            self.store.save_inbox([_raw_entry('entry-2', 'new')])
        labels = [event[0] for event in self.store.events]
        self.assertEqual(labels, ['inbox.enter', 'temp.open', 'write', 'flush', 'fsync',
                                  'close', 'replace', 'inbox.exit'])
        self.assertEqual(self.store.inbox_path.read_bytes(), before)
        self.assert_no_temp_files(self.store.inbox_path.parent, '.inbox-*.tmp')

        self.store.fail_replace_path = None
        self.store.save_inbox([_ai_entry(_INBOX_ENTRY_ID)])
        self.store.sync_inbox_tasks()
        planner_before = self.store.planner_path.read_bytes()
        inbox_before = self.store.inbox_path.read_bytes()
        self.store.clear_events()
        self.store.fail_replace_path = self.store.inbox_path.resolve()
        with self.assertRaisesRegex(OSError, '^synthetic replace failure$'):
            self.store.delete_inbox(_INBOX_ENTRY_ID)
        replacements = [event for event in self.store.events if event[0] == 'replace']
        self.assertEqual([event[1] for event in replacements], ['tasks.json', 'inbox.json'])
        self.assertEqual([event[2] for event in replacements], [(True, True, False), (True, False, False)])
        self.assertNotEqual(self.store.planner_path.read_bytes(), planner_before)
        self.assertEqual(self.store.inbox_path.read_bytes(), inbox_before)
        tasks, deleted_task_ids = self.store.load_planner()
        self.assertEqual(tasks, [])
        self.assertIn('inbox:entry-1', deleted_task_ids)
        self.assertTrue(self.store.load_inbox())
        self.assert_no_temp_files(self.store.planner_path.parent, '.tasks-*.tmp')
        self.assert_no_temp_files(self.store.inbox_path.parent, '.inbox-*.tmp')

    def test_sync_nests_inbox_then_planner_and_writes_under_both_locks(self):
        self.store.save_inbox([_ai_entry('nested-link')])
        self.store.clear_events()
        self.store.sync_inbox_tasks()
        self.assertEqual(
            [event[0] for event in self.store.events],
            ['inbox.enter', 'planner.enter', 'temp.open', 'write', 'flush', 'fsync',
             'close', 'replace', 'planner.exit', 'inbox.exit'],
        )
        replace = next(event for event in self.store.events if event[0] == 'replace')
        self.assertEqual((replace[1], replace[2]), ('tasks.json', (True, True, False)))

    def test_workspace_store_import_is_inert(self):
        import workspace_store

        spec = importlib.util.spec_from_file_location(
            '_workspace_store_import_probe', Path(workspace_store.__file__)
        )
        self.assertIsNotNone(spec)
        self.assertIsNotNone(spec.loader)
        module = importlib.util.module_from_spec(spec)
        with patch.object(threading, 'Lock', side_effect=AssertionError('import created a lock')) as lock:
            with patch.object(
                tempfile, 'NamedTemporaryFile',
                side_effect=AssertionError('import created a temporary file'),
            ) as temporary_file:
                spec.loader.exec_module(module)
        lock.assert_not_called()
        temporary_file.assert_not_called()
        self.assertTrue(callable(module.WorkspaceStore))


def _compile_actual_workspace_handler():
    bridge_tree = ast.parse(_BRIDGE_PATH.read_text(encoding='utf-8'), filename=str(_BRIDGE_PATH))
    handler_node = next(
        node for node in bridge_tree.body
        if isinstance(node, ast.ClassDef) and node.name == 'Handler'
    )
    required = {'do_GET', 'do_POST', '_planner_tasks_response'}
    methods = [copy.deepcopy(node) for node in handler_node.body
               if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name in required]
    if {method.name for method in methods} != required:
        raise AssertionError('workspace Handler methods were not found in bridge.py')
    extracted_handler = ast.ClassDef(
        name='ExtractedWorkspaceHandler', bases=[], keywords=[], body=methods, decorator_list=[]
    )
    module = ast.fix_missing_locations(ast.Module(body=[extracted_handler], type_ignores=[]))
    mail_error = type('MailDatabaseError', (Exception,), {})
    portal_error = type('PortalDatabaseError', (Exception,), {})
    namespace = {
        'json': json,
        'WORKSPACE_STORE': None,
        'BRIDGE_API_VERSION': 7,
        'MAX_BODY_BYTES': 16 * 1024,
        'MAX_INBOX_BODY_BYTES': 4 * 1024 * 1024,
        'MAX_PLANNER_BODY_BYTES': 512 * 1024,
        'TOKEN': 'test-token',
        'MAIL_PATH_PREFIX': '/mail/',
        'token_matches': lambda candidate, expected: candidate == expected,
        'ThunderbirdMailError': type('ThunderbirdMailError', (Exception,), {}),
        'ProjectManifestConflict': None,
        'mail_db': types.SimpleNamespace(MailDatabaseError=mail_error),
        'portal_db': types.SimpleNamespace(PortalDatabaseError=portal_error),
    }
    exec(compile(module, str(_BRIDGE_PATH), 'exec'), namespace)
    return namespace['ExtractedWorkspaceHandler'], namespace


_WorkspaceHandlerAdapter, _WORKSPACE_HANDLER_GLOBALS = _compile_actual_workspace_handler()


class _WorkspaceRequest(_WorkspaceHandlerAdapter):
    """In-process request shim for the extracted production Handler methods."""

    def __init__(self, method, path, payload=None):
        self.method = method
        self.path = path
        self.payload = payload or {}
        self.response = None

    def _path(self):
        return self.path

    def _header_authenticated(self):
        return True

    def _origin_allowed(self):
        return True

    def _read_json_body(self, _max_bytes):
        return {'token': 'test-token', **self.payload}

    def json_out(self, status, body):
        self.response = (status, body)
        return self.response


class WorkspaceHandlerCharacterizationTests(WorkspaceTestSafetyMixin, unittest.TestCase):
    def setUp(self):
        super().setUp()
        self.root = self.workspace_temp_root / 'vault'
        self.root.mkdir()
        self.store = WorkspaceFixture(self, self.root)
        self.inbox_path = self.store.inbox_path
        _WORKSPACE_HANDLER_GLOBALS['WORKSPACE_STORE'] = self.store.owner
        _WORKSPACE_HANDLER_GLOBALS['ProjectManifestConflict'] = self.store.ProjectManifestConflict
        self.assertIs(_WORKSPACE_HANDLER_GLOBALS['ProjectManifestConflict'],
                      self.store.ProjectManifestConflict)

    def request(self, method, path, payload=None):
        handler = _WorkspaceRequest(method, path, payload)
        return handler.do_GET() if method == 'GET' else handler.do_POST()

    def test_planner_routes_and_malformed_get_error_mapping(self):
        status, saved = self.request('POST', '/planner/tasks', {
            'tasks': [_planner_task('route-task')],
        })
        self.assertEqual(status, 200)
        self.assertEqual(saved['tasks'][0]['id'], 'route-task')
        status, loaded = self.request('GET', '/planner/tasks')
        self.assertEqual(status, 200)
        self.assertEqual(loaded['tasks'][0]['id'], 'route-task')

        status, _ = self.request('POST', '/inbox', {'entries': [_ai_entry('route-entry')]})
        self.assertEqual(status, 200)
        project_root = self.root / 'projects' / 'route-project'
        project_root.mkdir(parents=True)
        (project_root / 'project.md').write_text(
            '---\nid: route-project\n---\n', encoding='utf-8'
        )
        status, synced = self.request('POST', '/planner/tasks/sync-inbox')
        self.assertEqual(status, 200)
        task_id = next(task['id'] for task in synced['tasks'] if task['id'] == 'inbox:route-entry')
        status, associated = self.request('POST', '/planner/tasks/update', {
            'taskId': task_id, 'projectId': 'route-project',
        })
        self.assertEqual(status, 200)
        self.assertEqual(
            next(task['projectId'] for task in associated['tasks'] if task['id'] == task_id),
            'route-project',
        )

        self.store.planner_path.write_text('{}', encoding='utf-8')
        status, error = self.request('GET', '/planner/tasks')
        self.assertEqual((status, error['errorCode']), (503, 'planner_read_failed'))
        self.store.inbox_path.write_text('{}', encoding='utf-8')
        status, error = self.request('GET', '/inbox')
        self.assertEqual((status, error['errorCode']), (503, 'inbox_read_failed'))


def _install_original_workspace_endpoint_assertions():
    test_bridge_path = Path(__file__).with_name('test_bridge.py')
    tree = ast.parse(test_bridge_path.read_text(encoding='utf-8'), filename=str(test_bridge_path))
    endpoint_class = next(
        node for node in tree.body
        if isinstance(node, ast.ClassDef) and node.name == 'InboxBridgeEndpointTests'
    )
    method_names = {
        'test_inbox_get_and_post_persist_to_vault_json',
        'test_inbox_delete_persists_after_reload',
        'test_project_metadata_update_and_conflict_safety',
        'test_project_next_task_update_targets_only_selected_project',
        'test_ai_apply_cannot_replace_raw_fields_or_remove_existing_entries',
        'test_invalid_post_does_not_change_vault_data',
        'test_write_failure_keeps_existing_data_and_returns_recoverable_error',
    }
    members = [copy.deepcopy(node) for node in endpoint_class.body
               if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
               and (node.name in method_names or node.name == 'raw_entry')]
    if {node.name for node in members if node.name in method_names} != method_names:
        raise AssertionError('original workspace endpoint assertions were not found')
    extracted = ast.fix_missing_locations(ast.Module(body=members, type_ignores=[]))
    namespace = {}
    exec(compile(extracted, str(test_bridge_path), 'exec'), globals(), namespace)
    for name in method_names | {'raw_entry'}:
        setattr(WorkspaceHandlerCharacterizationTests, name, namespace[name])


_install_original_workspace_endpoint_assertions()


if __name__ == '__main__':
    unittest.main()
