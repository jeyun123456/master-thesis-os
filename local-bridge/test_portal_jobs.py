from __future__ import annotations

import ast
import builtins
import copy
import __future__
import importlib
import io
import os
import sqlite3
import subprocess
import sys
import tempfile
import threading
import types
import unittest
import urllib.request
import webbrowser
from contextlib import closing
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote
from unittest.mock import Mock, patch

import bridge_config
import portal_ai
import portal_client
import portal_cli
import portal_db
import portal_jobs
from portal_client import PortalError
from portal_test_safety import PortalTestSafetyMixin


class FakeThread:
    events: list[tuple[str, str]] = []

    def __init__(self, target, name: str, daemon: bool):
        self.target = target
        self.name = name
        self.daemon = daemon
        self.alive = False

    def start(self):
        self.alive = True
        self.events.append(('start', self.name))

    def is_alive(self) -> bool:
        return self.alive

    def run(self):
        try:
            self.target()
        finally:
            self.alive = False


class PortalSafetyGuardTests(PortalTestSafetyMixin, unittest.TestCase):
    def setUp(self):
        super().setUp()
        self.temp = tempfile.TemporaryDirectory()

    def tearDown(self):
        self.temp.cleanup()

    def test_external_boundaries_and_outside_paths_are_denied_and_tracked(self):
        self.assertEqual(
            set(os.environ),
            {key for key in self._SAFE_ENV_KEYS if key in os.environ},
        )
        safe_file = Path(self.temp.name) / 'portal-safe-test-file.txt'
        safe_file.write_text('synthetic', encoding='utf-8')
        self.assertEqual(safe_file.read_text(encoding='utf-8'), 'synthetic')
        outside = Path(self.temp.name).parent / 'portal-outside-test-file.txt'
        attempts = [
            ('portal_ai._request_batch_provider', lambda: portal_ai._request_batch_provider([])),
            ('portal_ai._request_batch_http_provider', lambda: portal_ai._request_batch_http_provider([])),
            ('portal_client.PortalClient._playwright', portal_client.PortalClient._playwright),
            (
                'portal_client.find_system_default_browser_executable',
                portal_client.find_system_default_browser_executable,
            ),
            ('urllib.request.urlopen', lambda: urllib.request.urlopen('https://example.invalid')),
            ('subprocess.Popen', lambda: subprocess.Popen(['not-a-real-process'])),
            ('subprocess.run', lambda: subprocess.run(['not-a-real-process'])),
            ('os.startfile', lambda: os.startfile('https://example.invalid')),
            ('webbrowser.open', lambda: webbrowser.open('https://example.invalid')),
            ('bridge_config.load_bridge_config', lambda: bridge_config.load_bridge_config(outside)),
            ('portal_db.resolve_db_path', portal_db.resolve_db_path),
            ('portal_db.resolve_db_path', lambda: portal_db.resolve_db_path(outside)),
            ('sqlite3.connect', lambda: sqlite3.connect(str(outside))),
            ('builtins.open', lambda: builtins.open(outside, 'r', encoding='utf-8')),
            ('io.open', lambda: io.open(outside, 'r', encoding='utf-8')),
        ]
        expected = []
        for label, attempt in attempts:
            with self.subTest(label=label):
                with self.assertRaises(AssertionError):
                    attempt()
            expected.append(label)

        before = len(self.mail_safety_attempts)
        try:
            portal_ai._request_provider({'body': 'synthetic'})
        except Exception:
            pass
        self.assertEqual(self.mail_safety_attempts[before:], ['portal_ai._request_provider'])
        expected.append('portal_ai._request_provider')

        with self.assertRaises(AssertionError):
            self._assert_no_mail_safety_attempts()
        self.clear_expected_mail_safety_attempts(expected)


