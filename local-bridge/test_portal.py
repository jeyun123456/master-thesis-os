import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import portal_db
import portal_cli
from portal_client import (
    NoticeSummary,
    PortalError,
    _record_list,
    _validated_deadline,
    browser_channel,
    classify_notice_type,
    extract_labeled_value,
    profile_session_state,
    resolve_profile_path,
)


class PortalParsingTests(unittest.TestCase):
    def test_maps_observed_portal_distribution_to_all_and_dm(self):
        self.assertEqual(classify_notice_type('全体'), 'ALL')
        self.assertEqual(classify_notice_type('個人'), 'DM')
        self.assertEqual(classify_notice_type('DM'), 'DM')
        self.assertEqual(classify_notice_type('その他'), 'ALL')

    def test_extracts_visible_detail_labels(self):
        text = '\n'.join([
            'タイトル',
            'サンプルタイトル',
            '本文',
            '本文です',
            '公開日',
            '2026/09/18 18:00',
            '担当部課',
            '教学推進課',
            '終了日',
            '2026/10/01 00:00',
        ])
        self.assertEqual(extract_labeled_value(text, 'タイトル'), 'サンプルタイトル')
        self.assertEqual(extract_labeled_value(text, '担当部課'), '教学推進課')
        self.assertEqual(extract_labeled_value(text, '終了日'), '2026/10/01 00:00')

    def test_rejects_detail_footer_as_deadline(self):
        self.assertEqual(_validated_deadline('2026/09/22\nこのサイトについて｜ 関連リンク'), '2026/09/22')
        self.assertEqual(_validated_deadline('ファイル(1)\nDownload\nこのサイトについて'), '')

    def test_finds_nested_aura_notice_records(self):
        value = {
            'actions': [{
                'returnValue': [{
                    'Id': 'a0efD0000000001QAA',
                    'Name': 'I-0000000001',
                    'R_Title__c': '공지',
                }],
            }],
        }
        records = _record_list(value)
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]['Name'], 'I-0000000001')

    def test_allows_salesforce_record_id_as_notice_id_fallback(self):
        records = _record_list([{
            'Id': 'a0efD0000000002QAA',
            'R_Title__c': 'Name 없는 공지',
        }])
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]['Id'], 'a0efD0000000002QAA')


class PortalDatabaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / 'portal-notices.db'
        self.synced_at = '2026-09-18T14:00:00Z'
        self.summary = {
            'notice_id': 'I-0000000001',
            'type': 'ALL',
            'title': '공지 제목',
            'department': '教学推進課',
            'published_at': '2026-09-18T09:00:00Z',
            'expires_at': '2026-10-01T00:00:00Z',
            'deadline': '2026/09/30',
            'importance': '重要',
            'category': '学生生活・課外活動',
            'source_url': 'https://sp.ritsumei.ac.jp/studentportal/s/r-information/a0/view',
        }

    def tearDown(self):
        self.temp.cleanup()

    def test_summary_detail_upsert_is_idempotent_and_preserves_history(self):
        first = portal_db.upsert_notice_summary(self.summary, self.synced_at, self.path)
        second = portal_db.upsert_notice_summary(self.summary, self.synced_at, self.path)
        self.assertTrue(first.inserted)
        self.assertFalse(second.inserted)
        self.assertEqual(portal_db.existing_notice_ids(['I-0000000001'], self.path), {'I-0000000001'})
        self.assertEqual(portal_db.notice_ids_needing_detail(['I-0000000001'], self.path), {'I-0000000001'})

        detail = {**self.summary, 'body': '본문\n두 번째 줄'}
        portal_db.upsert_notice_detail(
            detail,
            [{'filename': 'guide.pdf', 'url': 'https://sp.ritsumei.ac.jp/file/guide.pdf'}],
            self.synced_at,
            self.path,
        )
        stored = portal_db.get_notice('I-0000000001', self.path)
        self.assertIsNotNone(stored)
        self.assertEqual(stored['body'], '본문\n두 번째 줄')
        self.assertEqual(stored['attachments'][0]['filename'], 'guide.pdf')
        self.assertEqual(portal_db.notice_ids_needing_detail(['I-0000000001'], self.path), set())

        cleared_deadline = {**self.summary, 'deadline': ''}
        portal_db.upsert_notice_summary(cleared_deadline, '2026-09-18T14:30:00Z', self.path)
        cleared = portal_db.get_notice('I-0000000001', self.path)
        self.assertEqual(cleared['deadline'], '')

        updated_summary = {**self.summary, 'title': '갱신된 제목', 'body': ''}
        portal_db.upsert_notice_summary(updated_summary, '2026-09-18T15:00:00Z', self.path)
        stored_again = portal_db.get_notice('I-0000000001', self.path)
        self.assertEqual(stored_again['title'], '갱신된 제목')
        self.assertEqual(stored_again['body'], '본문\n두 번째 줄')

    def test_sync_state_and_type_counts(self):
        portal_db.upsert_notice_summary(self.summary, self.synced_at, self.path)
        portal_db.upsert_notice_summary({**self.summary, 'notice_id': 'I-0000000002', 'type': 'DM'}, self.synced_at, self.path)
        portal_db.begin_sync(self.path)
        portal_db.finish_sync(
            self.synced_at,
            total_count=2,
            new_count=2,
            updated_count=3,
            detail_failed_count=0,
            path=self.path,
        )
        status = portal_db.sync_status(self.path)
        self.assertEqual(status['status'], 'completed')
        self.assertEqual(status['storedCount'], 2)
        self.assertEqual(status['counts'], {'ALL': 1, 'DM': 1})
        self.assertEqual(status['updatedCount'], 3)

    def test_interrupted_sync_state_can_be_recovered(self):
        portal_db.begin_sync(self.path)
        running = portal_db.sync_status(self.path)
        self.assertEqual(running['status'], 'running')

        self.assertTrue(portal_db.recover_interrupted_sync(self.path))
        recovered = portal_db.sync_status(self.path)
        self.assertEqual(recovered['status'], 'failed')
        self.assertEqual(recovered['lastErrorCode'], portal_db.SYNC_INTERRUPTED_CODE)
        self.assertFalse(portal_db.recover_interrupted_sync(self.path))

    def test_hashes_detect_detail_and_summary_changes(self):
        first = portal_db.upsert_notice_summary(self.summary, self.synced_at, self.path)
        self.assertFalse(first.changed)
        detail = {**self.summary, 'body': '본문\n두 번째 줄'}
        first_detail = portal_db.upsert_notice_detail(detail, [], self.synced_at, self.path)
        self.assertFalse(first_detail.changed)

        same_detail = portal_db.upsert_notice_detail(detail, [], '2026-09-18T14:01:00Z', self.path)
        self.assertFalse(same_detail.changed)
        # Detail labels may be formatted differently from the list JSON. The
        # list hash must remain the canonical summary baseline.
        portal_db.upsert_notice_detail(
            {**detail, 'title': '詳細ページ側のタイトル表記', 'department': '詳細ページ側の担当部課'},
            [],
            '2026-09-18T14:01:30Z',
            self.path,
        )
        self.assertFalse(
            portal_db.upsert_notice_summary(self.summary, '2026-09-18T14:01:45Z', self.path).changed
        )
        changed_detail = portal_db.upsert_notice_detail(
            {**detail, 'body': '본문\n수정된 두 번째 줄'},
            [],
            '2026-09-18T14:02:00Z',
            self.path,
        )
        self.assertTrue(changed_detail.changed)
        stored = portal_db.get_notice(self.summary['notice_id'], self.path)
        self.assertEqual(stored['changeCount'], 1)
        self.assertEqual(stored['lastChangedAt'], '2026-09-18T14:02:00Z')
        self.assertEqual(
            portal_db.notice_ids_needing_detail(
                [self.summary['notice_id']],
                self.path,
                refresh_before='2026-09-18T14:03:00Z',
            ),
            {'I-0000000001'},
        )

        changed_summary = portal_db.upsert_notice_summary(
            {**self.summary, 'title': '제목 수정'},
            '2026-09-18T14:04:00Z',
            self.path,
        )
        self.assertTrue(changed_summary.changed)
        self.assertEqual(portal_db.notice_ids_needing_detail([self.summary['notice_id']], self.path), {'I-0000000001'})

    def test_user_state_survives_notice_upserts_and_departments_are_aggregated(self):
        portal_db.upsert_notice_summary(self.summary, self.synced_at, self.path)
        portal_db.upsert_notice_summary(
            {**self.summary, 'notice_id': 'I-0000000002', 'type': 'DM', 'department': '教学推進課'},
            self.synced_at,
            self.path,
        )
        initial = portal_db.get_notice('I-0000000001', self.path)
        self.assertFalse(initial['isRead'])
        self.assertFalse(initial['isImportant'])
        self.assertFalse(initial['isArchived'])
        self.assertEqual(initial['firstSeenAt'], self.synced_at)
        self.assertIsNone(initial['readAt'])

        updated = portal_db.update_notice_state(
            'I-0000000001',
            is_read=True,
            is_important=True,
            path=self.path,
        )
        self.assertTrue(updated['isRead'])
        self.assertTrue(updated['isImportant'])
        self.assertIsNotNone(updated['readAt'])
        self.assertFalse(updated['isArchived'])

        portal_db.upsert_notice_summary(
            {**self.summary, 'title': '갱신된 제목', 'department': '새 담당부서'},
            '2026-09-18T15:00:00Z',
            self.path,
        )
        preserved = portal_db.get_notice('I-0000000001', self.path)
        self.assertEqual(preserved['title'], '갱신된 제목')
        self.assertTrue(preserved['isRead'])
        self.assertTrue(preserved['isImportant'])

        portal_db.update_notice_state('I-0000000001', is_archived=True, path=self.path)
        filtered = portal_db.list_notices(self.path, department='새 담당부서')
        self.assertEqual([item['noticeId'] for item in filtered], ['I-0000000001'])
        departments = portal_db.notice_departments(self.path)
        department_map = {item['value']: item for item in departments}
        self.assertEqual(department_map['새 담당부서']['count'], 1)
        self.assertEqual(department_map['教学推進課']['counts']['DM'], 1)


