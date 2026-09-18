from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import threading
import unicodedata
from dataclasses import dataclass
from datetime import datetime, timezone
from email import policy
from email.header import decode_header
from email.parser import BytesFeedParser, BytesParser
from email.utils import parsedate_to_datetime, parseaddr
from html.parser import HTMLParser
from pathlib import Path
from typing import BinaryIO, Iterable


DEFAULT_MAIL_LIMIT = 5
MAX_MAIL_LIMIT = 100
MAX_MAIL_BODY_CHARS = 60_000
BERKELEY_STORE_CONTRACT = '@mozilla.org/msgstore/berkeleystore;1'
MAILDIR_STORE_CONTRACT = '@mozilla.org/msgstore/maildirstore;1'

SAFE_PROFILE_PREFS = {
    'hostname',
    'userName',
    'name',
    'directory',
    'directory-rel',
    'type',
    'storeContractID',
    'inbox_folder_name',
    'inbox_folder_path',
    'trash_folder_path',
}
PREF_RE = re.compile(
    r'^user_pref\("(?P<key>[^"\\]+)",\s*"(?P<value>(?:\\.|[^"\\])*)"\);'
)
SERVER_KEY_RE = re.compile(r'^mail\.server\.(?P<server>server\d+)\.(?P<name>[^.]+)$')
ACCOUNT_SERVER_KEY_RE = re.compile(r'^mail\.account\.(?P<account>account\d+)\.server$')
PROFILE_SECTION_RE = re.compile(r'^Profile\d+$')
INSTALL_SECTION_RE = re.compile(r'^Install')
INBOX_NAMES = (
    'inbox',
    '받은 편지함',
    '受信トレイ',
    'boîte de réception',
    'posteingang',
    'posta in arrivo',
    'bandeja de entrada',
    'caixa de entrada',
    'bandeja de entrada',
)
FOLDER_IDS = ('school-work', 'international-office', 'inbox')
FOLDER_LABELS = {
    'school-work': '학교 업무',
    'international-office': '국제과',
    'inbox': '받은 편지함',
}
FOLDER_NAME_CANDIDATES = {
    'school-work': ('학교 업무', '학교업무', 'school work', 'school-work'),
    'international-office': ('국제과', '국제부', 'international office', 'international-office'),
    'inbox': INBOX_NAMES,
}


class ThunderbirdMailError(RuntimeError):
    """A safe, user-facing local mail error without provider or path details."""

    MESSAGES = {
        'thunderbird_not_installed': 'Thunderbird 설치를 찾지 못했어.',
        'profile_not_found': 'Thunderbird profile을 찾지 못했어.',
        'account_not_found': 'Thunderbird 학교 계정을 찾지 못했어.',
        'inbox_not_found': 'Thunderbird 받은편지함을 찾지 못했어.',
        'folder_not_found': 'Thunderbird 메일 폴더를 찾지 못했어.',
        'local_sync_required': 'Thunderbird에서 이 계정의 메시지를 이 컴퓨터에 보관해줘.',
        'unsupported_store': 'Thunderbird 로컬 메일 저장 방식을 아직 읽을 수 없어.',
        'parse_error': 'Thunderbird 메일 헤더를 읽지 못했어.',
        'mail_not_found': 'Thunderbird에서 해당 메일을 찾지 못했어. 새로고침 후 다시 시도해줘.',
        'bridge_auth': 'Local Bridge token을 확인해줘.',
        'bridge_offline': 'Local Bridge가 실행 중인지 확인해줘.',
    }

    def __init__(self, code: str, message: str | None = None, http_status: int = 503):
        self.code = code
        self.http_status = http_status
        super().__init__(message or self.MESSAGES.get(code, self.MESSAGES['parse_error']))


@dataclass(frozen=True)
class ThunderbirdSettings:
    account: str = ''
    profile_path: str = ''


@dataclass(frozen=True)
class ThunderbirdProfile:
    name: str
    path: Path
    is_default: bool = False
    section: str = ''


