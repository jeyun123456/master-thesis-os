from __future__ import annotations

import json
import os
import re
import secrets
import smtplib
import ssl
import threading
import time
from dataclasses import dataclass
from email.message import EmailMessage
from email.utils import formataddr, formatdate, make_msgid, parseaddr
from pathlib import Path

from thunderbird_mail import (
    ThunderbirdAccount,
    ThunderbirdMailError,
    ThunderbirdSettings,
    discover_accounts,
    get_mail_message,
    mask_account,
    normalize_folder_id,
    resolve_profile_candidates,
)


PREVIEW_TTL_SECONDS = 10 * 60
MAX_SUBJECT_CHARS = 500
MAX_BODY_CHARS = 100_000
GENERIC_PREF_RE = re.compile(
    r'^user_pref\("(?P<key>[^"\\]+)",\s*(?P<value>.+)\);$'
)
SMTP_PREF_RE = re.compile(r'^mail\.smtpserver\.(?P<server>smtp\d+)\.(?P<name>[^.]+)$')
IDENTITY_PREF_RE = re.compile(r'^mail\.identity\.(?P<identity>id\d+)\.(?P<name>[^.]+)$')
ACCOUNT_IDENTITIES_RE = re.compile(r'^mail\.account\.(?P<account>account\d+)\.identities$')
SAFE_SMTP_FIELDS = {'hostname', 'port', 'socketType', 'authMethod', 'username', 'description'}
SAFE_IDENTITY_FIELDS = {'useremail', 'fullName', 'smtpServer'}
SAFE_GLOBAL_KEYS = {'mail.smtp.defaultserver'}


class ThunderbirdSendError(ThunderbirdMailError):
    MESSAGES = {
        'smtp_settings_not_found': 'Thunderbird SMTP 설정을 찾지 못했어.',
        'smtp_secret_missing': 'SMTP 발송 비밀번호가 설정되지 않았어.',
        'smtp_oauth2_unsupported': '이 SMTP 계정은 OAuth2라서 현재 방식으로 바로 발송할 수 없어.',
        'smtp_auth_failed': 'SMTP 인증에 실패했어.',
        'smtp_send_failed': 'SMTP로 메일을 보내지 못했어.',
        'invalid_recipient': '받는 사람 이메일 주소를 확인해줘.',
        'invalid_message': '메일 제목이나 본문을 확인해줘.',
        'reply_source_invalid': '답장할 원본 메일에 유효한 발신자 주소가 없어.',
        'confirmation_required': '메일 발송 전 미리보기 확인이 필요해.',
        'confirmation_expired': '메일 발송 확인이 만료됐어. 미리보기를 다시 만들어줘.',
        'confirmation_mismatch': '확인한 미리보기와 발송 내용이 달라.',
    }

    def __init__(self, code: str, http_status: int = 400):
        super().__init__(code, self.MESSAGES.get(code, code), http_status=http_status)


@dataclass(frozen=True)
class SmtpSettings:
    profile_path: Path
    server_id: str
    hostname: str
    port: int
    security: str
    auth_method: int
    username: str
    from_address: str
    from_name: str

    def status_dict(self) -> dict[str, object]:
        password_configured = bool(os.environ.get('THUNDERBIRD_SMTP_PASSWORD', '').strip())
        oauth2 = self.auth_method == 10
        needs_password = self.auth_method != 0
        ready = not oauth2 and (not needs_password or password_configured)
        return {
            'host': self.hostname,
            'port': self.port,
            'security': self.security,
            'authMethod': self.auth_method,
            'username': mask_account(self.username),
            'fromAddress': mask_account(self.from_address),
            'passwordConfigured': password_configured,
            'oauth2': oauth2,
            'ready': ready,
        }


@dataclass(frozen=True)
class OutgoingDraft:
    to_address: str
    subject: str
    body: str
    in_reply_to: str = ''

    def canonical(self, from_address: str) -> str:
        return json.dumps(
            {
                'from': from_address.strip().casefold(),
                'to': self.to_address.strip().casefold(),
                'subject': self.subject,
                'body': self.body,
                'inReplyTo': self.in_reply_to,
            },
            ensure_ascii=False,
            sort_keys=True,
            separators=(',', ':'),
        )

    def public_dict(self) -> dict[str, object]:
        result: dict[str, object] = {
            'to': self.to_address,
            'subject': self.subject,
            'body': self.body,
        }
        if self.in_reply_to:
            result['inReplyTo'] = self.in_reply_to
        return result


@dataclass(frozen=True)
class _PreviewEntry:
    canonical: str
    expires_at: float