class PortalJobsImportSafetyTests(PortalTestSafetyMixin, unittest.TestCase):
    def test_import_is_inert(self):
        missing = object()
        original = sys.modules.pop('portal_jobs', missing)
        bridge_before = sys.modules.get('bridge', missing)
        attempts = []

        def forbidden(label):
            def deny(*_args, **_kwargs):
                attempts.append(label)
                raise AssertionError(f'unexpected portal jobs import effect: {label}')
            return deny

        fake_threading = types.SimpleNamespace(
            Thread=forbidden('thread construction'),
            Lock=forbidden('lock construction'),
        )
        try:
            with patch.dict(sys.modules, {'threading': fake_threading}), \
                 patch.object(portal_db, 'initialize_database', forbidden('database initialization')), \
                 patch.object(portal_db, 'resolve_db_path', forbidden('database path resolution')), \
                 patch.object(sqlite3, 'connect', forbidden('database connection')), \
                 patch.object(bridge_config, 'load_bridge_config', forbidden('config load')), \
                 patch.object(bridge_config, 'resolve_config_path', forbidden('config path resolution')), \
                 patch.object(Path, 'read_text', forbidden('path read')), \
                 patch.object(ThreadingHTTPServer, '__init__', forbidden('server construction')), \
                 patch.object(ThreadingHTTPServer, 'serve_forever', forbidden('server start')), \
                 patch.object(portal_client.PortalClient, '_playwright', staticmethod(forbidden('browser start'))), \
                 patch.object(portal_client, 'find_system_default_browser_executable', forbidden('browser registry lookup')), \
                 patch.object(portal_cli, 'sync_portal', forbidden('portal sync')), \
                 patch.object(portal_cli, 'login_portal', forbidden('portal login')), \
                 patch.object(portal_db, 'notices_needing_analysis', forbidden('backfill lookup')), \
                 patch.object(portal_db, 'queue_notice_analyses', forbidden('backfill queue')), \
                 patch.object(portal_db, 'queue_notice_analysis', forbidden('manual AI queue')), \
                 patch.object(portal_db, 'ai_progress', forbidden('backfill progress')), \
                 patch.object(portal_db, 'claim_notice_analysis_batch', forbidden('AI batch claim')), \
                 patch.object(portal_ai, 'provider_model', forbidden('AI provider model')), \
                 patch.object(portal_ai, 'analyze_notices', forbidden('AI provider')):
                fresh = importlib.import_module('portal_jobs')
                self.assertIs(sys.modules['portal_jobs'], fresh)
                self.assertIs(fresh.threading, fake_threading)
            self.assertEqual(attempts, [])
            self.assertIs(sys.modules.get('bridge', missing), bridge_before)
        finally:
            sys.modules.pop('portal_jobs', None)
            if original is not missing:
                sys.modules['portal_jobs'] = original