@dataclass(frozen=True)
class ThunderbirdAccount:
    account_id: str
    server_id: str
    username: str
    name: str
    hostname: str
    account_type: str
    directory: str
    directory_rel: str
    store_contract_id: str
    inbox_folder_name: str
    inbox_folder_path: str

    def storage_path(self, profile_path: Path) -> Path:
        if self.directory:
            candidate = Path(os.path.expandvars(self.directory)).expanduser()
            if not candidate.is_absolute():
                candidate = profile_path / candidate
            return candidate

        relative = self.directory_rel
        if relative.startswith('[ProfD]'):
            relative = relative[len('[ProfD]'):].lstrip('/\\')
            return profile_path / Path(relative.replace('/', os.sep))
        if relative:
            return profile_path / Path(relative.replace('/', os.sep))
        return profile_path

    def matches(self, requested: str) -> bool:
        target = requested.strip().casefold()
        return bool(target) and target in {
            self.username.strip().casefold(),
            self.name.strip().casefold(),
        }


@dataclass(frozen=True)
class ThunderbirdMailItem:
    id: str
    subject: str
    sender_name: str
    sender_address: str
    received_at: str
    is_read: bool
    message_id: str | None = None

    def to_dict(self) -> dict[str, object]:
        result: dict[str, object] = {
            'id': self.id,
            'subject': self.subject,
            'senderName': self.sender_name,
            'senderAddress': self.sender_address,
            'receivedAt': self.received_at,
            'isRead': self.is_read,
        }
        if self.message_id:
            result['messageId'] = self.message_id
        return result


@dataclass(frozen=True)
class ThunderbirdMailMessage:
    item: ThunderbirdMailItem
    body: str

    def to_dict(self) -> dict[str, object]:
        return {**self.item.to_dict(), 'body': self.body}


@dataclass(frozen=True)
class ThunderbirdFolder:
    id: str
    label: str
    path: Path | None = None
    storage_type: str = ''

    @property
    def available(self) -> bool:
        return self.path is not None

    def to_dict(self) -> dict[str, object]:
        return {
            'id': self.id,
            'label': self.label,
            'available': self.available,
        }


@dataclass(frozen=True)
class _MboxCacheEntry:
    modified_ns: int
    size: int
    items: tuple[ThunderbirdMailItem, ...]


_MBOX_CACHE: dict[str, _MboxCacheEntry] = {}
_MBOX_CACHE_LOCK = threading.Lock()


def clamp_mail_limit(value: object, default: int = DEFAULT_MAIL_LIMIT) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        return default
    return max(1, min(MAX_MAIL_LIMIT, value))


def mask_account(value: str) -> str:
    text = value.strip()
    if '@' not in text:
        return '***' if text else ''
    local, domain = text.split('@', 1)
    return f'{local[:2]}***@{domain}' if local else f'***@{domain}'


def _decode_prefs_string(value: str) -> str:
    try:
        return json.loads(f'"{value}"')
    except (json.JSONDecodeError, UnicodeDecodeError):
        return value.replace('\\"', '"').replace('\\\\', '\\')


def _profile_path(raw_path: str, is_relative: str, profile_root: Path) -> Path:
    expanded = Path(os.path.expandvars(raw_path)).expanduser()
    if is_relative == '1':
        expanded = profile_root / expanded
    return expanded.resolve(strict=False)


def parse_profiles_ini_text(text: str, profile_root: Path) -> list[ThunderbirdProfile]:
    sections: list[tuple[str, dict[str, str]]] = []
    current_name = ''
    current: dict[str, str] = {}
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith(('#', ';')):
            continue
        section_match = re.fullmatch(r'\[(.+)\]', line)
        if section_match:
            if current_name:
                sections.append((current_name, current))
            current_name = section_match.group(1)
            current = {}
            continue
        if '=' in line:
            key, value = line.split('=', 1)
            current[key.strip()] = value.strip()
    if current_name:
        sections.append((current_name, current))

    profiles_by_path: dict[Path, ThunderbirdProfile] = {}
    raw_profiles: list[tuple[str, dict[str, str], Path]] = []
    for section_name, values in sections:
        if not PROFILE_SECTION_RE.match(section_name) or not values.get('Path'):
            continue
        path = _profile_path(values['Path'], values.get('IsRelative', '0'), profile_root)
        profile = ThunderbirdProfile(
            name=values.get('Name', section_name),
            path=path,
            is_default=values.get('Default') == '1',
            section=section_name,
        )
        profiles_by_path[path] = profile
        raw_profiles.append((section_name, values, path))

    ordered_paths: list[Path] = []

    def add_path(path: Path) -> None:
        if path in profiles_by_path and path not in ordered_paths:
            ordered_paths.append(path)

    for section_name, values in sections:
        if INSTALL_SECTION_RE.match(section_name) and values.get('Default'):
            add_path(_profile_path(values['Default'], '1', profile_root))
    for _, values, path in raw_profiles:
        if values.get('Default') == '1':
            add_path(path)
    for _, _, path in raw_profiles:
        add_path(path)

    return [profiles_by_path[path] for path in ordered_paths]