class PortalProfileTests(unittest.TestCase):
    def test_default_profile_uses_local_app_data(self):
        with tempfile.TemporaryDirectory() as temp:
            with patch.dict(
                os.environ,
                {'LOCALAPPDATA': temp, 'RITSUMEI_BROWSER_PROFILE_DIR': ''},
                clear=False,
            ):
                expected = Path(temp) / 'MasterThesisOSWallpaper' / 'data' / 'ritsumei-browser-profile'
                self.assertEqual(resolve_profile_path(), expected.resolve())

    def test_profile_override_wins_over_local_app_data(self):
        with tempfile.TemporaryDirectory() as temp:
            override = Path(temp) / 'dedicated-profile'
            with patch.dict(
                os.environ,
                {
                    'LOCALAPPDATA': str(Path(temp) / 'app-data'),
                    'RITSUMEI_BROWSER_PROFILE_DIR': str(override),
                },
                clear=False,
            ):
                self.assertEqual(resolve_profile_path(), override.resolve())

    def test_chrome_is_default_and_bundled_chromium_is_explicit(self):
        with patch.dict(os.environ, {'RITSUMEI_BROWSER_CHANNEL': ''}, clear=False):
            self.assertEqual(browser_channel(), 'chrome')
        with patch.dict(os.environ, {'RITSUMEI_BROWSER_CHANNEL': 'chromium'}, clear=False):
            self.assertIsNone(browser_channel())

    def test_profile_state_only_checks_browser_cookie_database(self):
        with tempfile.TemporaryDirectory() as temp:
            profile = Path(temp) / 'profile'
            self.assertEqual(profile_session_state(profile), 'login_required')
            (profile / 'Default' / 'Network').mkdir(parents=True)
            (profile / 'Default' / 'Network' / 'Cookies').write_bytes(b'')
            self.assertEqual(profile_session_state(profile), 'saved')


class PortalSyncLoginTests(unittest.TestCase):
    def test_sync_reports_expired_session_without_opening_login_window(self):
        class FakeClient:
            login_called = False

            def list_notices(self):
                raise PortalError('session_expired', 'expired')

            def login(self, **kwargs):
                self.login_called = True
                raise AssertionError('sync must not open a headed login window')

        with tempfile.TemporaryDirectory() as temp:
            db_path = Path(temp) / 'portal-notices.db'
            fake_client = FakeClient()
            with patch.object(portal_cli, 'PortalClient', return_value=fake_client):
                with self.assertRaises(PortalError) as raised:
                    portal_cli.sync_portal(db_path=db_path, login_wait_seconds=1)
            self.assertEqual(raised.exception.code, 'session_expired')
            self.assertFalse(fake_client.login_called)
            self.assertEqual(portal_db.sync_status(db_path)['lastErrorCode'], 'session_expired')

    def test_keyboard_interrupt_marks_sync_as_interrupted(self):
        class FakeClient:
            def list_notices(self):
                raise KeyboardInterrupt

        with tempfile.TemporaryDirectory() as temp:
            db_path = Path(temp) / 'portal-notices.db'
            with patch.object(portal_cli, 'PortalClient', return_value=FakeClient()):
                with self.assertRaises(KeyboardInterrupt):
                    portal_cli.sync_portal(db_path=db_path, login_wait_seconds=1)
            status = portal_db.sync_status(db_path)
            self.assertEqual(status['status'], 'failed')
            self.assertEqual(status['lastErrorCode'], portal_db.SYNC_INTERRUPTED_CODE)


