from __future__ import annotations

import os
import socket
import sqlite3
import subprocess
import urllib.request
from pathlib import Path
from unittest.mock import patch

import bridge_config
import mail_cli
import mail_db


class MailTestSafetyMixin:
    _SAFE_ENV_KEYS = ('SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR')

    def setUp(self):
        self.mail_safety_attempts: list[str] = []
        self._mail_safety_db_roots: set[Path] = set()
        self.addCleanup(self._assert_no_mail_safety_attempts)

        safe_env = {key: os.environ[key] for key in self._SAFE_ENV_KEYS if key in os.environ}
        environment = patch.dict(os.environ, safe_env, clear=True)
        environment.start()
        self.addCleanup(environment.stop)

        self._patch(mail_cli, 'load_local_env', lambda *_args, **_kwargs: None)
        for name in ('load_settings', 'get_recent_mail', 'get_mail_message'):
            self._patch(mail_cli, name, self._forbidden(f'mail_cli.{name}'))
        for name in ('load_bridge_config', 'resolve_config_path'):
            self._patch(mail_cli, name, self._forbidden(f'mail_cli.{name}'))
            self._patch(bridge_config, name, self._forbidden(f'bridge_config.{name}'))

        for name in (
            '_request_provider', '_request_batch_provider', '_request_codex_provider',
            '_request_batch_codex_provider', '_request_batch_http_provider',
        ):
            self._patch(mail_cli, name, self._forbidden(f'mail_cli.{name}'))

        self._patch(urllib.request, 'urlopen', self._forbidden('urllib.request.urlopen'))
        self._patch(urllib.request.OpenerDirector, 'open', self._forbidden('urllib.OpenerDirector.open'))
        self._guard_sockets()
        self._patch(subprocess, 'Popen', self._forbidden('subprocess.Popen'))
        self._patch(os, 'system', self._forbidden('os.system'))
        self._guard_databases()

        super().setUp()

    def _patch(self, target, name: str, replacement) -> None:
        patcher = patch.object(target, name, replacement)
        patcher.start()
        self.addCleanup(patcher.stop)

    def _forbidden(self, label: str):
        def deny(*_args, **_kwargs):
            self._record_and_raise(label)
        return deny

    def _record_and_raise(self, label: str) -> None:
        self.mail_safety_attempts.append(label)
        raise AssertionError(f'blocked test side effect: {label}')

    def register_mail_test_temp(self, path: str | Path) -> None:
        self._mail_safety_db_roots.add(Path(path).resolve(strict=False))

    def clear_expected_mail_safety_attempts(self, expected: list[str]) -> None:
        self.assertEqual(self.mail_safety_attempts, expected)
        self.mail_safety_attempts.clear()

    def _assert_no_mail_safety_attempts(self) -> None:
        self.assertEqual(self.mail_safety_attempts, [], 'unexpected blocked side effect')

    def _is_test_db_path(self, value: str | os.PathLike[str]) -> bool:
        candidate = Path(value).expanduser().resolve(strict=False)
        return any(candidate == root or root in candidate.parents for root in self._mail_safety_db_roots)

    def _guard_sockets(self) -> None:
        self._patch(socket, 'socket', self._forbidden('socket.socket'))
        for name in ('create_connection', 'getaddrinfo'):
            self._patch(socket, name, self._forbidden(f'socket.{name}'))

    def _guard_databases(self) -> None:
        original_resolve = mail_db.resolve_db_path

        def resolve_db_path(path=None):
            if path is None or not self._is_test_db_path(path):
                self._record_and_raise('mail_db.resolve_db_path')
            return original_resolve(path)

        original_connect = sqlite3.connect

        def connect(database, *args, **kwargs):
            raw = os.fspath(database)
            if not isinstance(raw, str) or raw == ':memory:' or raw.startswith('file:') or not self._is_test_db_path(raw):
                self._record_and_raise('sqlite3.connect')
            return original_connect(database, *args, **kwargs)

        self._patch(mail_db, 'resolve_db_path', resolve_db_path)
        self._patch(sqlite3, 'connect', connect)