def parse_profiles_ini(path: Path) -> list[ThunderbirdProfile]:
    try:
        text = path.read_text(encoding='utf-8-sig')
    except (OSError, UnicodeError) as exc:
        raise ThunderbirdMailError('profile_not_found') from exc
    return parse_profiles_ini_text(text, path.parent)


def default_profiles_ini() -> Path:
    app_data = os.environ.get('APPDATA', '').strip()
    if app_data:
        return Path(app_data) / 'Thunderbird' / 'profiles.ini'
    return Path.home() / 'AppData' / 'Roaming' / 'Thunderbird' / 'profiles.ini'


def resolve_profile_candidates(settings: ThunderbirdSettings) -> list[Path]:
    if settings.profile_path.strip():
        path = Path(os.path.expandvars(settings.profile_path.strip())).expanduser().resolve(strict=False)
        if not path.is_dir():
            raise ThunderbirdMailError('profile_not_found')
        return [path]

    profiles_ini = default_profiles_ini()
    if not profiles_ini.exists():
        raise ThunderbirdMailError('profile_not_found')
    candidates = [profile.path for profile in parse_profiles_ini(profiles_ini) if profile.path.is_dir()]
    if not candidates:
        raise ThunderbirdMailError('profile_not_found')
    return candidates


def _safe_pref_key(key: str) -> bool:
    if ACCOUNT_SERVER_KEY_RE.match(key):
        return True
    match = SERVER_KEY_RE.match(key)
    return bool(match and match.group('name') in SAFE_PROFILE_PREFS)


def read_safe_prefs(profile_path: Path) -> dict[str, str]:
    prefs_path = profile_path / 'prefs.js'
    if not prefs_path.exists():
        return {}
    values: dict[str, str] = {}
    try:
        with prefs_path.open('r', encoding='utf-8-sig', errors='replace') as prefs_file:
            for line in prefs_file:
                match = PREF_RE.match(line.strip())
                if not match or not _safe_pref_key(match.group('key')):
                    continue
                values[match.group('key')] = _decode_prefs_string(match.group('value'))
    except OSError as exc:
        raise ThunderbirdMailError('parse_error') from exc
    return values


def discover_accounts(profile_path: Path) -> list[ThunderbirdAccount]:
    values = read_safe_prefs(profile_path)
    server_values: dict[str, dict[str, str]] = {}
    account_servers: dict[str, str] = {}
    for key, value in values.items():
        account_match = ACCOUNT_SERVER_KEY_RE.match(key)
        if account_match:
            account_servers[account_match.group('account')] = value
            continue
        server_match = SERVER_KEY_RE.match(key)
        if server_match:
            server_values.setdefault(server_match.group('server'), {})[server_match.group('name')] = value

    pairs: list[tuple[str, str]] = list(account_servers.items())
    known_servers = {server_id for _, server_id in pairs}
    pairs.extend((f'implicit-{server_id}', server_id) for server_id in server_values if server_id not in known_servers)

    accounts: list[ThunderbirdAccount] = []
    for account_id, server_id in pairs:
        server = server_values.get(server_id, {})
        username = server.get('userName', '')
        account_type = server.get('type', '')
        if not username and not server.get('name'):
            continue
        if account_type.casefold() == 'none' and not username:
            continue
        accounts.append(ThunderbirdAccount(
            account_id=account_id,
            server_id=server_id,
            username=username,
            name=server.get('name', ''),
            hostname=server.get('hostname', ''),
            account_type=account_type,
            directory=server.get('directory', ''),
            directory_rel=server.get('directory-rel', ''),
            store_contract_id=server.get('storeContractID', ''),
            inbox_folder_name=server.get('inbox_folder_name', ''),
            inbox_folder_path=server.get('inbox_folder_path', ''),
        ))
    return accounts


def _is_maildir(path: Path) -> bool:
    return path.is_dir() and all((path / name).is_dir() for name in ('cur', 'new', 'tmp'))


def _candidate_folder_names(account: ThunderbirdAccount) -> list[str]:
    names: list[str] = []
    for value in (account.inbox_folder_path, account.inbox_folder_name):
        if value.strip() and value.strip() not in names:
            names.append(value.strip())
    names.extend(name for name in INBOX_NAMES if name not in names)
    return names


