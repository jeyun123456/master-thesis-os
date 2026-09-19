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


if __name__ == '__main__':
    unittest.main()