_PREVIEWS: dict[str, _PreviewEntry] = {}
_PREVIEW_LOCK = threading.Lock()


def _parse_pref_value(raw: str) -> object:
    raw = raw.strip()
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return raw.strip('"')


def _read_safe_outgoing_prefs(profile_path: Path) -> dict[str, object]:
    prefs_path = profile_path / 'prefs.js'
    if not prefs_path.is_file():
        return {}
    result: dict[str, object] = {}
    try:
        with prefs_path.open('r', encoding='utf-8-sig', errors='replace') as handle:
            for raw_line in handle:
                match = GENERIC_PREF_RE.match(raw_line.strip())
                if not match:
                    continue
                key = match.group('key')
                smtp_match = SMTP_PREF_RE.match(key)
                identity_match = IDENTITY_PREF_RE.match(key)
                account_match = ACCOUNT_IDENTITIES_RE.match(key)
                allowed = (
                    key in SAFE_GLOBAL_KEYS
                    or bool(smtp_match and smtp_match.group('name') in SAFE_SMTP_FIELDS)
                    or bool(identity_match and identity_match.group('name') in SAFE_IDENTITY_FIELDS)
                    or bool(account_match)
                )
                if allowed:
                    result[key] = _parse_pref_value(match.group('value'))
    except OSError as exc:
        raise ThunderbirdSendError('smtp_settings_not_found', http_status=503) from exc
    return result


def _select_account(accounts: list[ThunderbirdAccount], requested: str) -> ThunderbirdAccount:
    if requested.strip():
        for account in accounts:
            if account.matches(requested):
                return account
        raise ThunderbirdSendError('smtp_settings_not_found', http_status=503)
    for account in accounts:
        if account.account_type.casefold() != 'none' and (account.username or account.name):
            return account
    raise ThunderbirdSendError('smtp_settings_not_found', http_status=503)


def _split_csv(value: object) -> list[str]:
    if not isinstance(value, str):
        return []
    return [part.strip() for part in value.split(',') if part.strip()]


def _as_int(value: object, default: int = 0) -> int:
    if isinstance(value, bool):
        return default
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        try:
            return int(value.strip())
        except ValueError:
            return default
    return default


def _security_from_socket_type(socket_type: int) -> str:
    if socket_type == 2:
        return 'ssl'
    if socket_type == 3:
        return 'starttls'
    return 'plain'


def _normalize_security(value: str) -> str:
    normalized = value.strip().casefold()
    if normalized in {'ssl', 'starttls', 'plain'}:
        return normalized
    raise ThunderbirdSendError('smtp_settings_not_found', http_status=503)


def _default_port(security: str) -> int:
    return 465 if security == 'ssl' else 587 if security == 'starttls' else 25


def _valid_address(value: str) -> bool:
    if not value or any(character in value for character in '\r\n'):
        return False
    _, address = parseaddr(value)
    if address != value.strip():
        return False
    local, separator, domain = address.rpartition('@')
    return bool(separator and local and domain and '.' in domain)


def _smtp_settings_for_profile(
    profile_path: Path,
    account: ThunderbirdAccount,
) -> SmtpSettings:
    prefs = _read_safe_outgoing_prefs(profile_path)
    identities = _split_csv(prefs.get(f'mail.account.{account.account_id}.identities', ''))
    selected_identity = identities[0] if identities else ''
    server_id = ''
    from_address = ''
    from_name = ''
    if selected_identity:
        server_id = str(prefs.get(f'mail.identity.{selected_identity}.smtpServer', '') or '').strip()
        from_address = str(prefs.get(f'mail.identity.{selected_identity}.useremail', '') or '').strip()
        from_name = str(prefs.get(f'mail.identity.{selected_identity}.fullName', '') or '').strip()
    if not server_id:
        server_id = str(prefs.get('mail.smtp.defaultserver', '') or '').strip()

    env_host = os.environ.get('THUNDERBIRD_SMTP_HOST', '').strip()
    env_port = os.environ.get('THUNDERBIRD_SMTP_PORT', '').strip()
    env_security = os.environ.get('THUNDERBIRD_SMTP_SECURITY', '').strip()
    env_username = os.environ.get('THUNDERBIRD_SMTP_USERNAME', '').strip()
    env_from = os.environ.get('THUNDERBIRD_SMTP_FROM', '').strip()
    env_from_name = os.environ.get('THUNDERBIRD_SMTP_FROM_NAME', '').strip()

    prefix = f'mail.smtpserver.{server_id}.' if server_id else ''
    hostname = env_host or str(prefs.get(prefix + 'hostname', '') or '').strip()
    username = env_username or str(prefs.get(prefix + 'username', '') or '').strip() or account.username.strip()
    socket_type = _as_int(prefs.get(prefix + 'socketType', 0))
    auth_method = _as_int(prefs.get(prefix + 'authMethod', 0))
    security = _normalize_security(env_security) if env_security else _security_from_socket_type(socket_type)
    port = _as_int(env_port, 0) if env_port else _as_int(prefs.get(prefix + 'port', 0), 0)
    if port <= 0:
        port = _default_port(security)

    from_address = env_from or from_address or account.username.strip()
    from_name = env_from_name or from_name or account.name.strip()
    if not hostname or not _valid_address(from_address):
        raise ThunderbirdSendError('smtp_settings_not_found', http_status=503)
    return SmtpSettings(
        profile_path=profile_path,
        server_id=server_id,
        hostname=hostname,
        port=port,
        security=security,
        auth_method=auth_method,
        username=username,
        from_address=from_address,
        from_name=from_name,
    )


