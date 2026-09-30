import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
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
        self.assertEqual(loaded.thunderbird.account, '')
        self.assertEqual(loaded.thunderbird.profile_path, '')

    def test_loader_accepts_optional_thunderbird_settings(self):
        self.write_config(thunderbird={'account': 'school@example.edu', 'profile_path': 'C:\\profile'})
        loaded = load_bridge_config(self.config_path)
        self.assertEqual(loaded.thunderbird.account, 'school@example.edu')
        self.assertEqual(loaded.thunderbird.profile_path, 'C:\\profile')

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
        for module_name in ('bridge.py', 'bridge_config.py', 'bridge_security.py', 'thunderbird_mail.py'):
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

    def test_companion_runtime_packaging_includes_thunderbird_reader(self):
        manager = (
            Path(__file__).parents[1]
            / 'experiments'
            / 'wallpaper-host-poc'
            / 'BridgeProcessManager.cs'
        ).read_text(encoding='utf-8')
        publisher = (
            Path(__file__).parents[1]
            / 'experiments'
            / 'wallpaper-host-poc'
            / 'scripts'
            / 'Publish-Release.ps1'
        ).read_text(encoding='utf-8-sig')
        self.assertIn('"thunderbird_mail.py"', manager)
        self.assertIn("'thunderbird_mail.py'", publisher)
        self.assertIn('"mail_db.py"', manager)
        self.assertIn("'mail_db.py'", publisher)
        self.assertIn('"mail_cli.py"', manager)
        self.assertIn("'mail_cli.py'", publisher)

    def test_companion_runtime_packaging_includes_portal_reader(self):
        manager = (
            Path(__file__).parents[1]
            / 'experiments'
            / 'wallpaper-host-poc'
            / 'BridgeProcessManager.cs'
        ).read_text(encoding='utf-8')
        publisher = (
            Path(__file__).parents[1]
            / 'experiments'
            / 'wallpaper-host-poc'
            / 'scripts'
            / 'Publish-Release.ps1'
        ).read_text(encoding='utf-8-sig')
        for bridge_file in ('portal_db.py', 'portal_client.py', 'portal_cli.py', 'portal_ai.py'):
            with self.subTest(bridge_file=bridge_file):
                self.assertIn(f'"{bridge_file}"', manager)
                self.assertIn(f"'{bridge_file}'", publisher)

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


class InboxBridgeEndpointTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.root = Path(cls.temp.name).resolve()
        cls.token = 'inbox-bridge-test-token-' + 'x' * 32
        (cls.root / 'data').mkdir()
        cls.config_path = cls.root / 'config.json'
        with socket.socket() as listener:
            listener.bind(('127.0.0.1', 0))
            cls.port = listener.getsockname()[1]
        cls.config_path.write_text(json.dumps({
            'master_path': str(cls.root),
            'token': cls.token,
            'port': cls.port,
            'allowed_origins': [PRODUCTION_ORIGIN, 'http://localhost:3000'],
        }), encoding='utf-8')
        cls.inbox_path = cls.root / 'shared' / 'inbox' / 'inbox.json'
        cls.process = subprocess.Popen(
            [sys.executable, str(Path(__file__).with_name('bridge.py'))],
            cwd=Path(__file__).parent,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            env={
                **os.environ,
                'MTO_BRIDGE_CONFIG': str(cls.config_path),
                'MAIL_ANALYSIS_DB_PATH': str(cls.root / 'data' / 'mail.db'),
                'PORTAL_NOTICES_DB_PATH': str(cls.root / 'data' / 'portal.db'),
                'PYTHONUTF8': '1',
                'PYTHONIOENCODING': 'utf-8',
            },
        )
        deadline = time.monotonic() + 8
        while time.monotonic() < deadline:
            if cls.process.poll() is not None:
                raise RuntimeError('test bridge exited before becoming ready')
            try:
                with urllib.request.urlopen(f'http://127.0.0.1:{cls.port}/health', timeout=0.3) as response:
                    if response.status == 200:
                        break
            except (OSError, urllib.error.URLError):
                time.sleep(0.05)
        else:
            cls.process.terminate()
            cls.process.wait(timeout=3)
            raise RuntimeError('test bridge did not become ready')

    @classmethod
    def tearDownClass(cls):
        if cls.process.poll() is None:
            cls.process.terminate()
            cls.process.wait(timeout=3)
        cls.temp.cleanup()

    def setUp(self):
        if self.inbox_path.exists():
            if self.inbox_path.is_dir():
                shutil.rmtree(self.inbox_path)
            else:
                self.inbox_path.unlink()

    def request(self, method, path, payload=None):
        headers = {'Origin': PRODUCTION_ORIGIN}
        data = None
        if method == 'GET':
            headers['X-Bridge-Token'] = self.token
        else:
            headers['Content-Type'] = 'application/json'
            data = json.dumps({'token': self.token, **(payload or {})}).encode('utf-8')
        request = urllib.request.Request(
            f'http://127.0.0.1:{self.port}{path}', data=data, headers=headers, method=method,
        )
        try:
            response = urllib.request.urlopen(request, timeout=3)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return response.status, json.loads(response.read().decode('utf-8'))

    @staticmethod
    def raw_entry(entry_id='entry-1', raw_text='교수님께 결과 보내야 함', created_at='2026-09-28T10:00:00+09:00'):
        return {
            'id': entry_id,
            'rawText': raw_text,
            'createdAt': created_at,
            'processed': False,
            'ai': None,
        }

    def test_inbox_get_and_post_persist_to_vault_json(self):
        health_status, health = self.request('GET', '/health')
        self.assertEqual(health_status, 200)
        self.assertEqual(health['apiVersion'], 7)

        status, data = self.request('GET', '/inbox')
        self.assertEqual(status, 200)
        self.assertEqual(data['source'], 'vault')
        self.assertEqual(data['entries'], [])

        status, data = self.request('POST', '/inbox', {'entries': [self.raw_entry()]})
        self.assertEqual(status, 200)
        self.assertEqual(data['entries'][0]['rawText'], '교수님께 결과 보내야 함')
        stored = json.loads(self.inbox_path.read_text(encoding='utf-8'))
        self.assertEqual(stored['version'], 1)
        self.assertEqual(stored['entries'][0]['id'], 'entry-1')
        self.assertEqual(list(self.inbox_path.parent.glob('.inbox-*.tmp')), [])

    def test_inbox_delete_persists_after_reload(self):
        self.request('POST', '/inbox', {'entries': [
            self.raw_entry('delete-me', '삭제할 항목'),
            self.raw_entry('keep-me', '남길 항목'),
        ]})

        status, deleted = self.request('POST', '/inbox/delete', {'entryId': 'delete-me'})
        self.assertEqual(status, 200)
        self.assertEqual([entry['id'] for entry in deleted['entries']], ['keep-me'])
        stored = json.loads(self.inbox_path.read_text(encoding='utf-8'))
        self.assertEqual([entry['id'] for entry in stored['entries']], ['keep-me'])

        status, reloaded = self.request('GET', '/inbox')
        self.assertEqual(status, 200)
        self.assertEqual([entry['id'] for entry in reloaded['entries']], ['keep-me'])

        status, repeated = self.request('POST', '/inbox/delete', {'entryId': 'delete-me'})
        self.assertEqual(status, 200)
        self.assertEqual([entry['id'] for entry in repeated['entries']], ['keep-me'])

    def test_project_metadata_update_and_conflict_safety(self):
        project_root = self.root / 'projects' / 'thesis'
        project_root.mkdir(parents=True)
        manifest_path = project_root / 'project.md'
        original = '---\nid: thesis\nstage: planning\nstatus: active\n---\n\n사용자 메모는 보존되어야 한다.\n'
        manifest_path.write_bytes(original.encode('utf-8'))
        (project_root / 'paper.md').write_text('# Draft\n', encoding='utf-8')

        status, workspace = self.request('POST', '/projects/workspace', {'projectId': 'thesis'})
        self.assertEqual(status, 200)
        self.assertEqual(workspace['manifestText'], original)
        self.assertRegex(workspace['manifestSha'], r'^[a-f0-9]{64}$')
        first_sha = workspace['manifestSha']

        status, saved = self.request('POST', '/projects/update', {
            'projectId': 'thesis', 'operation': 'stage', 'value': 'analysis', 'expectedSha': first_sha,
        })
        self.assertEqual(status, 200, saved)
        self.assertIn('stage: analysis', saved['manifestText'])
        self.assertIn('사용자 메모는 보존되어야 한다.', saved['manifestText'])
        self.assertEqual(manifest_path.read_bytes().decode('utf-8'), saved['manifestText'])

        status, saved = self.request('POST', '/projects/update', {
            'projectId': 'thesis', 'operation': 'favorite_add', 'value': 'projects/thesis/paper.md',
            'expectedSha': saved['manifestSha'],
        })
        self.assertEqual(status, 200)
        self.assertIn('## 주요 파일\n- projects/thesis/paper.md', saved['manifestText'].replace('\r\n', '\n'))
        current_sha = saved['manifestSha']

        status, saved = self.request('POST', '/projects/update', {
            'projectId': 'thesis', 'operation': 'favorite_remove', 'value': 'projects/thesis/paper.md',
            'expectedSha': current_sha,
        })
        self.assertEqual(status, 200)
        self.assertNotIn('- projects/thesis/paper.md', saved['manifestText'])

        before_stale_write = manifest_path.read_bytes()
        status, conflict = self.request('POST', '/projects/update', {
            'projectId': 'thesis', 'operation': 'stage', 'value': 'writing', 'expectedSha': first_sha,
        })
        self.assertEqual(status, 409)
        self.assertIn('changed', conflict['error'])
        self.assertEqual(manifest_path.read_bytes(), before_stale_write)

    def test_project_next_task_update_targets_only_selected_project(self):
        target_root = self.root / 'projects' / 'inbox-task-target'
        other_root = self.root / 'projects' / 'inbox-task-other'
        target_root.mkdir(parents=True, exist_ok=True)
        other_root.mkdir(parents=True, exist_ok=True)
        target_manifest = target_root / 'project.md'
        other_manifest = other_root / 'project.md'
        target_manifest.write_text('---\nid: inbox-task-target\n---\n\n# Target project\n', encoding='utf-8')
        other_original = '---\nid: inbox-task-other\n---\n\n# Other project\n'
        other_manifest.write_text(other_original, encoding='utf-8')

        status, workspace = self.request('POST', '/projects/workspace', {'projectId': 'inbox-task-target'})
        self.assertEqual(status, 200)
        status, saved = self.request('POST', '/projects/update', {
            'projectId': 'inbox-task-target',
            'operation': 'next_task_add',
            'value': '교수님께 결과 보내기',
            'expectedSha': workspace['manifestSha'],
        })
        self.assertEqual(status, 200, saved)
        self.assertTrue(saved['added'])
        self.assertIn('## 다음 작업\n- 교수님께 결과 보내기', saved['manifestText'].replace('\r\n', '\n'))
        self.assertEqual(other_manifest.read_text(encoding='utf-8'), other_original)

        status, refreshed = self.request('POST', '/projects/workspace', {'projectId': 'inbox-task-target'})
        self.assertEqual(status, 200)
        status, duplicate = self.request('POST', '/projects/update', {
            'projectId': 'inbox-task-target',
            'operation': 'next_task_add',
            'value': '교수님께 결과 보내기',
            'expectedSha': refreshed['manifestSha'],
        })
        self.assertEqual(status, 200, duplicate)
        self.assertFalse(duplicate['added'], duplicate['manifestText'])
        self.assertEqual(other_manifest.read_text(encoding='utf-8'), other_original)

    def test_ai_apply_cannot_replace_raw_fields_or_remove_existing_entries(self):
        original = self.raw_entry()
        self.request('POST', '/inbox', {'entries': [original, self.raw_entry('entry-2', '산업연관표 정리')]})
        applied = {
            **self.raw_entry('entry-1', '변조한 원문', '2026-09-29T10:00:00+09:00'),
            'processed': True,
            'ai': {
                'entryId': 'entry-1',
                'category': 'Todo',
                'title': '결과 전달',
                'summary': '교수님께 결과를 보낸다.',
                'nextAction': '결과 파일을 교수님께 보내기',
                'dueDate': None,
                'relatedEntryIds': [],
                'processedAt': '2026-09-28T11:00:00+09:00',
            },
        }
        status, data = self.request('POST', '/inbox', {'entries': [applied]})
        self.assertEqual(status, 200)
        saved = {entry['id']: entry for entry in data['entries']}
        self.assertEqual(saved['entry-1']['rawText'], original['rawText'])
        self.assertEqual(saved['entry-1']['createdAt'], original['createdAt'])
        self.assertEqual(saved['entry-1']['ai']['title'], '결과 전달')
        self.assertIn('entry-2', saved)

    def test_invalid_post_does_not_change_vault_data(self):
        self.request('POST', '/inbox', {'entries': [self.raw_entry()]})
        status, data = self.request('POST', '/inbox', {'entries': [{**self.raw_entry(), 'rawText': '  '}]})
        self.assertEqual(status, 400)
        self.assertEqual(data['errorCode'], 'invalid_inbox_data')
        stored = json.loads(self.inbox_path.read_text(encoding='utf-8'))
        self.assertEqual(stored['entries'][0]['rawText'], '교수님께 결과 보내야 함')

    def test_write_failure_keeps_existing_data_and_returns_recoverable_error(self):
        self.request('POST', '/inbox', {'entries': [self.raw_entry()]})
        self.inbox_path.unlink()
        self.inbox_path.mkdir()
        status, data = self.request('POST', '/inbox', {'entries': [self.raw_entry('entry-2', '새 항목')]})
        self.assertEqual(status, 503)
        self.assertEqual(data['errorCode'], 'inbox_persist_failed')
        self.assertTrue(self.inbox_path.is_dir())

    def test_organize_path_is_registered_and_validates_payload(self):
        status, data = self.request('POST', '/inbox/organize', {'entries': []})
        self.assertEqual(status, 400)
        self.assertEqual(data['errorCode'], 'inbox_entries_invalid')


if __name__ == '__main__':
    unittest.main()