def normalize_folder_id(value: object, default: str = 'inbox') -> str:
    if value is None or value == '':
        return default
    if isinstance(value, str) and value in FOLDER_IDS:
        return value
    raise ThunderbirdMailError('folder_not_found')


def _normalized_folder_name(value: str) -> str:
    return unicodedata.normalize('NFC', value).strip().casefold()


def _folder_entry_name(path: Path) -> str:
    name = path.name
    if _is_maildir(path) and name.startswith('.'):
        return name[1:]
    return name


def _iter_folder_entries(storage: Path) -> Iterable[Path]:
    if _is_maildir(storage):
        yield storage
        return
    if not storage.is_dir():
        return
    try:
        entries = sorted(storage.rglob('*'), key=lambda entry: entry.as_posix().casefold())
    except OSError:
        return
    for entry in entries:
        if entry.is_file():
            if entry.suffix.casefold() == '.msf' or entry.name == 'msgFilterRules.dat':
                continue
            yield entry
        elif entry.is_dir() and _is_maildir(entry):
            yield entry


def _folder_candidate_names(account: ThunderbirdAccount, folder_id: str) -> list[str]:
    names: list[str] = []
    if folder_id == 'inbox':
        for value in (account.inbox_folder_path, account.inbox_folder_name):
            if value.strip() and value.strip() not in names:
                names.append(value.strip())
    names.extend(value for value in FOLDER_NAME_CANDIDATES[folder_id] if value not in names)
    return names


def _folder_entry_rank(path: Path, storage: Path, folder_id: str, names: list[str]) -> tuple[int, int, int, str]:
    relative = path.relative_to(storage)
    entry_name = _normalized_folder_name(_folder_entry_name(path))
    exact_path = _normalized_folder_name(relative.as_posix())
    candidate_rank = len(names)
    for index, name in enumerate(names):
        normalized = _normalized_folder_name(name)
        if normalized == entry_name or normalized == exact_path:
            candidate_rank = index
            break
        if '/' in name or '\\' in name:
            path_name = _normalized_folder_name(name.replace('\\', '/').strip('/'))
            if path_name == exact_path:
                candidate_rank = index
                break
            if _normalized_folder_name(Path(name).name) == entry_name:
                candidate_rank = index
    nested_rank = sum(1 for part in relative.parts if part.casefold().endswith('.sbd'))
    return nested_rank, len(relative.parts), candidate_rank, relative.as_posix().casefold()


def find_folder(account: ThunderbirdAccount, profile_path: Path, folder_id: str) -> ThunderbirdFolder | None:
    folder_id = normalize_folder_id(folder_id)
    storage = account.storage_path(profile_path)
    if _is_maildir(storage):
        if folder_id == 'inbox':
            return ThunderbirdFolder(folder_id, FOLDER_LABELS[folder_id], storage, 'maildir')
        return None
    if not storage.is_dir():
        return None
    names = _folder_candidate_names(account, folder_id)
    normalized_names = {_normalized_folder_name(name) for name in names}
    matches: list[Path] = []
    for entry in _iter_folder_entries(storage):
        entry_name = _normalized_folder_name(_folder_entry_name(entry))
        relative_name = _normalized_folder_name(entry.relative_to(storage).as_posix())
        if entry_name in normalized_names or relative_name in normalized_names:
            matches.append(entry)
            continue
        for name in names:
            path_name = _normalized_folder_name(name.replace('\\', '/').strip('/'))
            if path_name and path_name == relative_name:
                matches.append(entry)
                break
    if not matches:
        return None
    selected = min(matches, key=lambda entry: _folder_entry_rank(entry, storage, folder_id, names))
    return ThunderbirdFolder(
        folder_id,
        FOLDER_LABELS[folder_id],
        selected,
        'maildir' if _is_maildir(selected) else 'mbox',
    )


def discover_folders(account: ThunderbirdAccount, profile_path: Path) -> list[ThunderbirdFolder]:
    return [
        find_folder(account, profile_path, folder_id)
        or ThunderbirdFolder(folder_id, FOLDER_LABELS[folder_id])
        for folder_id in FOLDER_IDS
    ]


def find_inbox(account: ThunderbirdAccount, profile_path: Path) -> Path | None:
    folder = find_folder(account, profile_path, 'inbox')
    return folder.path if folder else None


