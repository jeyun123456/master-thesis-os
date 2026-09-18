import tempfile
import unittest
from dataclasses import dataclass
from pathlib import Path
from unittest.mock import patch

import mail_cli
import mail_db
from thunderbird_mail import ThunderbirdSettings


@dataclass(frozen=True)
class FakeMail:
    id: str
    subject: str
    sender_name: str = '발신자'
    sender_address: str = 'sender@example.edu'
    received_at: str = '2026-09-18T01:00:00Z'
    is_read: bool = False
    message_id: str | None = None


class MailAnalysisPersistenceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp.name) / 'mail-analysis.db'
        self.settings = ThunderbirdSettings(profile_path='unused', account='school@example.edu')
        self.school_items = [FakeMail('school-1', '발표 안내', message_id='<school-1@example.edu>')]
        self.office_items = [FakeMail('office-1', '제출 마감', message_id='<office-1@example.edu>')]

    def tearDown(self):
        self.temp.cleanup()

    def recent_mail(self, _settings, _limit, folder):
        return 'sc***@example.edu', self.school_items if folder == 'school-work' else self.office_items

    def message(self, _settings, mail_id, _folder):
        item = next(item for item in self.school_items + self.office_items if item.id == mail_id)
        return 'sc***@example.edu', type('Message', (), {'item': item, 'body': f'{item.subject} 일정은 2099-09-20에 진행한다.'})()

    def test_sync_collects_both_folders_and_does_not_duplicate_on_resync(self):
        provider = {
            'summary': '메일 핵심 내용이다. 확인이 필요하다.',
            'action': '일정과 제출물을 확인한다.',
            'calendarCandidates': [{
                'title': '확인 일정',
                'start': '2099-09-20',
                'end': None,
                'allDay': True,
                'type': 'event',
                'reason': '실제 일정',
            }],
        }
        with patch('mail_cli.get_recent_mail', side_effect=self.recent_mail) as recent, \
             patch('mail_cli.get_mail_message', side_effect=self.message), \
             patch('mail_cli._request_provider', return_value=provider) as request:
            first = mail_cli.sync_mail(self.settings, self.db_path)
            second = mail_cli.sync_mail(self.settings, self.db_path)

        self.assertEqual(recent.call_count, 4)
        self.assertEqual(first['newCount'], 2)
        self.assertEqual(second['newCount'], 0)
        self.assertEqual(first['analysisCompleted'], 2)
        self.assertEqual(second['analysisCompleted'], 0)
        self.assertEqual(request.call_count, 2)
        rows = mail_db.list_analysis(self.db_path)
        self.assertEqual(len(rows), 2)
        self.assertEqual({row['folder'] for row in rows}, {'school-work', 'international-office'})
        self.assertTrue(all(row['analysis']['status'] == 'completed' for row in rows))
        self.assertEqual(len(rows[0]['candidates']), 1)

    def test_message_id_and_deterministic_fallback_prevent_duplicates(self):
        first = FakeMail('source-1', '같은 메일', message_id='<same@example.edu>')
        second = FakeMail('source-2', '같은 메일 수정본', message_id='<same@example.edu>')
        result_one = mail_db.upsert_mail(first, 'school-work', 'body', '2026-09-18T00:00:00Z', self.db_path)
        result_two = mail_db.upsert_mail(second, 'international-office', 'new body', '2026-09-18T00:01:00Z', self.db_path)
        self.assertTrue(result_one.inserted)
        self.assertFalse(result_two.inserted)
        self.assertEqual(result_one.mail_id, result_two.mail_id)

        no_id = FakeMail('', 'fallback', sender_address='fallback@example.edu', received_at='2026-09-18T02:00:00Z', message_id=None)
        fallback_one = mail_db.upsert_mail(no_id, 'school-work', '', '2026-09-18T00:02:00Z', self.db_path)
        fallback_two = mail_db.upsert_mail(no_id, 'school-work', '', '2026-09-18T00:03:00Z', self.db_path)
        self.assertTrue(fallback_one.inserted)
        self.assertFalse(fallback_two.inserted)
        self.assertEqual(fallback_one.mail_id, fallback_two.mail_id)
        self.assertEqual(mail_db.stored_mail_count(self.db_path), 2)

    def test_ai_failure_is_persisted_and_reanalysis_can_complete(self):
        item = self.school_items[0]
        mail_db.upsert_mail(item, 'school-work', '발표 일정 본문', '2026-09-18T00:00:00Z', self.db_path)
        with patch('mail_cli._request_provider', side_effect=mail_cli.MailAnalysisError('provider down')):
            failed = mail_cli.analyze_new(self.settings, self.db_path)
        self.assertEqual(failed['failed'], 1)
        failed_row = mail_db.get_analysis(self.db_path, item.id)
        self.assertIsNotNone(failed_row)
        self.assertEqual(failed_row['analysis']['status'], 'failed')
        self.assertIn('provider down', failed_row['analysis']['error'])

        provider = {
            'summary': '재분석한 요약이다.',
            'action': None,
            'calendarCandidates': [{
                'title': '재분석 일정',
                'start': '2099-09-21',
                'end': None,
                'allDay': True,
                'type': 'deadline',
                'reason': '제출 마감',
            }],
        }
        with patch('mail_cli._request_provider', return_value=provider):
            result = mail_cli.reanalyze_mail(item.id, self.settings, self.db_path)
        self.assertEqual(result['completed'], 1)
        row = mail_db.get_analysis(self.db_path, item.id)
        self.assertEqual(row['analysis']['status'], 'completed')
        candidate = row['candidates'][0]
        updated = mail_db.update_candidate(item.id, candidate['id'], 'ignored', title=candidate['title'], start=candidate['start'], end=candidate['end'], all_day=candidate['allDay'], path=self.db_path)
        self.assertEqual(updated['status'], 'ignored')
        self.assertEqual(mail_db.get_analysis(self.db_path, item.id)['candidates'][0]['status'], 'ignored')

    def test_database_survives_close_and_reopen(self):
        item = self.school_items[0]
        mail_db.upsert_mail(item, 'school-work', 'persisted body', '2026-09-18T00:00:00Z', self.db_path)
        mail_db.initialize_database(self.db_path)
        reopened = mail_db.get_mail_for_processing(self.db_path, item.id)
        self.assertEqual(reopened['body'], 'persisted body')
        self.assertEqual(reopened['analysis_status'], 'queued')

    def test_codex_cli_provider_uses_luna_model_and_reads_json_output(self):
        provider = {
            'summary': 'Codex Luna가 반환한 한국어 요약이다.',
            'action': None,
            'calendarCandidates': [],
        }

        def run_codex(command, **kwargs):
            output_path = Path(command[command.index('--output-last-message') + 1])
            output_path.write_text(mail_cli.json.dumps(provider, ensure_ascii=False), encoding='utf-8')
            return mail_cli.subprocess.CompletedProcess(command, 0, '', '')

        with patch.dict('os.environ', {'MAIL_AI_PROVIDER': 'codex-cli', 'MAIL_AI_MODEL': 'gpt-5.6-luna'}), \
             patch('mail_cli._codex_executable', return_value='codex.exe'), \
             patch('mail_cli.subprocess.run', side_effect=run_codex) as run:
            result = mail_cli._request_provider({'subject': '테스트', 'body': '본문'})

        self.assertEqual(result, provider)
        command = run.call_args.args[0]
        self.assertIn('gpt-5.6-luna', command)
        self.assertIn('--ephemeral', command)


if __name__ == '__main__':
    unittest.main()
