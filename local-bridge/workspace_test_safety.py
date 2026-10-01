from __future__ import annotations

import builtins
import io
import os
import tempfile
from pathlib import Path

from portal_test_safety import PortalTestSafetyMixin


_ORIGINALS = {
    'builtins.open': builtins.open,
    'io.open': io.open,
    'Path.resolve': Path.resolve,
    'os.path.abspath': os.path.abspath,
    'os.path.realpath': os.path.realpath,
    **{
        f'os.{name}': getattr(os, name)
        for name in (
            'open', 'close', 'stat', 'lstat', 'readlink', 'scandir', 'listdir', 'mkdir',
            'makedirs', 'unlink', 'remove', 'rmdir', 'removedirs', 'rename',
            'replace', 'symlink', 'link', 'chmod', 'utime', 'truncate',
        )
        if hasattr(os, name)
    },
}
_REPOSITORY_ROOT = Path(__file__).resolve().parents[1]


class WorkspaceTestSafetyMixin(PortalTestSafetyMixin):
    """Adds fail-closed filesystem guards to the existing Bridge test guards."""

    def setUp(self):
        self.workspace_safety_attempts: list[str] = []
        self._workspace_canonicalizing = 0
        self._workspace_safe_fds: dict[int, Path] = {}
        self.addCleanup(self._assert_no_workspace_safety_attempts)
        super().setUp()

        # PortalTestSafetyMixin wraps this allocator and registers the root before
        # these broader guards are installed.
        self.workspace_temp = tempfile.TemporaryDirectory(prefix='workspace-store-test-')
        self.addCleanup(self.workspace_temp.cleanup)
        self.workspace_temp_root = Path(self.workspace_temp.name).resolve(strict=True)
        self._workspace_temp_roots = {self.workspace_temp_root}
        self._guard_workspace_filesystem()

    def _workspace_record_and_raise(self, label: str) -> None:
        self.workspace_safety_attempts.append(label)
        raise AssertionError(f'blocked workspace test side effect: {label}')

    def _assert_no_workspace_safety_attempts(self) -> None:
        self.assertEqual(
            self.workspace_safety_attempts,
            [],
            'unexpected blocked workspace filesystem access',
        )

    def clear_expected_workspace_safety_attempts(self, expected: list[str]) -> None:
        self.assertEqual(self.workspace_safety_attempts, expected)
        self.workspace_safety_attempts.clear()

    @staticmethod
    def _workspace_inside(path: Path, root: Path) -> bool:
        try:
            candidate = os.path.normcase(str(path))
            parent = os.path.normcase(str(root))
            return os.path.commonpath((candidate, parent)) == parent
        except (OSError, ValueError):
            return False

    def _workspace_check_path(self, value, label: str, *, source_read: bool = False) -> Path:
        if isinstance(value, int):
            known = self._workspace_safe_fds.get(value)
            if known is not None:
                return known
            self._workspace_record_and_raise(label)
        try:
            raw = os.fspath(value)
            lexical = Path(_ORIGINALS['os.path.abspath'](os.path.expanduser(raw)))
        except (TypeError, ValueError, OSError):
            self._workspace_record_and_raise(label)

        source_file = (
            source_read
            and lexical.suffix.lower() in {'.py', '.pyc'}
            and self._workspace_inside(lexical, _REPOSITORY_ROOT)
        )
        lexical_in_temp = any(
            self._workspace_inside(lexical, root)
            for root in self._workspace_temp_roots
        )
        if not lexical_in_temp and not source_file:
            self._workspace_record_and_raise(label)

        self._workspace_canonicalizing += 1
        try:
            canonical = _ORIGINALS['Path.resolve'](lexical, strict=False)
        except (OSError, RuntimeError, ValueError):
            self._workspace_record_and_raise(label)
        finally:
            self._workspace_canonicalizing -= 1

        canonical_source = (
            source_file
            and canonical.suffix.lower() in {'.py', '.pyc'}
            and self._workspace_inside(canonical, _REPOSITORY_ROOT)
        )
        canonical_in_temp = any(
            self._workspace_inside(canonical, root)
            for root in self._workspace_temp_roots
        )
        if not canonical_in_temp and not canonical_source:
            self._workspace_record_and_raise(label)
        return canonical

    def _guard_workspace_filesystem(self) -> None:
        import unittest.mock

        def patch(target, name: str, replacement) -> None:
            patcher = unittest.mock.patch.object(target, name, replacement)
            patcher.start()
            self.addCleanup(patcher.stop)

        def allowed_mode(mode) -> bool:
            return 'r' in mode and not any(flag in mode for flag in 'wax+')

        def guarded_open(label: str, original, file, mode='r', *args, **kwargs):
            fd_source = isinstance(file, int)
            if fd_source:
                path = self._workspace_safe_fds.get(file)
                if path is None or not any(
                    self._workspace_inside(path, root)
                    for root in self._workspace_temp_roots
                ):
                    self._workspace_record_and_raise(label)
            else:
                self._workspace_check_path(
                    file,
                    label,
                    source_read=allowed_mode(mode),
                )
            return original(file, mode, *args, **kwargs)

        patch(
            builtins,
            'open',
            lambda file, mode='r', *args, **kwargs: guarded_open(
                'builtins.open', _ORIGINALS['builtins.open'], file, mode, *args, **kwargs
            ),
        )
        patch(
            io,
            'open',
            lambda file, mode='r', *args, **kwargs: guarded_open(
                'io.open', _ORIGINALS['io.open'], file, mode, *args, **kwargs
            ),
        )

        def metadata(name: str, original):
            def checked(path, *args, **kwargs):
                if self._workspace_canonicalizing:
                    return original(path, *args, **kwargs)
                if kwargs.get('dir_fd') is not None:
                    self._workspace_record_and_raise(f'os.{name}(dir_fd)')
                self._workspace_check_path(path, f'os.{name}', source_read=True)
                return original(path, *args, **kwargs)
            return checked

        def guarded_os_open(path, flags, mode=0o777, *, dir_fd=None):
            if dir_fd is not None:
                self._workspace_record_and_raise('os.open(dir_fd)')
            read_only = not flags & (
                os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC | os.O_APPEND
            )
            canonical = self._workspace_check_path(
                path,
                'os.open',
                source_read=read_only,
            )
            fd = _ORIGINALS['os.open'](path, flags, mode)
            self._workspace_safe_fds[fd] = canonical
            return fd

        patch(os, 'open', guarded_os_open)
        for name in ('stat', 'lstat', 'readlink', 'scandir', 'listdir'):
            if f'os.{name}' in _ORIGINALS:
                patch(os, name, metadata(name, _ORIGINALS[f'os.{name}']))

        def guarded_mutation(name: str, original, path_indexes: tuple[int, ...]):
            def checked(*args, **kwargs):
                for index in path_indexes:
                    if index < len(args):
                        self._workspace_check_path(args[index], f'os.{name}')
                for key in ('path', 'name', 'src', 'dst'):
                    if key in kwargs:
                        self._workspace_check_path(kwargs[key], f'os.{name}')
                for key in ('dir_fd', 'src_dir_fd', 'dst_dir_fd'):
                    if key in kwargs and kwargs[key] is not None:
                        self._workspace_record_and_raise(f'os.{name}(dir_fd)')
                return original(*args, **kwargs)
            return checked

        mutation_paths = {
            'mkdir': (0,), 'makedirs': (0,), 'unlink': (0,), 'remove': (0,),
            'rmdir': (0,), 'removedirs': (0,), 'rename': (0, 1), 'replace': (0, 1),
            'symlink': (0, 1), 'link': (0, 1), 'chmod': (0,), 'utime': (0,),
            'truncate': (0,),
        }
        for name, indexes in mutation_paths.items():
            if f'os.{name}' in _ORIGINALS:
                patch(
                    os,
                    name,
                    guarded_mutation(name, _ORIGINALS[f'os.{name}'], indexes),
                )

        def guarded_close(fd):
            self._workspace_check_path(fd, 'os.close')
            self._workspace_safe_fds.pop(fd, None)
            return _ORIGINALS['os.close'](fd)

        if 'os.close' in _ORIGINALS:
            patch(os, 'close', guarded_close)
