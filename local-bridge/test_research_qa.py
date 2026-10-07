import unittest

import research_qa


class ResearchQARequestValidationTests(unittest.TestCase):
    def test_model_mode_defaults_to_luna_and_rejects_unknown_modes(self):
        self.assertEqual(research_qa.model_for_mode(None), research_qa.LUNA_MODEL)
        self.assertEqual(research_qa.model_for_mode(' SOL '), research_qa.SOL_MODEL)
        with self.assertRaises(research_qa.ResearchQAError) as caught:
            research_qa.model_for_mode('other')
        self.assertEqual(caught.exception.code, 'research_qa_invalid')

    def test_question_length_and_sources_are_required(self):
        source = {'sourceId': 'S1', 'name': '자료', 'snippets': ['근거 문장']}
        for body in (
            {'question': '', 'sources': [source]},
            {'question': 'x', 'sources': [source]},
            {'question': 'x' * (research_qa.MAX_QUESTION_CHARS + 1), 'sources': [source]},
            {'question': '질문입니다', 'sources': []},
            {'question': '질문입니다', 'sources': 'not-a-list'},
            {'question': '질문입니다', 'sources': ['not-a-mapping']},
        ):
            with self.assertRaises(research_qa.ResearchQAError) as caught:
                research_qa.normalize_request(body)
            self.assertEqual(caught.exception.code, 'research_qa_invalid', body)

    def test_evidence_is_bounded_and_marked_indexed_only_without_snippets(self):
        sources = [{'sourceId': f'S{i}', 'name': f'자료 {i}', 'snippets': ['가' * 5000] * 6} for i in range(12)]
        sources.append({'name': '본문 없음'})
        question, model, normalized = research_qa.normalize_request({'question': '  질문입니다  ', 'sources': sources})
        self.assertEqual(question, '질문입니다')
        self.assertEqual(model, research_qa.LUNA_MODEL)
        self.assertLessEqual(len(normalized), research_qa.MAX_SOURCES)
        total = sum(len(snippet) for item in normalized for snippet in item['snippets'])
        self.assertLessEqual(total, research_qa.MAX_TOTAL_EVIDENCE_CHARS)
        self.assertTrue(all(len(snippet) <= research_qa.MAX_SNIPPET_CHARS for item in normalized for snippet in item['snippets']))
        only = research_qa.normalize_request({'question': '질문입니다', 'sources': [{'name': '본문 없음'}]})[2]
        self.assertTrue(only[0]['indexedOnly'])


if __name__ == '__main__':
    unittest.main()