def _parse_status(value: str) -> int:
    try:
        return int(value.strip(), 16)
    except (TypeError, ValueError):
        return 0


def _decode_header_value(value: object) -> str:
    if not isinstance(value, str):
        return ''
    parts: list[str] = []
    for chunk, charset in decode_header(value):
        if isinstance(chunk, bytes):
            try:
                parts.append(chunk.decode(charset or 'utf-8', errors='replace'))
            except (LookupError, UnicodeError):
                parts.append(chunk.decode('utf-8', errors='replace'))
        else:
            parts.append(chunk)
    return ''.join(parts).strip()


def _normalize_date(value: str) -> str | None:
    if not value.strip():
        return None
    try:
        parsed = parsedate_to_datetime(value)
    except (TypeError, ValueError, IndexError, OverflowError):
        return None
    if parsed is None:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).isoformat().replace('+00:00', 'Z')


def _parse_mail_headers(
    header_bytes: bytes,
    source_name: str,
    offset: int,
    status_override: int | None = None,
) -> ThunderbirdMailItem | None:
    try:
        parser = BytesFeedParser(policy=policy.default)
        parser.feed(header_bytes)
        parser.feed(b'\r\n\r\n')
        message = parser.close()
        received_at = _normalize_date(_decode_header_value(message.get('Date', '')))
        if received_at is None:
            return None
        status = status_override if status_override is not None else _parse_status(_decode_header_value(message.get('X-Mozilla-Status', '')))
        if status & 0x0008:
            return None
        subject = _decode_header_value(message.get('Subject', '')) or '(제목 없음)'
        sender_header = _decode_header_value(message.get('From', ''))
        sender_name, sender_address = parseaddr(sender_header)
        sender_name = _decode_header_value(sender_name) or '(발신자 알 수 없음)'
        sender_address = sender_address.strip()
        message_id = _decode_header_value(message.get('Message-ID', '')) or None
        # Message-ID is normally unique, but duplicate Message-ID headers can
        # exist in a local store. Include the physical message location so the
        # normalized id remains unique for each stored message.
        seed = f'{message_id or ""}:{source_name}:{offset}:{received_at}'
        item_id = hashlib.sha256(seed.encode('utf-8', errors='replace')).hexdigest()[:24]
        return ThunderbirdMailItem(
            id=item_id,
            subject=subject,
            sender_name=sender_name,
            sender_address=sender_address,
            received_at=received_at,
            is_read=bool(status & 0x0001),
            message_id=message_id,
        )
    except (LookupError, TypeError, ValueError, UnicodeError):
        return None


def _iter_mbox_headers(handle: BinaryIO) -> Iterable[tuple[int, bytes]]:
    message_offset: int | None = None
    header_lines: list[bytes] = []
    reading_headers = False
    while True:
        line_offset = handle.tell()
        line = handle.readline()
        if not line:
            if message_offset is not None:
                yield message_offset, b''.join(header_lines)
            return
        if line.startswith(b'From '):
            if message_offset is not None:
                yield message_offset, b''.join(header_lines)
            message_offset = line_offset
            header_lines = []
            reading_headers = True
            continue
        if message_offset is None:
            message_offset = line_offset
            reading_headers = True
        if reading_headers:
            if line in (b'\r\n', b'\n'):
                reading_headers = False
            else:
                header_lines.append(line)


def _parse_mbox(path: Path) -> list[ThunderbirdMailItem]:
    items: list[ThunderbirdMailItem] = []
    with path.open('rb') as mbox_file:
        for offset, headers in _iter_mbox_headers(mbox_file):
            item = _parse_mail_headers(headers, path.name, offset)
            if item is not None:
                items.append(item)
    return items


def _header_block(handle: BinaryIO) -> bytes:
    lines: list[bytes] = []
    for line in handle:
        if line in (b'\r\n', b'\n'):
            break
        lines.append(line)
    return b''.join(lines)


def _parse_maildir(path: Path) -> list[ThunderbirdMailItem]:
    items: list[ThunderbirdMailItem] = []
    for folder_name in ('cur', 'new'):
        folder = path / folder_name
        if not folder.is_dir():
            continue
        for message_path in folder.iterdir():
            if not message_path.is_file():
                continue
            try:
                with message_path.open('rb') as message_file:
                    headers = _header_block(message_file)
            except OSError:
                continue
            flags = ''
            if ':2,' in message_path.name:
                flags = message_path.name.rsplit(':2,', 1)[1]
            item = _parse_mail_headers(
                headers,
                f'{folder_name}/{message_path.name}',
                0,
                status_override=0x0001 if 'S' in flags else 0,
            )
            if item is not None:
                items.append(item)
    return items


