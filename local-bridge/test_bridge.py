import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from bridge_security import (
    PRODUCTION_ORIGIN,
    allows_private_network,
    safe_folder_target,
    safe_directory,
    safe_path,
    target_for_endpoint,
    token_matches,
    valid_origins,
)


class SafePathTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name).resolve()
        (self.root / 'wiki').mkdir()
        (self.root / 'wiki' / 'nested').mkdir()
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

    def test_accepts_master_or_nested_directory(self):
        self.assertEqual(safe_directory(self.root), self.root)
        self.assertEqual(safe_directory(self.root, 'wiki/nested'), self.root / 'wiki' / 'nested')

    def test_rejects_file_or_escape_as_directory(self):
        with self.assertRaises(ValueError):
            safe_directory(self.root, 'wiki/note.md')
        with self.assertRaises(ValueError):
            safe_directory(self.root, '../outside')

    def test_rejects_nonexistent_path(self):
        with self.assertRaises(FileNotFoundError):
            safe_path(self.root, 'wiki/missing.md')
        with self.assertRaises(FileNotFoundError):
            safe_folder_target(self.root, 'wiki/missing.md')

    def test_open_and_open_folder_dispatch_to_their_matching_target_types(self):
        self.assertEqual(target_for_endpoint(self.root, '/open', 'wiki/note.md'), self.root / 'wiki' / 'note.md')
        self.assertEqual(target_for_endpoint(self.root, '/open-folder', 'wiki'), self.root / 'wiki')
        self.assertEqual(target_for_endpoint(self.root, '/open-folder', 'wiki/note.md'), self.root / 'wiki')
        with self.assertRaises(ValueError):
            target_for_endpoint(self.root, '/open', 'wiki')

    def test_rejects_unknown_endpoint_without_launching(self):
        with self.assertRaises(ValueError):
            target_for_endpoint(self.root, '/not-an-endpoint', 'wiki')


class BridgeConfigurationTests(unittest.TestCase):
    def test_accepts_exact_production_and_explicit_local_origins(self):
        self.assertTrue(valid_origins({PRODUCTION_ORIGIN, 'http://localhost:3000', 'http://127.0.0.1:3001'}))

    def test_rejects_missing_or_malformed_origins(self):
        self.assertFalse(valid_origins({PRODUCTION_ORIGIN}))
        self.assertFalse(valid_origins({'http://localhost:3000'}))
        self.assertFalse(valid_origins({PRODUCTION_ORIGIN, 'http://localhost'}))
        self.assertFalse(valid_origins({PRODUCTION_ORIGIN, 'http://localhost:3000/path'}))
        self.assertFalse(valid_origins({PRODUCTION_ORIGIN, 'http://localhost:3000@evil.example'}))
        self.assertFalse(valid_origins({PRODUCTION_ORIGIN, 'https://localhost:3000'}))
        self.assertFalse(valid_origins({PRODUCTION_ORIGIN, 'https://unknown.example:3000'}))

    def test_token_authentication_uses_constant_time_comparison(self):
        with patch('bridge_security.hmac.compare_digest', return_value=True) as compare:
            self.assertTrue(token_matches('candidate', 'expected-token'))
        compare.assert_called_once_with('candidate', 'expected-token')
        self.assertTrue(token_matches('same-token', 'same-token'))
        self.assertFalse(token_matches('wrong-token', 'same-token'))

    def test_private_network_header_is_opt_in_only(self):
        self.assertTrue(allows_private_network('true'))
        self.assertTrue(allows_private_network('TRUE'))
        self.assertFalse(allows_private_network('false'))
        self.assertFalse(allows_private_network(''))


if __name__ == '__main__':
    unittest.main()
