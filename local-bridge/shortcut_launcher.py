import ctypes
import os
import platform
import shlex
import subprocess
from pathlib import Path
import re
from urllib.parse import urlparse

ALLOWED_TYPES = {'web', 'uri', 'shell', 'app', 'file', 'folder', 'command'}
EXTERNAL_URI_SCHEMES = {'steam', 'steamlink'}
WINDOWS_SHELL_TARGET = re.compile(r'^shell:(?:[a-z][a-z0-9._-]*|::\{[0-9a-f-]{36}\})$', re.IGNORECASE)
MAX_TEXT = 8192


def normalize_shortcut_request(body):
    shortcut_type = _required_text(body.get('type'), 'type')
    if shortcut_type not in ALLOWED_TYPES:
        raise ValueError('unsupported shortcut type')
    target = _required_text(body.get('target'), 'target')
    args = _optional_text(body.get('args'), 'args')
    working_directory = _optional_text(body.get('workingDirectory'), 'workingDirectory')
    run_as_admin = body.get('runAsAdmin') is True

    if working_directory:
        working_path = Path(working_directory).expanduser()
        if not working_path.is_absolute() or not working_path.is_dir():
            raise ValueError('workingDirectory must be an existing absolute directory')
        working_directory = str(working_path.resolve())

    if shortcut_type == 'web':
        parsed = urlparse(target)
        if parsed.scheme not in {'http', 'https'} or not parsed.netloc:
            raise ValueError('web shortcut target must be an http or https URL')
    elif shortcut_type == 'uri':
        parsed = urlparse(target)
        if parsed.scheme.lower() not in EXTERNAL_URI_SCHEMES or _has_control_or_whitespace(target):
            raise ValueError('unsupported external URI')
    elif shortcut_type == 'shell':
        if not WINDOWS_SHELL_TARGET.fullmatch(target) or _has_control_character(target):
            raise ValueError('unsupported Windows shell target')
    elif shortcut_type != 'command':
        path = Path(target).expanduser()
        if not path.is_absolute():
            raise ValueError('local shortcut target must be an absolute path')
        if shortcut_type == 'folder':
            if not path.is_dir():
                raise FileNotFoundError('local folder not found')
        elif not path.is_file():
            raise FileNotFoundError('local file not found')
        target = str(path.resolve())

    return {
        'type': shortcut_type,
        'target': target,
        'args': args,
        'workingDirectory': working_directory,
        'runAsAdmin': run_as_admin,
    }


def launch_shortcut(request):
    shortcut_type = request['type']
    target = request['target']
    args = request.get('args') or ''
    cwd = request.get('workingDirectory') or None
    run_as_admin = request.get('runAsAdmin') is True
    system = platform.system()

    if shortcut_type in ('file', 'folder'):
        _open_path(target, system)
        return

    if shortcut_type in ('web', 'uri'):
        _open_path(target, system)
        return

    if shortcut_type == 'shell':
        if system != 'Windows':
            raise OSError('Windows shell targets are only supported on Windows')
        subprocess.Popen(['explorer.exe', target])
        return

    if shortcut_type == 'app':
        if system == 'Windows' and run_as_admin:
            _shell_execute_runas(target, args, cwd)
            return
        command = [target]
        if args:
            command.extend(shlex.split(args, posix=system != 'Windows'))
        subprocess.Popen(command, cwd=cwd)
        return

    if shortcut_type == 'command':
        if system == 'Windows' and run_as_admin:
            _shell_execute_runas('cmd.exe', f'/d /s /c "{target}"', cwd)
            return
        subprocess.Popen(target, cwd=cwd, shell=True)
        return

    raise ValueError('unsupported shortcut type')


def _open_path(target, system):
    if system == 'Windows':
        os.startfile(target)
    elif system == 'Darwin':
        subprocess.Popen(['open', target])
    else:
        subprocess.Popen(['xdg-open', target])


def _shell_execute_runas(file_name, parameters, cwd):
    result = ctypes.windll.shell32.ShellExecuteW(None, 'runas', file_name, parameters or None, cwd or None, 1)
    if result <= 32:
        raise OSError(f'ShellExecuteW failed with code {result}')


def _has_control_or_whitespace(value):
    return any(character.isspace() or ord(character) < 0x20 or ord(character) == 0x7f for character in value)


def _has_control_character(value):
    return any(ord(character) < 0x20 or ord(character) == 0x7f for character in value)


def _required_text(value, name):
    text = _optional_text(value, name)
    if not text:
        raise ValueError(f'{name} is required')
    return text


def _optional_text(value, name):
    if value is None or value == '':
        return ''
    if not isinstance(value, str):
        raise ValueError(f'{name} must be a string')
    text = value.strip()
    if len(text) > MAX_TEXT:
        raise ValueError(f'{name} is too long')
    return text