class PortalBridgeRouteTests(PortalTestSafetyMixin, unittest.TestCase):
    def setUp(self):
        super().setUp()
        self.temp_dir = tempfile.TemporaryDirectory()
        bridge_path = Path(__file__).with_name('bridge.py')
        tree = ast.parse(bridge_path.read_text(encoding='utf-8'), filename=str(bridge_path))
        source_handler = next(
            node for node in tree.body
            if isinstance(node, ast.ClassDef) and node.name == 'Handler'
        )
        methods = [
            copy.deepcopy(node) for node in source_handler.body
            if isinstance(node, ast.FunctionDef) and node.name in {'do_GET', '_portal_post'}
        ]
        handler = ast.ClassDef(
            name='Handler',
            bases=[ast.Name(id='BaseHTTPRequestHandler', ctx=ast.Load())],
            keywords=[],
            body=methods,
            decorator_list=[],
        )
        module = ast.fix_missing_locations(ast.Module(body=[handler], type_ignores=[]))
        namespace = {
            'BaseHTTPRequestHandler': object,
            'portal_db': portal_db,
            'PORTAL_JOBS': Mock(),
            'PORTAL_DB_PATH': Path(self.temp_dir.name) / 'portal.db',
            'unquote': unquote,
        }
        code = compile(
            module,
            str(bridge_path),
            'exec',
            flags=__future__.annotations.compiler_flag,
        )
        exec(code, namespace)
        self.jobs = namespace['PORTAL_JOBS']
        self.handler = namespace['Handler']()
        self.handler.json_out = lambda status, body: (status, body)
        self.handler._path = lambda: '/portal/status'
        self.handler._header_authenticated = lambda: True

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_status_route_returns_snapshot_and_database_error(self):
        snapshot = {'ok': True, 'source': 'sqlite', 'status': 'idle', 'ai': {'queued': 0}}
        self.jobs.status.return_value = snapshot
        self.assertEqual(self.handler.do_GET(), (200, snapshot))

        self.jobs.status.side_effect = portal_db.PortalDatabaseError('synthetic status failure')
        self.assertEqual(
            self.handler.do_GET(),
            (503, {'ok': False, 'source': 'sqlite', 'error': 'database_error'}),
        )

    def test_sync_and_login_routes_preserve_accepted_and_conflict_responses(self):
        self.jobs.start_sync.return_value = True
        self.assertEqual(
            self.handler._portal_post('/portal/sync'),
            (202, {'ok': True, 'source': 'sqlite', 'status': 'running', 'jobKind': 'sync'}),
        )
        self.jobs.start_sync.return_value = False
        self.assertEqual(
            self.handler._portal_post('/portal/sync'),
            (409, {'ok': False, 'source': 'sqlite', 'error': 'sync_already_running'}),
        )
        self.jobs.start_login.return_value = True
        self.assertEqual(
            self.handler._portal_post('/portal/login'),
            (202, {'ok': True, 'source': 'sqlite', 'status': 'running', 'jobKind': 'login'}),
        )
        self.jobs.start_login.return_value = False
        self.assertEqual(
            self.handler._portal_post('/portal/login'),
            (409, {'ok': False, 'source': 'sqlite', 'error': 'portal_job_already_running'}),
        )

    def test_backfill_route_includes_failed_rows_and_returns_ai_progress(self):
        self.jobs.queue_backfill.return_value = 2
        progress = {'total': 3, 'completed': 1, 'queued': 2, 'processing': 0, 'failed': 0}
        with patch('portal_db.ai_progress', return_value=progress):
            response = self.handler._portal_post('/portal/ai/backfill')

        self.jobs.queue_backfill.assert_called_once_with(include_failed=True)
        self.assertEqual(response, (202, {
            'ok': True, 'source': 'sqlite', 'queued': 2, 'ai': progress,
        }))

    def test_notice_analysis_route_passes_force_and_preserves_accepted_conflict(self):
        with patch('portal_db.get_notice', return_value={'noticeId': 'notice/id'}):
            self.jobs.start_notice_analysis.return_value = True
            response = self.handler._portal_post('/portal/notices/notice%2Fid/analyze', {'force': True})
            self.assertEqual(response, (202, {
                'ok': True, 'source': 'sqlite', 'status': 'queued', 'jobKind': 'ai', 'noticeId': 'notice/id',
            }))
            self.jobs.start_notice_analysis.assert_called_once_with('notice/id', force=True)

            self.jobs.start_notice_analysis.return_value = False
            response = self.handler._portal_post('/portal/notices/notice%2Fid/analyze', {'force': True})
            self.assertEqual(response, (409, {
                'ok': False, 'source': 'sqlite', 'error': 'ai_job_already_running',
            }))


