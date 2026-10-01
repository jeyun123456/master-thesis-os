from __future__ import annotations

import builtins
import io
import os
import subprocess
import tempfile
import webbrowser
from pathlib import Path
from unittest.mock import patch

import portal_ai
import portal_client
import portal_db
from mail_test_safety import MailTestSafetyMixin


class PortalTestSafetyMixin(MailTestSafetyMixin):
    def setUp(self):
        super().setUp()

        original_temp_directory = tempfile.TemporaryDirectory

        def tracked_temp_directory(*args, **kwargs):
            directory = original_temp_directory(*args, **kwargs)
            self.register_mail_test_temp(directory.name)
            return directory

        self._patch(tempfile, 'TemporaryDirectory', tracked_temp_directory)
        for name in (
            '_request_provider', '_request_codex_provider', '_request_http_provider',
            '_request_batch_provider', '_request_batch_codex_provider', '_request_batch_http_provider',
            '_request_inbox_provider', '_request_inbox_codex_provider', '_request_inbox_http_provider',
        ):
            self._patch(portal_ai, name, self._forbidden(f'portal_ai.{name}'))

        self._patch(
            portal_client.PortalClient,
            '_playwright',
            staticmethod(self._forbidden('portal_client.PortalClient._playwright')),
        )
        self._patch(
            portal_client,
            'find_system_default_browser_executable',
            self._forbidden('portal_client.find_system_default_browser_executable'),
        )
        self._patch(portal_client, '_logger', self._forbidden('portal_client._logger'))
        self._patch(webbrowser, 'open', self._forbidden('webbrowser.open'))
        self._patch(subprocess, 'run', self._forbidden('subprocess.run'))

        startfile_patch = patch.object(os, 'startfile', self._forbidden('os.startfile'), create=True)
        startfile_patch.start()
        self.addCleanup(startfile_patch.stop)

        original_resolve_db_path = portal_db.resolve_db_path

        def resolve_db_path(path=None):
            if path is None or not self._is_test_db_path(path):
                self._record_and_raise('portal_db.resolve_db_path')
            return original_resolve_db_path(path)

        self._patch(portal_db, 'resolve_db_path', resolve_db_path)
        self._guard_file_io()

    def _guard_file_io(self) -> None:
        repository_root = Path(__file__).resolve().parents[1]

        def checked_open(original, label, file, mode='r', *args, **kwargs):
            try:
                candidate = Path(os.fspath(file)).expanduser().resolve(strict=False)
            except (TypeError, ValueError, OSError):
                self._record_and_raise(label)
            read_only = 'r' in mode and not any(flag in mode for flag in 'wax+')
            in_temp = self._is_test_db_path(candidate)
            source_file = candidate.suffix.lower() in {'.py', '.pyc'} and (
                candidate == repository_root or repository_root in candidate.parents
            )
            if not (in_temp or (read_only and source_file)):
                self._record_and_raise(label)
            return original(file, mode, *args, **kwargs)

        original_builtin_open = builtins.open
        original_io_open = io.open

        def guarded_builtin_open(file, mode='r', *args, **kwargs):
            return checked_open(original_builtin_open, 'builtins.open', file, mode, *args, **kwargs)

        def guarded_io_open(file, mode='r', *args, **kwargs):
            return checked_open(original_io_open, 'io.open', file, mode, *args, **kwargs)

        self._patch(builtins, 'open', guarded_builtin_open)
        self._patch(io, 'open', guarded_io_open)