def resolve_smtp_settings(settings: ThunderbirdSettings) -> SmtpSettings:
    last_error: ThunderbirdMailError | None = None
    for profile_path in resolve_profile_candidates(settings):
        accounts = discover_accounts(profile_path)
        if not accounts:
            continue
        try:
            account = _select_account(accounts, settings.account)
            return _smtp_settings_for_profile(profile_path, account)
        except ThunderbirdMailError as exc:
            last_error = exc
            continue
    if last_error is not None:
        raise last_error
    raise ThunderbirdSendError('smtp_settings_not_found', http_status=503)


def get_smtp_status(settings: ThunderbirdSettings) -> dict[str, object]:
    smtp = resolve_smtp_settings(settings)
    return {
        'ok': True,
        'source': 'thunderbird',
        'smtp': smtp.status_dict(),
    }


def _normalize_subject(value: object) -> str:
    if not isinstance(value, str):
        raise ThunderbirdSendError('invalid_message')
    subject = value.strip()
    if not subject or len(subject) > MAX_SUBJECT_CHARS or any(character in subject for character in '\r\n'):
        raise ThunderbirdSendError('invalid_message')
    return subject


def _normalize_body(value: object) -> str:
    if not isinstance(value, str):
        raise ThunderbirdSendError('invalid_message')
    body = value.replace('\r\n', '\n').replace('\r', '\n').strip()
    if not body or len(body) > MAX_BODY_CHARS:
        raise ThunderbirdSendError('invalid_message')
    return body


def _reply_subject(subject: str) -> str:
    cleaned = subject.strip() or '(제목 없음)'
    return cleaned if re.match(r'^\s*re\s*:', cleaned, flags=re.IGNORECASE) else f'Re: {cleaned}'


def _normalize_message_id(value: str | None) -> str:
    if not value:
        return ''
    message_id = value.strip()
    if not message_id:
        return ''
    if not message_id.startswith('<'):
        message_id = '<' + message_id
    if not message_id.endswith('>'):
        message_id += '>'
    if any(character in message_id for character in '\r\n'):
        return ''
    return message_id


def build_draft(settings: ThunderbirdSettings, request: dict[str, object]) -> OutgoingDraft:
    body = _normalize_body(request.get('body'))
    reply_to_mail_id = request.get('replyToMailId')
    if isinstance(reply_to_mail_id, str) and reply_to_mail_id.strip():
        folder = normalize_folder_id(request.get('folder', 'inbox'))
        _, source = get_mail_message(settings, reply_to_mail_id, folder)
        recipient = source.item.sender_address.strip()
        if not _valid_address(recipient):
            raise ThunderbirdSendError('reply_source_invalid')
        subject_value = request.get('subject')
        subject = _normalize_subject(subject_value) if isinstance(subject_value, str) and subject_value.strip() else _reply_subject(source.item.subject)
        return OutgoingDraft(
            to_address=recipient,
            subject=subject,
            body=body,
            in_reply_to=_normalize_message_id(source.item.message_id),
        )

    recipient = request.get('to')
    if not isinstance(recipient, str) or not _valid_address(recipient.strip()):
        raise ThunderbirdSendError('invalid_recipient')
    return OutgoingDraft(
        to_address=recipient.strip(),
        subject=_normalize_subject(request.get('subject')),
        body=body,
    )


def _prune_previews(now: float) -> None:
    expired = [token for token, entry in _PREVIEWS.items() if entry.expires_at <= now]
    for token in expired:
        _PREVIEWS.pop(token, None)