class _HTMLTextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []

    def handle_data(self, data: str) -> None:
        if data.strip():
            self.parts.append(data)


def _clean_body_text(value: str) -> str:
    lines: list[str] = []
    for line in value.replace('\x00', '').splitlines():
        normalized = re.sub(r'[ \t]+', ' ', line).strip()
        if normalized:
            lines.append(normalized)
    return '\n'.join(lines)[:MAX_MAIL_BODY_CHARS].strip()


def _decode_message_part(part: object) -> str:
    try:
        content = part.get_content()  # type: ignore[union-attr]
    except (LookupError, TypeError, UnicodeError):
        try:
            payload = part.get_payload(decode=True)  # type: ignore[union-attr]
            if isinstance(payload, bytes):
                return payload.decode('utf-8', errors='replace')
        except (TypeError, UnicodeError):
            return ''
        return ''
    return content if isinstance(content, str) else ''


def _message_body(raw_message: bytes) -> str:
    # BytesParser accepts a Unix mbox separator, but removing it also keeps the
    # parser behavior identical for mbox and maildir messages.
    if raw_message.startswith(b'From '):
        _, separator, raw_message = raw_message.partition(b'\n')
        if not separator:
            return ''
    try:
        message = BytesParser(policy=policy.default).parsebytes(raw_message)
    except (LookupError, TypeError, ValueError, UnicodeError):
        return ''

    plain_parts: list[str] = []
    html_parts: list[str] = []
    for part in message.walk():
        if (
            part.is_multipart()
            or str(part.get_content_disposition() or '').casefold() == 'attachment'
            or part.get_filename()
        ):
            continue
        content_type = str(part.get_content_type()).casefold()
        content = _decode_message_part(part)
        if not content:
            continue
        if content_type == 'text/plain':
            plain_parts.append(content)
        elif content_type == 'text/html':
            extractor = _HTMLTextExtractor()
            try:
                extractor.feed(content)
                extractor.close()
            except (TypeError, ValueError):
                continue
            html_parts.append(re.sub(r'\s+([,.;:!?%。！？])', r'\1', ' '.join(extractor.parts)))
    return _clean_body_text('\n'.join(plain_parts) if plain_parts else '\n'.join(html_parts))


def _read_mbox_message_at(handle: BinaryIO, offset: int) -> bytes:
    handle.seek(offset)
    first_line = handle.readline()
    if not first_line:
        return b''
    lines = [first_line]
    while True:
        line = handle.readline()
        if not line:
            break
        if line.startswith(b'From '):
            break
        lines.append(line)
    return b''.join(lines)


def _find_mbox_message(path: Path, mail_id: str) -> ThunderbirdMailMessage | None:
    with path.open('rb') as mbox_file:
        for offset, headers in _iter_mbox_headers(mbox_file):
            item = _parse_mail_headers(headers, path.name, offset)
            if item is None or item.id != mail_id:
                continue
            return ThunderbirdMailMessage(item, _message_body(_read_mbox_message_at(mbox_file, offset)))
    return None


def _find_maildir_message(path: Path, mail_id: str) -> ThunderbirdMailMessage | None:
    for folder_name in ('cur', 'new'):
        folder = path / folder_name
        if not folder.is_dir():
            continue
        try:
            entries = sorted(folder.iterdir(), key=lambda entry: entry.name.casefold())
        except OSError:
            continue
        for message_path in entries:
            if not message_path.is_file():
                continue
            try:
                raw_message = message_path.read_bytes()
            except OSError:
                continue
            item = _parse_mail_headers(
                raw_message.split(b'\r\n\r\n', 1)[0] if b'\r\n\r\n' in raw_message else raw_message.split(b'\n\n', 1)[0],
                f'{folder_name}/{message_path.name}',
                0,
                status_override=0x0001 if ':2,' in message_path.name and 'S' in message_path.name.rsplit(':2,', 1)[1] else 0,
            )
            if item is not None and item.id == mail_id:
                return ThunderbirdMailMessage(item, _message_body(raw_message))
    return None


