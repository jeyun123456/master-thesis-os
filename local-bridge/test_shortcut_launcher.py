import tempfile
import unittest
from pathlib import Path

from shortcut_launcher import normalize_shortcut_request


class ShortcutLauncherValidationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name).resolve()
        self.file = self.root / 'tool.exe'
        self.file.write_text('x', encoding='utf-8')
        self.folder = self.root / 'workspace'
        self.folder.mkdir()

    def tearDown(self):
        self.temp.cleanup()

    def test_accepts_absolute_app_file_and_folder_targets(self):
        app = normalize_shortcut_request({'type': 'app', 'target': str(self.file), 'args': '--test'})
        file_item = normalize_shortcut_request({'type': 'file', 'target': str(self.file)})
        folder = normalize_shortcut_request({'type': 'folder', 'target': str(self.folder)})
        self.assertEqual(app['target'], str(self.file))
        self.assertEqual(app['args'], '--test')
        self.assertEqual(file_item['type'], 'file')
        self.assertEqual(folder['target'], str(self.folder))

    def test_accepts_command_and_existing_working_directory(self):
        item = normalize_shortcut_request({
            'type': 'command',
            'target': 'npm run dev',
            'workingDirectory': str(self.folder),
            'runAsAdmin': True,
        })
        self.assertEqual(item['target'], 'npm run dev')
        self.assertEqual(item['workingDirectory'], str(self.folder))
        self.assertTrue(item['runAsAdmin'])

    def test_rejects_relative_or_missing_local_targets(self):
        with self.assertRaises(ValueError):
            normalize_shortcut_request({'type': 'app', 'target': 'tool.exe'})
        with self.assertRaises(FileNotFoundError):
            normalize_shortcut_request({'type': 'file', 'target': str(self.root / 'missing.txt')})

    def test_rejects_unknown_type_and_invalid_working_directory(self):
        with self.assertRaises(ValueError):
            normalize_shortcut_request({'type': 'other', 'target': 'x'})
        with self.assertRaises(ValueError):
            normalize_shortcut_request({'type': 'command', 'target': 'echo ok', 'workingDirectory': str(self.file)})


if __name__ == '__main__':
    unittest.main()