def preview_mail(settings: ThunderbirdSettings, request: dict[str, object]) -> dict[str, object]:
    smtp = resolve_smtp_settings(settings)
    draft = build_draft(settings, request)
    canonical = draft.canonical(smtp.from_address)
    token = secrets.token_urlsafe(24)
    now = time.monotonic()
    with _PREVIEW_LOCK:
        _prune_previews(now)
        _PREVIEWS[token] = _PreviewEntry(canonical=canonical, expires_at=now + PREVIEW_TTL_SECONDS)
    return {
        'ok': True,
        'source': 'thunderbird',
        'preview': {
            'from': smtp.from_address,
            **draft.public_dict(),
        },
        'confirmationToken': token,
        'expiresInSeconds': PREVIEW_TTL_SECONDS,
        'smtp': smtp.status_dict(),
    }


def _consume_confirmation(token: object, canonical: str) -> None:
    if not isinstance(token, str) or not token.strip():
        raise ThunderbirdSendError('confirmation_required', http_status=409)
    now = time.monotonic()
    with _PREVIEW_LOCK:
        _prune_previews(now)
        entry = _PREVIEWS.pop(token.strip(), None)
    if entry is None:
        raise ThunderbirdSendError('confirmation_expired', http_status=409)
    if not secrets.compare_digest(entry.canonical, canonical):
        raise ThunderbirdSendError('confirmation_mismatch', http_status=409)


def _build_message(smtp: SmtpSettings, draft: OutgoingDraft) -> EmailMessage:
    message = EmailMessage()
    message['From'] = formataddr((smtp.from_name, smtp.from_address)) if smtp.from_name else smtp.from_address
    message['To'] = draft.to_address
    message['Subject'] = draft.subject
    message['Date'] = formatdate(localtime=True)
    message['Message-ID'] = make_msgid()
    if draft.in_reply_to:
        message['In-Reply-To'] = draft.in_reply_to
        message['References'] = draft.in_reply_to
    message.set_content(draft.body)
    return message


def _smtp_login(client: smtplib.SMTP, smtp: SmtpSettings) -> None:
    if smtp.auth_method == 10:
        raise ThunderbirdSendError('smtp_oauth2_unsupported', http_status=503)
    if smtp.auth_method == 0:
        return
    password = os.environ.get('THUNDERBIRD_SMTP_PASSWORD', '')
    if not password:
        raise ThunderbirdSendError('smtp_secret_missing', http_status=503)
    if not smtp.username:
        raise ThunderbirdSendError('smtp_settings_not_found', http_status=503)
    try:
        client.login(smtp.username, password)
    except smtplib.SMTPAuthenticationError as exc:
        raise ThunderbirdSendError('smtp_auth_failed', http_status=503) from exc


def _send_smtp(smtp: SmtpSettings, draft: OutgoingDraft) -> None:
    message = _build_message(smtp, draft)
    context = ssl.create_default_context()
    try:
        if smtp.security == 'ssl':
            with smtplib.SMTP_SSL(smtp.hostname, smtp.port, timeout=20, context=context) as client:
                _smtp_login(client, smtp)
                client.send_message(message, from_addr=smtp.from_address, to_addrs=[draft.to_address])
            return

        with smtplib.SMTP(smtp.hostname, smtp.port, timeout=20) as client:
            client.ehlo()
            if smtp.security == 'starttls':
                client.starttls(context=context)
                client.ehlo()
            _smtp_login(client, smtp)
            client.send_message(message, from_addr=smtp.from_address, to_addrs=[draft.to_address])
    except ThunderbirdSendError:
        raise
    except smtplib.SMTPAuthenticationError as exc:
        raise ThunderbirdSendError('smtp_auth_failed', http_status=503) from exc
    except (OSError, smtplib.SMTPException) as exc:
        raise ThunderbirdSendError('smtp_send_failed', http_status=503) from exc


def send_confirmed_mail(settings: ThunderbirdSettings, request: dict[str, object]) -> dict[str, object]:
    smtp = resolve_smtp_settings(settings)
    draft = build_draft(settings, request)
    _consume_confirmation(request.get('confirmationToken'), draft.canonical(smtp.from_address))
    _send_smtp(smtp, draft)
    return {
        'ok': True,
        'source': 'thunderbird',
        'sent': {
            'from': mask_account(smtp.from_address),
            'to': mask_account(draft.to_address),
            'subject': draft.subject,
            'reply': bool(draft.in_reply_to),
        },
    }
