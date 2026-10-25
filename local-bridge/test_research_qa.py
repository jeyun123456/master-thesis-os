import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import research_qa


class ResearchQATests(unittest.TestCase):
    def test_model_routing(self):
        self.assertEqual(research_qa.model_for_mode('luna'), 'gpt-6-luna')
        self.assertEqual(research_qa.model_for_mode('sol'), 'gpt-6.1-sol')
        self.assertEqual(research_qa.model_for_mode(''), 'gpt-6-luna')
        with self.assertRaises(research_qa.ResearchQAError):
            research_qa.model_for_mode('unknown')

    def test_request_normalization_bounds_sources_and_marks_missing_snippets_index_only(self):
        question, model, sources = research_qa.normalize_request({
            'question': '전환 문제를 비교해줘',
            'mode': 'luna',
            'sources': [
                {'sourceId': 'S1', 'name': '문서 1', 'snippets': ['근거 문장'], 'indexedOnly': False},
                {'sourceId': 'S2', 'name': 'PDF 1', 'snippets': [], 'indexedOnly': False},
            ],
        })
        self.assertEqual(question, '전환 문제를 비교해줘')
        self.assertEqual(model, 'gpt-6-luna')
        self.assertFalse(sources[0]['indexedOnly'])
        self.assertTrue(sources[1]['indexedOnly'])

    def test_answer_uses_selected_codex_model_and_filters_unknown_source_ids(self):
        body = {
            'question': '이 자료의 논점을 설명해줘',
            'mode': 'sol',
            'sources': [
                {'sourceId': 'S1', 'name': '문서 1', 'snippets': ['논점 A'], 'indexedOnly': False},
            ],
        }

        class Completed:
            returncode = 0
            stdout = ''
            stderr = ''

        def fake_run(command, **kwargs):
            self.assertIn('gpt-6.1-sol', command)
            self.assertIn('논점 A', kwargs['input'])
            output_index = command.index('--output-last-message') + 1
            Path(command[output_index]).write_text(json.dumps({
                'answer': '논점 A가 핵심이다. [S1]',
                'sourceIds': ['S1', 'S999'],
                'insufficientEvidence': False,
            }, ensure_ascii=False), encoding='utf-8')
            return Completed()

        with patch('research_qa.mail_cli._codex_executable', return_value='codex'),              patch('research_qa.subprocess.run', side_effect=fake_run):
            result = research_qa.answer_research_question(body)

        self.assertEqual(result['model'], 'gpt-6.1-sol')
        self.assertEqual(result['mode'], 'sol')
        self.assertEqual(result['sourceIds'], ['S1'])
        self.assertFalse(result['insufficientEvidence'])


if __name__ == '__main__':
    unittest.main()