def _cached_mbox(path: Path) -> list[ThunderbirdMailItem]:
    for attempt in range(2):
        try:
            before = path.stat()
        except OSError as exc:
            raise ThunderbirdMailError('parse_error') from exc
        cache_key = str(path)
        with _MBOX_CACHE_LOCK:
            cached = _MBOX_CACHE.get(cache_key)
        if cached and cached.modified_ns == before.st_mtime_ns and cached.size == before.st_size:
            return list(cached.items)
        try:
            items = _parse_mbox(path)
            after = path.stat()
        except (OSError, ValueError) as exc:
            raise ThunderbirdMailError('parse_error') from exc
        if before.st_mtime_ns == after.st_mtime_ns and before.st_size == after.st_size:
            with _MBOX_CACHE_LOCK:
                _MBOX_CACHE[cache_key] = _MboxCacheEntry(after.st_mtime_ns, after.st_size, tuple(items))
            return items
        if attempt == 1:
            raise ThunderbirdMailError('parse_error')
    raise ThunderbirdMailError('parse_error')


def _select_account(accounts: list[ThunderbirdAccount], requested: str) -> ThunderbirdAccount:
    if requested.strip():
        for account in accounts:
            if account.matches(requested):
                return account
        raise ThunderbirdMailError('account_not_found')
    for account in accounts:
        if account.account_type.casefold() != 'none' and (account.username or account.name):
            return account
    raise ThunderbirdMailError('account_not_found')


def _items_for_account(account: ThunderbirdAccount, profile_path: Path, limit: int, folder_id: str = 'inbox') -> list[ThunderbirdMailItem]:
    folder = find_folder(account, profile_path, folder_id)
    if folder is None or folder.path is None:
        raise ThunderbirdMailError('inbox_not_found' if folder_id == 'inbox' else 'folder_not_found')
    mailbox = folder.path
    if mailbox.is_file() and mailbox.stat().st_size == 0 and folder_id == 'inbox':
        raise ThunderbirdMailError('local_sync_required')

    if _is_maildir(mailbox):
        if account.store_contract_id and account.store_contract_id != MAILDIR_STORE_CONTRACT:
            raise ThunderbirdMailError('unsupported_store')
        items = _parse_maildir(mailbox)
    elif mailbox.is_file():
        if account.store_contract_id and account.store_contract_id not in ('', BERKELEY_STORE_CONTRACT):
            raise ThunderbirdMailError('unsupported_store')
        items = [] if mailbox.stat().st_size == 0 else _cached_mbox(mailbox)
    else:
        raise ThunderbirdMailError('unsupported_store')

    items.sort(key=lambda item: item.received_at, reverse=True)
    return items[:limit]


def _normalize_mail_id(value: object) -> str:
    if not isinstance(value, str):
        raise ThunderbirdMailError('mail_not_found', http_status=400)
    mail_id = value.strip()
    if not mail_id or len(mail_id) > 256 or not re.fullmatch(r'[A-Za-z0-9._:-]+', mail_id):
        raise ThunderbirdMailError('mail_not_found', http_status=400)
    return mail_id


def _find_mail_message_for_account(
    account: ThunderbirdAccount,
    profile_path: Path,
    mail_id: str,
    folder_id: str,
) -> ThunderbirdMailMessage | None:
    folder = find_folder(account, profile_path, folder_id)
    if folder is None or folder.path is None:
        raise ThunderbirdMailError('inbox_not_found' if folder_id == 'inbox' else 'folder_not_found')
    mailbox = folder.path
    if mailbox.is_file() and mailbox.stat().st_size == 0 and folder_id == 'inbox':
        raise ThunderbirdMailError('local_sync_required')
    if _is_maildir(mailbox):
        if account.store_contract_id and account.store_contract_id != MAILDIR_STORE_CONTRACT:
            raise ThunderbirdMailError('unsupported_store')
        return _find_maildir_message(mailbox, mail_id)
    if mailbox.is_file():
        if account.store_contract_id and account.store_contract_id not in ('', BERKELEY_STORE_CONTRACT):
            raise ThunderbirdMailError('unsupported_store')
        if mailbox.stat().st_size == 0:
            return None
        return _find_mbox_message(mailbox, mail_id)
    raise ThunderbirdMailError('unsupported_store')


