import tempfile
import unittest
from pathlib import Path

from bridge_security import safe_path


class SafePathTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name).resolve()
        (self.root / 'wiki').mkdir()
        (self.root / 'wiki' / 'note.md').write_text('ok', encoding='utf-8')

    def tearDown(self):
        self.temp.cleanup()

    def test_accepts_file_inside_master_path(self):
        self.assertEqual(safe_path(self.root, 'wiki/note.md'), self.root / 'wiki' / 'note.md')

    def test_rejects_parent_traversal(self):
        with self.assertRaises(ValueError):
            safe_path(self.root, '../outside.txt')

    def test_rejects_directory(self):
        with self.assertRaises(ValueError):
            safe_path(self.root, 'wiki')


if __name__ == '__main__':
    unittest.main()
