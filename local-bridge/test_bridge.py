import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from bridge_config import DEFAULT_PORT, ConfigError, load_bridge_config, resolve_config_path
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
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name).resolve()
        self.config_path = self.root / 'config.json'

    def tearDown(self):
        self.temp.cleanup()

    def write_config(self, **overrides):
        config = {
            'master_path': str(self.root),
            'token': 't' * 40,
            'allowed_origins': [PRODUCTION_ORIGIN, 'http://localhost:3000'],
        }
        config.update(overrides)
        self.config_path.write_text(json.dumps(config), encoding='utf-8')

    def test_loader_accepts_custom_port(self):
        self.write_config(port=38472)
        loaded = load_bridge_config(self.config_path)
        self.assertEqual(loaded.port, 38472)

    def test_loader_uses_default_port_when_omitted(self):
        self.write_config()
        loaded = load_bridge_config(self.config_path)
        self.assertEqual(loaded.port, DEFAULT_PORT)

    def test_config_path_prefers_explicit_override(self):
        override = self.root / 'override.json'
        with patch.dict(os.environ, {'MTO_BRIDGE_CONFIG': f'  {override}  '}, clear=False):
            self.assertEqual(resolve_config_path(self.root / 'local-bridge'), override)

    def test_config_path_prefers_shared_app_data_when_present(self):
        shared = self.root / 'MasterThesisOSWallpaper' / 'bridge' / 'config.json'
        shared.parent.mkdir(parents=True)
        shared.write_text('{}', encoding='utf-8')
        with patch.dict(
            os.environ,
            {'LOCALAPPDATA': str(self.root), 'MTO_BRIDGE_CONFIG': ''},
            clear=False,
        ):
            self.assertEqual(resolve_config_path(self.root / 'local-bridge'), shared)

    def test_invalid_shared_config_remains_authoritative(self):
        shared = self.root / 'MasterThesisOSWallpaper' / 'bridge' / 'config.json'
        shared.parent.mkdir(parents=True)
        shared.write_text('{', encoding='utf-8')
        local_directory = self.root / 'local-bridge'
        local_directory.mkdir()
        local_path = local_directory / 'config.json'
        local_path.write_text(json.dumps({'token': 'l' * 40}), encoding='utf-8')

        with patch.dict(
            os.environ,
            {'LOCALAPPDATA': str(self.root), 'MTO_BRIDGE_CONFIG': ''},
            clear=False,
        ):
            self.assertEqual(resolve_config_path(local_directory), shared)
            with self.assertRaises(ConfigError):
                load_bridge_config(resolve_config_path(local_directory))

    def test_loader_preserves_token_value_without_trimming(self):
        token = f" {'t' * 40} "
        self.write_config(token=token)
        loaded = load_bridge_config(self.config_path)
        self.assertEqual(loaded.token, token)

    def test_loader_rejects_whitespace_only_token(self):
        self.write_config(token=' ' * 40)
        with self.assertRaises(ConfigError):
            load_bridge_config(self.config_path)

    def test_config_path_falls_back_to_local_bridge_directory(self):
        local_directory = self.root / 'local-bridge'
        local_directory.mkdir()
        local_path = local_directory / 'config.json'
        local_path.write_text('{}', encoding='utf-8')
        with patch.dict(
            os.environ,
            {'LOCALAPPDATA': str(self.root / 'missing-app-data'), 'MTO_BRIDGE_CONFIG': ''},
            clear=False,
        ):
            self.assertEqual(resolve_config_path(local_directory), local_path)

    def test_loader_rejects_invalid_ports(self):
        for invalid_port in (1023, 65536, 'not-a-port', True, 38472.5):
            with self.subTest(port=invalid_port):
                self.write_config(port=invalid_port)
                with self.assertRaises(ConfigError):
                    load_bridge_config(self.config_path)

    def test_loader_rejects_malformed_or_invalid_config(self):
        self.config_path.write_text('{', encoding='utf-8')
        with self.assertRaises(ConfigError):
            load_bridge_config(self.config_path)

        self.write_config(master_path=str(self.root / 'missing'))
        with self.assertRaises(ConfigError):
            load_bridge_config(self.config_path)

    def test_config_error_uses_non_restart_exit_code(self):
        from bridge_config import CONFIG_ERROR_EXIT_CODE

        self.assertEqual(CONFIG_ERROR_EXIT_CODE, 78)

    def test_bridge_process_exits_with_config_error_code(self):
        for module_name in ('bridge.py', 'bridge_config.py', 'bridge_security.py'):
            shutil.copy(Path(__file__).with_name(module_name), self.root / module_name)
        token_marker = 'token-marker-' + 's' * 40
        self.config_path.write_text(f'{{"token":"{token_marker}', encoding='utf-8')

        completed = subprocess.run(
            [sys.executable, str(self.root / 'bridge.py')],
            cwd=self.root,
            capture_output=True,
            text=True,
            env={**os.environ, 'MTO_BRIDGE_CONFIG': str(self.config_path)},
            check=False,
            timeout=5,
        )

        self.assertEqual(completed.returncode, 78)
        self.assertIn('Invalid config.json', completed.stderr)
        self.assertNotIn(token_marker, completed.stderr)

    def test_tray_health_url_uses_configured_port(self):
        tray_script = Path(__file__).with_name('start_bridge_tray.ps1').read_text(encoding='utf-8-sig')
        self.assertNotIn('127.0.0.1:38471/health', tray_script)
        self.assertIn('Get-BridgePort', tray_script)
        self.assertIn('http://127.0.0.1:{0}/health', tray_script)

    def test_runner_marks_config_exit_as_non_restartable(self):
        runner_script = Path(__file__).with_name('start_bridge.ps1').read_text(encoding='utf-8-sig')
        self.assertIn('$ConfigErrorExitCode = 78', runner_script)
        self.assertIn('if ($exitCode -eq $ConfigErrorExitCode)', runner_script)
        self.assertIn('exit $exitCode', runner_script)
        self.assertIn("$sharedConfigPath", runner_script)
        self.assertIn('$overrideConfigPath.Trim()', runner_script)

    def test_batch_launcher_delegates_config_resolution_to_runner(self):
        launcher = Path(__file__).with_name('start_bridge.bat').read_text(encoding='utf-8-sig')
        self.assertNotIn('if not exist "config.json"', launcher.lower())
        self.assertIn('start_bridge.ps1', launcher)

    def test_tray_does_not_surface_config_parser_details(self):
        tray_script = Path(__file__).with_name('start_bridge_tray.ps1').read_text(encoding='utf-8-sig')
        self.assertNotIn('$($_.Exception.Message)', tray_script)
        self.assertNotIn('Show-BridgeNotice $_.Exception.Message', tray_script)
        self.assertIn('$config -isnot [pscustomobject]', tray_script)
        self.assertIn("Where-Object { $_.Name -ceq $Name }", tray_script)
        self.assertIn("Get-ExactConfigProperty -Config $config -Name 'token'", tray_script)
        self.assertIn("$overrideConfigPath.Trim()", tray_script)

    def test_companion_token_reader_matches_bridge_token_contract(self):
        store = (
            Path(__file__).parents[1]
            / 'experiments'
            / 'wallpaper-host-poc'
            / 'BridgeConfigStore.cs'
        ).read_text(encoding='utf-8')
        self.assertIn('[JsonPropertyName("token")]', store)
        self.assertNotIn('PropertyNameCaseInsensitive = true', store)
        self.assertNotIn('config.Token.Trim()', store)
        self.assertIn('parsed.Token.Length < 32', store)
        self.assertIn('private const int DefaultPort = 38471', store)
        self.assertIn('var port = parsed.Port ?? DefaultPort', store)

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