def get_recent_mail(
    settings: ThunderbirdSettings,
    limit: object = DEFAULT_MAIL_LIMIT,
    folder: object = 'inbox',
) -> tuple[str, list[ThunderbirdMailItem]]:
    requested_limit = clamp_mail_limit(limit)
    requested_folder = normalize_folder_id(folder)
    profiles = resolve_profile_candidates(settings)
    account_error: ThunderbirdMailError | None = None
    for profile_path in profiles:
        accounts = discover_accounts(profile_path)
        if not accounts:
            continue
        try:
            account = _select_account(accounts, settings.account)
        except ThunderbirdMailError as exc:
            account_error = exc
            continue
        items = _items_for_account(account, profile_path, requested_limit, requested_folder)
        account_value = account.username or account.name
        return mask_account(account_value), items
    if account_error is not None:
        raise account_error
    raise ThunderbirdMailError('account_not_found')


def get_mail_message(
    settings: ThunderbirdSettings,
    mail_id: object,
    folder: object = 'inbox',
) -> tuple[str, ThunderbirdMailMessage]:
    requested_id = _normalize_mail_id(mail_id)
    requested_folder = normalize_folder_id(folder)
    profiles = resolve_profile_candidates(settings)
    account_error: ThunderbirdMailError | None = None
    for profile_path in profiles:
        accounts = discover_accounts(profile_path)
        if not accounts:
            continue
        try:
            account = _select_account(accounts, settings.account)
            message = _find_mail_message_for_account(account, profile_path, requested_id, requested_folder)
        except ThunderbirdMailError as exc:
            account_error = exc
            if exc.code in {'folder_not_found', 'inbox_not_found', 'local_sync_required', 'unsupported_store'}:
                raise
            continue
        if message is not None:
            account_value = account.username or account.name
            return mask_account(account_value), message
    if account_error is not None and account_error.code == 'account_not_found':
        raise account_error
    raise ThunderbirdMailError('mail_not_found', http_status=404)


def get_mail_folders(settings: ThunderbirdSettings) -> tuple[str, list[ThunderbirdFolder]]:
    profiles = resolve_profile_candidates(settings)
    account_error: ThunderbirdMailError | None = None
    for profile_path in profiles:
        accounts = discover_accounts(profile_path)
        if not accounts:
            continue
        try:
            account = _select_account(accounts, settings.account)
        except ThunderbirdMailError as exc:
            account_error = exc
            continue
        storage = account.storage_path(profile_path)
        if not storage.exists():
            raise ThunderbirdMailError('inbox_not_found')
        account_value = account.username or account.name
        return mask_account(account_value), discover_folders(account, profile_path)
    if account_error is not None:
        raise account_error
    raise ThunderbirdMailError('account_not_found')


def find_thunderbird_executable() -> Path | None:
    names = ('thunderbird.exe', 'thunderbird') if os.name == 'nt' else ('thunderbird',)
    for name in names:
        found = shutil.which(name)
        if found:
            return Path(found)
    for env_name in ('ProgramFiles', 'ProgramFiles(x86)', 'LOCALAPPDATA'):
        root = os.environ.get(env_name, '').strip()
        if not root:
            continue
        candidate = Path(root) / 'Mozilla Thunderbird' / ('thunderbird.exe' if os.name == 'nt' else 'thunderbird')
        if candidate.is_file():
            return candidate
    return None


def _normalize_message_id(value: object) -> str:
    if not isinstance(value, str):
        raise ThunderbirdMailError('parse_error', http_status=400)
    message_id = value.strip()
    if (
        not message_id
        or len(message_id) > 998
        or any(ord(character) < 32 or ord(character) == 127 for character in message_id)
    ):
        raise ThunderbirdMailError('parse_error', http_status=400)
    if message_id.startswith('<') or message_id.endswith('>'):
        if not (message_id.startswith('<') and message_id.endswith('>')):
            raise ThunderbirdMailError('parse_error', http_status=400)
        message_id = message_id[1:-1].strip()
    if not message_id or any(character.isspace() or character in '<>' for character in message_id):
        raise ThunderbirdMailError('parse_error', http_status=400)
    return message_id


def launch_thunderbird(message_id: str | None = None) -> None:
    executable = find_thunderbird_executable()
    if executable is None:
        raise ThunderbirdMailError('thunderbird_not_installed')
    try:
        if message_id is None and os.name == 'nt':
            os.startfile(str(executable))  # type: ignore[attr-defined]
            return
        args = [str(executable)]
        if message_id is not None:
            args.append(f'mid:{_normalize_message_id(message_id)}')
        subprocess.Popen(
            args,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            shell=False,
            start_new_session=os.name != 'nt',
        )
    except OSError as exc:
        raise ThunderbirdMailError('thunderbird_not_installed') from exc