class PortalSyncOrchestrationTests(unittest.TestCase):
    def test_new_details_are_fetched_once_and_history_is_not_deleted(self):
        summaries = [
            NoticeSummary(
                notice_id='I-ALL-1',
                record_id='a0ef-all-1',
                notice_type='ALL',
                title='전체 공지',
                department='学生オフィス',
                published_at='2026-09-18T09:00:00Z',
                expires_at='',
                deadline='',
                importance='',
                category='その他',
                source_url='https://sp.ritsumei.ac.jp/studentportal/s/r-information/a0ef-all-1/view',
            ),
            NoticeSummary(
                notice_id='I-DM-1',
                record_id='a0ef-dm-1',
                notice_type='DM',
                title='個人 공지',
                department='経済学部事務室',
                published_at='2026-09-17T09:00:00Z',
                expires_at='',
                deadline='2026/09/30',
                importance='重要',
                category='履修',
                source_url='https://sp.ritsumei.ac.jp/studentportal/s/r-information/a0ef-dm-1/view',
            ),
        ]

        class FakeClient:
            def __init__(self):
                self.current = list(summaries)
                self.detail_calls = []

            def list_notices(self):
                return list(self.current)

            def iter_notice_details(self, targets):
                target_list = list(targets)
                self.detail_calls.append([summary.notice_id for summary in target_list])
                for summary in target_list:
                    yield summary, {
                        **summary.to_db(),
                        'body': f'본문: {summary.notice_id}',
                        'attachments': [],
                    }, None

        with tempfile.TemporaryDirectory() as temp:
            db_path = Path(temp) / 'portal-notices.db'
            fake_client = FakeClient()
            with patch.object(portal_cli, 'PortalClient', return_value=fake_client):
                first = portal_cli.sync_portal(db_path=db_path)
                self.assertEqual(first['newCount'], 2)
                self.assertEqual(fake_client.detail_calls, [['I-ALL-1', 'I-DM-1']])

                fake_client.current = [summaries[0]]
                second = portal_cli.sync_portal(db_path=db_path)

            self.assertEqual(second['newCount'], 0)
            self.assertEqual(fake_client.detail_calls, [['I-ALL-1', 'I-DM-1']])
            status = portal_db.sync_status(db_path)
            self.assertEqual(status['storedCount'], 2)
            self.assertEqual(status['counts'], {'ALL': 1, 'DM': 1})
            self.assertIsNotNone(portal_db.get_notice('I-DM-1', db_path))

    def test_periodic_detail_refresh_detects_body_change(self):
        summary = NoticeSummary(
            notice_id='I-REFRESH-1',
            record_id='a0ef-refresh-1',
            notice_type='ALL',
            title='주기 재검증 공지',
            department='学生オフィス',
            published_at='2026-09-18T09:00:00Z',
            expires_at='',
            deadline='',
            importance='',
            category='その他',
            source_url='https://sp.ritsumei.ac.jp/studentportal/s/r-information/a0ef-refresh-1/view',
        )

        class FakeClient:
            version = 1
            detail_calls = 0

            def list_notices(self):
                return [summary]

            def iter_notice_details(self, targets):
                for item in targets:
                    self.detail_calls += 1
                    yield item, {
                        **item.to_db(),
                        'body': f'본문 버전 {self.version}',
                        'attachments': [],
                    }, None

        with tempfile.TemporaryDirectory() as temp:
            db_path = Path(temp) / 'portal-notices.db'
            fake_client = FakeClient()
            with patch.object(portal_cli, 'PortalClient', return_value=fake_client):
                first = portal_cli.sync_portal(db_path=db_path, detail_refresh_days=0)
                fake_client.version = 2
                second = portal_cli.sync_portal(db_path=db_path, detail_refresh_days=0)

            stored = portal_db.get_notice('I-REFRESH-1', db_path)
            self.assertEqual(first['updatedCount'], 0)
            self.assertEqual(second['newCount'], 0)
            self.assertEqual(second['updatedCount'], 1)
            self.assertEqual(second['detailCount'], 1)
            self.assertEqual(fake_client.detail_calls, 2)
            self.assertEqual(stored['body'], '본문 버전 2')
            self.assertEqual(stored['changeCount'], 1)
            self.assertEqual(portal_db.sync_status(db_path)['updatedCount'], 1)


if __name__ == '__main__':
    unittest.main()
