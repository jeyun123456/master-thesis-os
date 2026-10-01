from __future__ import annotations

import bridge_config
import importlib
import mail_cli
import sys
import threading
import tempfile
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import mail_db
from mail_test_safety import MailTestSafetyMixin
from mail_jobs import MailJobs
from thunderbird_mail import ThunderbirdSettings


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


class MailJobsTests(MailTestSafetyMixin, unittest.TestCase):
    def setUp(self):
        super().setUp()
        self.temp = tempfile.TemporaryDirectory()
        self.register_mail_test_temp(self.temp.name)
        self.db_path = Path(self.temp.name) / 'mail.db'
        self.settings = ThunderbirdSettings(profile_path='unused', account='school@example.edu')
        self.thread_patch = patch('mail_jobs.threading', SimpleNamespace(Thread=FakeThread, Lock=threading.Lock))
        self.thread_patch.start()
        self.addCleanup(self.thread_patch.stop)
        FakeThread.events = []
        self.jobs = MailJobs(self.settings, self.db_path)

    def tearDown(self):
        self.temp.cleanup()

    def add_mail(self, mail_id: str) -> None:
        item = SimpleNamespace(
            id=mail_id,
            message_id=f'<{mail_id}@example.edu>',
            subject=mail_id,
            sender_name='발신자',
            sender_address='sender@example.edu',
            received_at='2026-09-29T00:00:00Z',
            is_read=False,
        )
        mail_db.upsert_mail(item, 'school-work', '본문', mail_db.now_iso(), self.db_path)

    def test_status_recovers_processing_and_wakes_queued_ai(self):
        self.add_mail('processing')
        self.add_mail('queued')
        self.assertTrue(mail_db.claim_analysis('processing', self.db_path))

        status = self.jobs.status()

        self.assertEqual(mail_db.sync_status(self.db_path)['counts'], {
            'queued': 2, 'processing': 0, 'completed': 0, 'failed': 0,
        })
        self.assertFalse(status['jobRunning'])
        self.assertTrue(status['aiRunning'])
        self.assertEqual(FakeThread.events, [('start', 'mail-ai-batch')])
        self.assertEqual(list(status), [
            'ok', 'source', 'status', 'phase', 'lastSyncAt', 'newCount', 'analysisCompleted',
            'analysisFailed', 'progress', 'counts', 'folders', 'jobRunning', 'aiRunning',
        ])

    def test_ai_worker_drains_until_queue_is_empty(self):
        self.add_mail('first')
        self.add_mail('second')
        self.assertTrue(self.jobs.ensure_ai_worker())
        worker = self.jobs._ai_thread
        self.assertIsInstance(worker, FakeThread)
        analyzed: list[str] = []

        def analyze_one(_settings, db_path):
            item = mail_db.queued_mail(db_path)[0]
            analyzed.append(item['id'])
            self.assertTrue(mail_db.claim_analysis(item['id'], db_path))
            mail_db.save_completed(
                item['id'], {'summary': '요약', 'action': None, 'calendarCandidates': []},
                'test', 'test', mail_db.now_iso(), db_path,
            )

        with patch('mail_cli.load_settings', return_value=self.settings), \
             patch('mail_cli.analyze_new', side_effect=analyze_one) as analyze:
            worker.run()

        self.assertEqual(analyze.call_count, 2)
        self.assertEqual(set(analyzed), {'first', 'second'})
        self.assertEqual(mail_db.sync_status(self.db_path)['counts']['queued'], 0)
        self.assertIsNone(self.jobs._ai_thread)

    def test_sync_uses_collection_only_then_starts_ai_and_rejects_duplicate(self):
        self.add_mail('queued')
        self.assertTrue(self.jobs.start_sync())
        worker = self.jobs._job_thread
        self.assertIsInstance(worker, FakeThread)
        self.assertFalse(self.jobs.start_sync())

        with patch('mail_cli.sync_mail', return_value={}) as sync_mail:
            worker.run()

        sync_mail.assert_called_once_with(self.settings, self.db_path, analyze=False)
        self.assertEqual(FakeThread.events, [
            ('start', 'mail-sync'), ('start', 'mail-ai-batch'),
        ])
        self.assertIsNone(self.jobs._job_thread)
        self.assertIsNone(self.jobs._job_kind)
        self.assertIsNone(self.jobs._job_error)
        self.assertIsInstance(self.jobs._ai_thread, FakeThread)

    def test_sync_failure_is_persisted_and_returned_in_status(self):
        self.assertTrue(self.jobs.start_sync())
        worker = self.jobs._job_thread
        with patch('mail_cli.sync_mail', side_effect=RuntimeError('hidden failure')):
            worker.run()

        status = self.jobs.status()
        message = '메일 동기화 작업이 중단되었어.'
        self.assertEqual(status['jobError'], message)
        self.assertEqual(list(status)[-3:], ['jobRunning', 'jobError', 'aiRunning'])
        self.assertEqual(
            {folder['folder']: folder['error'] for folder in status['folders']},
            {folder: message for folder in mail_db.TARGET_FOLDERS},
        )

    def test_ai_failure_is_returned_when_status_has_no_queued_work(self):
        with patch('mail_cli.load_settings', return_value=self.settings), \
             patch('mail_cli.analyze_new', side_effect=RuntimeError('hidden failure')):
            self.jobs._run_ai_job()

        status = self.jobs.status()
        self.assertEqual(status['aiError'], '메일 AI 분석 작업이 중단되었어.')
        self.assertEqual(list(status)[-2:], ['aiRunning', 'aiError'])

    def test_import_does_not_read_config_or_start_bridge_server_or_thread(self):
        missing = object()
        bridge_before = sys.modules.get('bridge', missing)
        original = sys.modules.pop('mail_jobs')
        attempts: list[str] = []

        def forbidden(label):
            def deny(*_args, **_kwargs):
                attempts.append(label)
                raise AssertionError(f'unexpected import side effect: {label}')
            return deny

        class ForbiddenThread:
            def __init__(self, *_args, **_kwargs):
                forbidden('thread construction')()

            def start(self):
                forbidden('thread start')()

        fake_threading = SimpleNamespace(**vars(threading))
        fake_threading.Thread = ForbiddenThread
        try:
            with patch.dict(sys.modules, {'threading': fake_threading}), \
                 patch.object(Path, 'read_text', forbidden('path read')), \
                 patch.object(bridge_config, 'load_bridge_config', forbidden('bridge config load')), \
                 patch.object(bridge_config, 'resolve_config_path', forbidden('bridge config path')), \
                 patch.object(mail_cli, 'load_bridge_config', forbidden('mail config load')), \
                 patch.object(mail_cli, 'resolve_config_path', forbidden('mail config path')), \
                 patch.object(ThreadingHTTPServer, '__init__', forbidden('server construction')), \
                 patch.object(ThreadingHTTPServer, 'serve_forever', forbidden('server start')):
                fresh = importlib.import_module('mail_jobs')
                self.assertIs(sys.modules['mail_jobs'], fresh)
                self.assertIs(fresh.threading, fake_threading)
            self.assertEqual(attempts, [])
            self.assertIs(sys.modules.get('bridge', missing), bridge_before)
        finally:
            sys.modules.pop('mail_jobs', None)
            sys.modules['mail_jobs'] = original


if __name__ == '__main__':
    unittest.main()