class PortalJobsCharacterizationTests(PortalTestSafetyMixin, unittest.TestCase):
    def setUp(self):
        super().setUp()
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.db_path = self.root / 'portal.db'
        portal_db.initialize_database(self.db_path)
        FakeThread.events = []
        self.thread_patch = patch(
            'portal_jobs.threading',
            types.SimpleNamespace(Thread=FakeThread, Lock=threading.Lock),
        )
        self.thread_patch.start()
        self.addCleanup(self.thread_patch.stop)
        self.model_patch = patch('portal_ai.provider_model', return_value='test-model')
        self.model_patch.start()
        self.addCleanup(self.model_patch.stop)
        self.jobs = self.make_jobs(self.db_path)

    def tearDown(self):
        self.temp.cleanup()

    def make_jobs(self, db_path: str | Path):
        return portal_jobs.PortalJobs(self.root, db_path)

    def add_notice(self, notice_id: str, body: str = 'synthetic notice body', db_path=None) -> None:
        path = Path(db_path or self.db_path)
        synced_at = '2026-09-18T14:00:00Z'
        summary = {
            'notice_id': notice_id,
            'type': 'ALL',
            'title': f'Title {notice_id}',
            'department': 'Synthetic office',
            'published_at': '2026-09-18T09:00:00Z',
            'expires_at': '',
            'deadline': '',
            'importance': '',
            'category': 'Other',
            'source_url': f'https://example.invalid/{notice_id}',
        }
        portal_db.upsert_notice_summary(summary, synced_at, path)
        portal_db.upsert_notice_detail(
            {**summary, 'body': body, 'attachments': []},
            [],
            synced_at,
            path,
        )

    def complete_notice(self, notice_id: str, db_path=None) -> None:
        path = Path(db_path or self.db_path)
        self.assertTrue(portal_db.queue_notice_analysis(notice_id, path))
        portal_db.save_notice_analysis(
            notice_id,
            {'summary': 'synthetic summary', 'translation': 'synthetic translation', 'calendarCandidates': []},
            portal_ai.PROMPT_VERSION,
            portal_ai.provider_model(),
            '2026-09-18T15:00:00Z',
            path,
        )

    def ai_row(self, notice_id: str, db_path=None):
        path = Path(db_path or self.db_path)
        with closing(sqlite3.connect(str(path))) as connection:
            return connection.execute(
                'SELECT status, error_code, error FROM portal_notice_ai WHERE notice_id = ?',
                (notice_id,),
            ).fetchone()

    def test_idle_status_envelope_and_no_work(self):
        with patch('portal_client.profile_session_state', return_value='login_required'):
            status = self.jobs.status()

        self.assertEqual(list(status), [
            'ok', 'source', 'lastSyncAt', 'status', 'storedCount', 'counts', 'totalCount',
            'newCount', 'updatedCount', 'detailFailedCount', 'history', 'session',
            'jobRunning', 'ai',
        ])
        self.assertTrue(status['ok'])
        self.assertEqual(status['source'], 'sqlite')
        self.assertEqual(status['status'], 'idle')
        self.assertEqual(status['session'], {'state': 'login_required'})
        self.assertFalse(status['jobRunning'])
        self.assertEqual(status['ai'], {
            'total': 0, 'completed': 0, 'queued': 0, 'processing': 0,
            'failed': 0, 'running': False,
        })
        self.assertEqual(FakeThread.events, [])

    def test_sync_and_login_share_gate_while_ai_gate_is_independent(self):
        self.add_notice('gate')
        self.assertTrue(self.jobs.start_sync())
        self.assertFalse(self.jobs.start_sync())
        self.assertFalse(self.jobs.start_login())
        self.assertTrue(self.jobs.start_notice_analysis('gate'))
        self.assertFalse(self.jobs.start_notice_analysis('gate'))
        self.assertEqual(FakeThread.events, [
            ('start', 'portal-sync'), ('start', 'portal-ai-batch'),
        ])
        self.assertTrue(self.jobs._job_thread.is_alive())
        self.assertTrue(self.jobs._ai_thread.is_alive())

    def test_successful_sync_queues_backfill_after_releasing_collection_gate(self):
        self.add_notice('after-sync')
        self.assertTrue(self.jobs.start_sync())
        sync_thread = self.jobs._job_thread
        with patch('portal_cli.sync_portal', return_value={'status': 'completed'}) as sync:
            sync_thread.run()

        sync.assert_called_once_with(self.root.resolve(), self.db_path.resolve())
        self.assertIsNone(self.jobs._job_thread)
        self.assertIsNone(self.jobs._job_kind)
        self.assertIsNone(self.jobs._job_error)
        self.assertIsNone(self.jobs._job_error_code)
        self.assertTrue(self.jobs._ai_thread.is_alive())
        self.assertEqual(FakeThread.events, [
            ('start', 'portal-sync'), ('start', 'portal-ai-batch'),
        ])
        self.assertEqual(self.ai_row('after-sync')[0], 'queued')

    def test_sync_failure_is_reported_and_does_not_start_ai(self):
        self.assertTrue(self.jobs.start_sync())
        sync_thread = self.jobs._job_thread
        with patch('portal_cli.sync_portal', side_effect=PortalError('portal_unreachable', 'synthetic failure')):
            sync_thread.run()

        self.assertIsNone(self.jobs._job_thread)
        self.assertEqual(self.jobs._job_error, 'synthetic failure')
        self.assertEqual(self.jobs._job_error_code, 'portal_unreachable')
        self.assertIsNone(self.jobs._ai_thread)
        self.assertEqual(FakeThread.events, [('start', 'portal-sync')])

    def test_ai_backfill_error_does_not_turn_successful_sync_into_failure(self):
        self.add_notice('ai-error')
        self.assertTrue(self.jobs.start_sync())
        sync_thread = self.jobs._job_thread
        with patch('portal_cli.sync_portal', return_value={'status': 'completed'}), \
             patch('portal_db.notices_needing_analysis', side_effect=RuntimeError('synthetic AI lookup failure')):
            sync_thread.run()
            self.assertIsNone(self.jobs._job_error)
            self.assertIsNone(self.jobs._job_error_code)
            with patch('portal_client.profile_session_state', return_value='saved'):
                status = self.jobs.status()

        self.assertEqual(status['status'], 'idle')
        self.assertNotIn('jobError', status)
        self.assertEqual(status['ai']['error'], 'synthetic AI lookup failure')
        self.assertEqual(status['ai']['errorCode'], 'ai_provider_failed')

    def test_status_recovers_interrupted_rows_then_default_backfill_requeues_them(self):
        self.add_notice('was-queued')
        self.add_notice('was-processing')
        self.assertTrue(portal_db.queue_notice_analysis('was-queued', self.db_path))
        self.assertTrue(portal_db.queue_notice_analysis('was-processing', self.db_path))
        self.assertTrue(portal_db.claim_notice_analysis('was-processing', self.db_path))

        original_queue = portal_db.queue_notice_analyses
        recovered_before_backfill = {}

        def capture_recovered(ids, path=None, **kwargs):
            ids = list(ids)
            with closing(sqlite3.connect(str(self.db_path))) as connection:
                recovered_before_backfill.update({
                    notice_id: (status, error_code)
                    for notice_id, status, error_code in connection.execute(
                        'SELECT notice_id, status, error_code FROM portal_notice_ai'
                    )
                    if notice_id in ids
                })
            return original_queue(ids, path, **kwargs)

        with patch('portal_db.queue_notice_analyses', side_effect=capture_recovered), \
             patch('portal_client.profile_session_state', return_value='saved'):
            status = self.jobs.status()

        self.assertEqual(recovered_before_backfill, {
            'was-queued': ('failed', 'ai_interrupted'),
            'was-processing': ('failed', 'ai_interrupted'),
        })
        self.assertEqual(self.ai_row('was-queued')[0], 'queued')
        self.assertEqual(self.ai_row('was-processing')[0], 'queued')
        self.assertEqual(status['ai']['queued'], 2)
        self.assertTrue(status['ai']['running'])
        self.assertEqual(FakeThread.events, [('start', 'portal-ai-batch')])

    def test_backfill_include_failed_and_manual_force_rules(self):
        self.add_notice('failed')
        self.add_notice('completed')
        self.assertTrue(portal_db.queue_notice_analysis('failed', self.db_path))
        self.assertTrue(portal_db.claim_notice_analysis('failed', self.db_path))
        portal_db.save_notice_analysis_failed('failed', 'provider_error', 'synthetic failure', self.db_path)
        self.complete_notice('completed')

        self.assertEqual(self.jobs.queue_backfill(), 0)
        self.assertEqual(self.ai_row('failed')[0], 'failed')
        self.assertEqual(self.jobs.queue_backfill(include_failed=True), 1)
        self.assertEqual(self.ai_row('failed')[0], 'queued')
        self.assertFalse(self.jobs.start_notice_analysis('completed'))
        self.assertTrue(self.jobs.start_notice_analysis('completed', force=True))
        self.assertEqual(self.ai_row('completed')[0], 'queued')
        self.assertFalse(self.jobs.start_notice_analysis('failed', force=True))
        self.assertEqual(FakeThread.events, [('start', 'portal-ai-batch')])

    def test_backfill_matches_completed_content_prompt_and_model(self):
        scenarios = ('same', 'content', 'prompt', 'model')
        expected_counts = {'same': 0, 'content': 1, 'prompt': 1, 'model': 1}
        for scenario in scenarios:
            with self.subTest(scenario=scenario):
                db_path = self.root / scenario / 'portal.db'
                db_path.parent.mkdir()
                self.add_notice(scenario, db_path=db_path)
                self.complete_notice(scenario, db_path=db_path)
                jobs = self.make_jobs(db_path)
                if scenario == 'content':
                    summary = {
                        'notice_id': scenario,
                        'type': 'ALL',
                        'title': f'Title {scenario}',
                        'department': 'Synthetic office',
                        'published_at': '2026-09-18T09:00:00Z',
                        'expires_at': '', 'deadline': '', 'importance': '',
                        'category': 'Other',
                        'source_url': f'https://example.invalid/{scenario}',
                    }
                    portal_db.upsert_notice_detail(
                        {**summary, 'body': 'changed synthetic body', 'attachments': []},
                        [], '2026-09-18T16:00:00Z', db_path,
                    )
                elif scenario == 'prompt':
                    prompt_patch = patch('portal_ai.PROMPT_VERSION', 'portal-notice-ai-v2')
                    prompt_patch.start()
                    self.addCleanup(prompt_patch.stop)
                elif scenario == 'model':
                    model_patch = patch('portal_ai.provider_model', return_value='changed-model')
                    model_patch.start()
                    self.addCleanup(model_patch.stop)

                self.assertEqual(jobs.queue_backfill(), expected_counts[scenario])
                self.assertEqual(
                    self.ai_row(scenario, db_path)[0],
                    'completed' if scenario == 'same' else 'queued',
                )

    def test_worker_drains_batches_of_three_in_database_claim_order(self):
        notice_ids = [f'N-{index}' for index in range(7)]
        for notice_id in notice_ids:
            self.add_notice(notice_id)
        with patch('portal_db.now_iso', return_value='2026-09-18T17:00:00Z'):
            for notice_id in notice_ids:
                self.assertTrue(portal_db.queue_notice_analysis(notice_id, self.db_path))
        self.assertEqual(self.jobs.queue_backfill(), 0)
        ai_thread = self.jobs._ai_thread
        analyzed_batches = []

        def analyze_batch(notices):
            ids = [str(notice['noticeId']) for notice in notices]
            analyzed_batches.append(ids)
            return {
                notice_id: {
                    'summary': f'summary {notice_id}',
                    'translation': f'translation {notice_id}',
                    'calendarCandidates': [],
                }
                for notice_id in ids
            }

        with patch('portal_ai.analyze_notices', side_effect=analyze_batch):
            ai_thread.run()

        self.assertEqual(analyzed_batches, [
            ['N-6', 'N-5', 'N-4'],
            ['N-3', 'N-2', 'N-1'],
            ['N-0'],
        ])
        self.assertTrue(all(self.ai_row(notice_id)[0] == 'completed' for notice_id in notice_ids))
        self.assertIsNone(self.jobs._ai_thread)

    def test_provider_failure_marker_errors_are_guarded_and_worker_keeps_draining(self):
        notice_ids = [f'P-{index}' for index in range(4)]
        for notice_id in notice_ids:
            self.add_notice(notice_id)
            self.assertTrue(portal_db.queue_notice_analysis(notice_id, self.db_path))
        self.assertEqual(self.jobs.queue_backfill(), 0)
        ai_thread = self.jobs._ai_thread

        def successful_batch(notices):
            return {
                str(notice['noticeId']): {
                    'summary': 'summary', 'translation': 'translation', 'calendarCandidates': [],
                }
                for notice in notices
            }

        def fail_marker(*_args, **_kwargs):
            raise RuntimeError('synthetic failure marker write')

        calls = 0

        def fail_once_then_analyze(notices):
            nonlocal calls
            if calls == 0:
                calls += 1
                raise portal_ai.PortalAIError('provider failed', 'provider_error')
            return successful_batch(notices)

        with patch('portal_ai.analyze_notices', side_effect=fail_once_then_analyze), \
             patch('portal_db.save_notice_analysis_failed', side_effect=fail_marker):
            ai_thread.run()

        self.assertEqual(calls, 1)
        self.assertEqual([self.ai_row(notice_id)[0] for notice_id in notice_ids], [
            'completed', 'processing', 'processing', 'processing',
        ])
        self.assertEqual(self.jobs._ai_error, 'provider failed')
        self.assertEqual(self.jobs._ai_error_code, 'provider_error')

    def test_missing_result_marker_error_aborts_the_remaining_batches(self):
        notice_ids = [f'M-{index}' for index in range(4)]
        for notice_id in notice_ids:
            self.add_notice(notice_id)
            self.assertTrue(portal_db.queue_notice_analysis(notice_id, self.db_path))
        self.assertEqual(self.jobs.queue_backfill(), 0)
        ai_thread = self.jobs._ai_thread
        calls = []

        def missing_batch(notices):
            calls.append([str(notice['noticeId']) for notice in notices])
            return {}

        with patch('portal_ai.analyze_notices', side_effect=missing_batch), \
             patch('portal_db.save_notice_analysis_failed', side_effect=RuntimeError('synthetic marker failure')):
            ai_thread.run()

        self.assertEqual(calls, [['M-3', 'M-2', 'M-1']])
        self.assertEqual([self.ai_row(notice_id)[0] for notice_id in notice_ids], [
            'queued', 'processing', 'processing', 'processing',
        ])
        self.assertEqual(self.jobs._ai_error, 'synthetic marker failure')
        self.assertEqual(self.jobs._ai_error_code, 'ai_provider_failed')

    def test_completed_save_failure_is_marked_failed(self):
        self.add_notice('save-failure')
        self.assertTrue(portal_db.queue_notice_analysis('save-failure', self.db_path))
        self.assertEqual(self.jobs.queue_backfill(), 0)
        ai_thread = self.jobs._ai_thread
        result = {
            'save-failure': {
                'summary': 'summary', 'translation': 'translation', 'calendarCandidates': [],
            },
        }
        with patch('portal_ai.analyze_notices', return_value=result), \
             patch('portal_db.save_notice_analysis', side_effect=RuntimeError('synthetic result write failure')):
            ai_thread.run()

        self.assertEqual(self.ai_row('save-failure')[:2], ('failed', 'ai_storage_failed'))
        self.assertEqual(self.jobs._ai_error, 'synthetic result write failure')
        self.assertEqual(self.jobs._ai_error_code, 'ai_storage_failed')

    def test_normal_save_marker_failure_is_guarded_and_worker_continues(self):
        notice_ids = [f'S-{index}' for index in range(4)]
        for notice_id in notice_ids:
            self.add_notice(notice_id)
            self.assertTrue(portal_db.queue_notice_analysis(notice_id, self.db_path))
        self.assertEqual(self.jobs.queue_backfill(), 0)
        ai_thread = self.jobs._ai_thread
        original_save = portal_db.save_notice_analysis

        def save_except_first(notice_id, *args, **kwargs):
            if notice_id == 'S-3':
                raise RuntimeError('synthetic result write failure')
            return original_save(notice_id, *args, **kwargs)

        def fail_first_marker(notice_id, *args, **kwargs):
            if notice_id == 'S-3':
                raise RuntimeError('synthetic marker write failure')
            return portal_db.save_notice_analysis_failed(notice_id, *args, **kwargs)

        def successful_batch(notices):
            return {
                str(notice['noticeId']): {
                    'summary': 'summary', 'translation': 'translation', 'calendarCandidates': [],
                }
                for notice in notices
            }

        with patch('portal_ai.analyze_notices', side_effect=successful_batch), \
             patch('portal_db.save_notice_analysis', side_effect=save_except_first), \
             patch('portal_db.save_notice_analysis_failed', side_effect=fail_first_marker):
            ai_thread.run()

        self.assertEqual([self.ai_row(notice_id)[0] for notice_id in notice_ids], [
            'completed', 'completed', 'completed', 'processing',
        ])
        self.assertEqual(self.jobs._ai_error, 'synthetic result write failure')
        self.assertEqual(self.jobs._ai_error_code, 'ai_storage_failed')

    def test_transient_job_error_overrides_persisted_session_error(self):
        portal_db.fail_sync(
            portal_db.now_iso(),
            'session_expired',
            'persisted session error',
            path=self.db_path,
        )
        self.assertTrue(self.jobs.start_login())
        login_thread = self.jobs._job_thread
        with patch('portal_cli.login_portal', side_effect=PortalError('login_required', 'transient login error')):
            login_thread.run()

        with patch('portal_client.profile_session_state', return_value='saved'):
            status = self.jobs.status()
        self.assertEqual(status['lastErrorCode'], 'session_expired')
        self.assertEqual(status['jobErrorCode'], 'login_required')
        self.assertEqual(status['jobError'], 'transient login error')
        self.assertEqual(status['session'], {'state': 'login_required'})

        recovered_view = self.make_jobs(self.db_path)
        with patch('portal_client.profile_session_state', return_value='saved'):
            persisted_status = recovered_view.status()
        self.assertNotIn('jobErrorCode', persisted_status)
        self.assertEqual(persisted_status['session'], {'state': 'session_expired'})


if __name__ == '__main__':
    unittest.main()
