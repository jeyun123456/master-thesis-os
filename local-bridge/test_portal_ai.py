import unittest
from datetime import datetime
from unittest.mock import patch

import portal_ai


class PortalAIAnalysisTests(unittest.TestCase):
    def test_normalizes_provider_result_and_generates_deterministic_candidates(self):
        provider_result = {
            'summary': '공지 핵심 요약',
            'translation': '한국어 번역',
            'calendarCandidates': [
                {
                    'title': '지난 행사',
                    'start': '2026-09-17',
                    'end': None,
                    'allDay': True,
                    'type': 'event',
                    'reason': '이미 지난 날짜',
                },
                {
                    'title': '설명회',
                    'start': '2099-09-20',
                    'end': None,
                    'allDay': True,
                    'type': 'event',
                    'reason': '참석 일정',
                },
                {
                    'title': '잘못된 날짜',
                    'start': 'not-a-date',
                    'end': None,
                    'allDay': True,
                    'type': 'deadline',
                    'reason': '제외해야 함',
                },
            ],
        }
        notice = {'notice_id': 'I-AI-1', 'type': 'ALL', 'title': '공지', 'body': '일정 본문'}
        with patch.object(portal_ai, '_request_provider', return_value=provider_result):
            first = portal_ai.analyze_notice(notice, datetime(2026, 9, 18, tzinfo=portal_ai.SEOUL))
            second = portal_ai.analyze_notice(notice, datetime(2026, 9, 18, tzinfo=portal_ai.SEOUL))

        self.assertEqual(first['summary'], '공지 핵심 요약')
        self.assertEqual(first['translation'], '한국어 번역')
        self.assertEqual(len(first['calendarCandidates']), 1)
        self.assertEqual(first['calendarCandidates'][0]['title'], '설명회')
        self.assertEqual(first['calendarCandidates'][0]['id'], second['calendarCandidates'][0]['id'])
        self.assertTrue(first['calendarCandidates'][0]['id'].startswith('portal-calendar:'))

    def test_requires_stored_notice_body(self):
        with self.assertRaises(portal_ai.PortalAIError) as raised:
            portal_ai.analyze_notice({'notice_id': 'I-AI-2', 'body': ''})
        self.assertEqual(raised.exception.code, 'ai_body_missing')

    def test_rejects_unstructured_provider_result(self):
        with patch.object(portal_ai, '_request_provider', return_value={'summary': '요약'}):
            with self.assertRaises(portal_ai.PortalAIError) as raised:
                portal_ai.analyze_notice({'notice_id': 'I-AI-3', 'body': '본문'})
        self.assertEqual(raised.exception.code, 'ai_response_invalid')


class InboxAIOrganizationTests(unittest.TestCase):
    def test_preserves_explicit_date_and_drops_invented_dates_and_non_todo_actions(self):
        entries = [
            {'id': 'todo-1', 'rawText': '교수님께 결과 보내야 함. 마감 2026년 10월 2일'},
            {'id': 'idea-1', 'rawText': '인터랙티브 그래프 넣으면 좋을 듯'},
        ]
        provider_result = {
            'results': [
                {
                    'entryId': 'todo-1',
                    'category': 'Todo',
                    'title': '교수님께 결과 보내기',
                    'summary': '결과를 교수님께 전달한다.',
                    'nextAction': '결과 파일을 확인해 교수님께 보낸다.',
                    'dueDate': '2026-10-02',
                    'relatedEntryIds': ['idea-1', 'unknown'],
                },
                {
                    'entryId': 'idea-1',
                    'category': 'Idea',
                    'title': '인터랙티브 그래프 아이디어',
                    'summary': '분석 결과에 상호작용 그래프를 추가하는 구상이다.',
                    'nextAction': 'AI가 잘못 생성한 행동',
                    'dueDate': '2026-10-05',
                    'relatedEntryIds': ['todo-1', 'idea-1'],
                },
            ],
        }
        with patch.object(portal_ai, '_request_inbox_provider', return_value=provider_result):
            result = portal_ai.organize_inbox_entries(entries)

        self.assertEqual(result[0]['dueDate'], '2026-10-02')
        self.assertEqual(result[0]['relatedEntryIds'], ['idea-1'])
        self.assertEqual(result[1]['dueDate'], None)
        self.assertEqual(result[1]['nextAction'], '')
        self.assertEqual(result[1]['relatedEntryIds'], ['todo-1'])

    def test_rejects_missing_or_oversized_inbox_entries(self):
        with self.assertRaises(portal_ai.PortalAIError) as raised:
            portal_ai.organize_inbox_entries([])
        self.assertEqual(raised.exception.code, 'inbox_entries_invalid')

        with self.assertRaises(portal_ai.PortalAIError) as raised:
            portal_ai.organize_inbox_entries([{'id': 'long', 'rawText': '가' * 1_201}])
        self.assertEqual(raised.exception.code, 'inbox_entries_invalid')

    def test_rejects_provider_results_that_omit_an_entry(self):
        entries = [{'id': 'one', 'rawText': '연구 결과를 다시 확인'}]
        with patch.object(portal_ai, '_request_inbox_provider', return_value={'results': []}):
            with self.assertRaises(portal_ai.PortalAIError) as raised:
                portal_ai.organize_inbox_entries(entries)
        self.assertEqual(raised.exception.code, 'ai_response_invalid')


if __name__ == '__main__':
    unittest.main()
