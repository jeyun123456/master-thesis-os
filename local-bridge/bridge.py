import json
import os
import platform
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit

from bridge_config import CONFIG_ERROR_EXIT_CODE, ConfigError, load_bridge_config, resolve_config_path
from bridge_security import allows_private_network, target_for_endpoint, token_matches
from thunderbird_mail import (
    ThunderbirdMailError,
    clamp_mail_limit,
    get_mail_folders,
    get_mail_message,
    get_recent_mail,
    launch_thunderbird,
    normalize_folder_id,
)


HERE = Path(__file__).resolve().parent
CONFIG = resolve_config_path(HERE)
MAX_BODY_BYTES = 16 * 1024
MAIL_PATH_PREFIX = '/mail/'


def _configure_utf8() -> None:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding='utf-8', errors='replace')
        except (AttributeError, ValueError):
            pass


_configure_utf8()

try:
    bridge_config = load_bridge_config(CONFIG)
except ConfigError as exc:
    print(str(exc), file=sys.stderr)
    raise SystemExit(CONFIG_ERROR_EXIT_CODE) from exc

import mail_cli
import mail_db
import portal_db
from shortcut_launcher import launch_shortcut, normalize_shortcut_request

mail_cli.load_local_env((bridge_config.root, bridge_config.root / 'master-thesis-os'))

ROOT = bridge_config.root
TOKEN = bridge_config.token
PORT = bridge_config.port
ORIGINS = bridge_config.origins


def _resolve_bridge_db_path():
    if os.environ.get('MAIL_ANALYSIS_DB_PATH', '').strip():
        return mail_db.resolve_db_path()
    for root in (bridge_config.root, bridge_config.root / 'master-thesis-os'):
        source_directory = root / 'local-bridge'
        if (source_directory / 'mail_db.py').is_file():
            return (source_directory / 'data' / 'mail-analysis.db').resolve(strict=False)
    return mail_db.resolve_db_path()


DB_PATH = _resolve_bridge_db_path()


def _resolve_portal_db_path():
    if os.environ.get('PORTAL_NOTICES_DB_PATH', '').strip():
        return portal_db.resolve_db_path()
    for root in (bridge_config.root, bridge_config.root / 'master-thesis-os'):
        source_directory = root / 'local-bridge'
        if (source_directory / 'portal_db.py').is_file():
            return (source_directory / 'data' / 'portal-notices.db').resolve(strict=False)
    return portal_db.resolve_db_path()


PORTAL_DB_PATH = _resolve_portal_db_path()

MAIL_JOB_LOCK = threading.Lock()
MAIL_JOB_THREAD: threading.Thread | None = None
MAIL_JOB_KIND: str | None = None
MAIL_JOB_ERROR: str | None = None
PORTAL_JOB_LOCK = threading.Lock()
PORTAL_JOB_THREAD: threading.Thread | None = None
PORTAL_JOB_KIND: str | None = None
PORTAL_JOB_ERROR: str | None = None
PORTAL_JOB_ERROR_CODE: str | None = None


def launch(path: Path):
    system = platform.system()
    if system == 'Windows':
        os.startfile(str(path))
    elif system == 'Darwin':
        subprocess.Popen(['open', str(path)])
    else:
        subprocess.Popen(['xdg-open', str(path)])


def _mail_job_active() -> bool:
    return MAIL_JOB_THREAD is not None and MAIL_JOB_THREAD.is_alive()


def _remember_job_end(error: str | None = None) -> None:
    global MAIL_JOB_THREAD, MAIL_JOB_KIND, MAIL_JOB_ERROR
    with MAIL_JOB_LOCK:
        MAIL_JOB_THREAD = None
        MAIL_JOB_KIND = None
        MAIL_JOB_ERROR = error


def _run_sync_job() -> None:
    try:
        mail_cli.sync_mail(bridge_config.thunderbird, DB_PATH)
    except Exception:
        # The database contains per-folder progress. Keep the public error
        # deliberately generic so paths, mail content, and provider details do
        # not enter bridge output or logs.
        message = '메일 동기화 작업이 중단되었어.'
        for folder in mail_db.TARGET_FOLDERS:
            try:
                mail_db.fail_sync_folder(folder, mail_db.now_iso(), message, DB_PATH)
            except mail_db.MailDatabaseError:
                pass
        _remember_job_end(message)
    else:
        _remember_job_end()


def _run_reanalyze_job(mail_id: str) -> None:
    try:
        mail_cli.reanalyze_mail(mail_id, mail_cli.load_settings(), DB_PATH)
    except Exception:
        try:
            _api_url, _api_key, model = mail_cli._provider_config()
            mail_db.save_failed(mail_id, '메일 재분석 작업이 중단되었어.', mail_cli.PROMPT_VERSION, model, DB_PATH)
        except Exception:
            pass
        _remember_job_end('메일 재분석 작업이 중단되었어.')
    else:
        _remember_job_end()


def start_sync_job() -> bool:
    global MAIL_JOB_THREAD, MAIL_JOB_KIND, MAIL_JOB_ERROR
    with MAIL_JOB_LOCK:
        if _mail_job_active():
            return False
        MAIL_JOB_ERROR = None
        MAIL_JOB_KIND = 'sync'
        MAIL_JOB_THREAD = threading.Thread(target=_run_sync_job, name='mail-sync', daemon=True)
        MAIL_JOB_THREAD.start()
        return True


def start_reanalyze_job(mail_id: str) -> bool:
    global MAIL_JOB_THREAD, MAIL_JOB_KIND, MAIL_JOB_ERROR
    with MAIL_JOB_LOCK:
        if _mail_job_active():
            return False
        MAIL_JOB_ERROR = None
        MAIL_JOB_KIND = 'reanalyze'
        MAIL_JOB_THREAD = threading.Thread(target=_run_reanalyze_job, args=(mail_id,), name='mail-reanalyze', daemon=True)
        MAIL_JOB_THREAD.start()
        return True


def _portal_job_active() -> bool:
    return PORTAL_JOB_THREAD is not None and PORTAL_JOB_THREAD.is_alive()


def _remember_portal_job_end(error: str | None = None, error_code: str | None = None) -> None:
    global PORTAL_JOB_THREAD, PORTAL_JOB_KIND, PORTAL_JOB_ERROR, PORTAL_JOB_ERROR_CODE
    with PORTAL_JOB_LOCK:
        PORTAL_JOB_THREAD = None
        PORTAL_JOB_KIND = None
        PORTAL_JOB_ERROR = error
        PORTAL_JOB_ERROR_CODE = error_code


def _run_portal_sync_job() -> None:
    try:
        from portal_cli import sync_portal

        sync_portal(ROOT, PORTAL_DB_PATH)
    except Exception as exc:
        code = getattr(exc, 'code', 'parsing_failed')
        message = getattr(exc, 'message', '학교 공지 동기화가 중단되었어.')
        _remember_portal_job_end(message, code)
    else:
        _remember_portal_job_end()


def _run_portal_login_job() -> None:
    try:
        from portal_cli import login_portal

        login_portal(ROOT)
    except Exception as exc:
        code = getattr(exc, 'code', 'portal_unreachable')
        message = getattr(exc, 'message', '학교 포털 로그인 창을 처리하지 못했어.')
        _remember_portal_job_end(message, code)
    else:
        _remember_portal_job_end()


def _run_portal_ai_job(notice_id: str) -> None:
    try:
        import portal_ai

        notice = portal_db.get_notice(notice_id, PORTAL_DB_PATH)
        if notice is None:
            raise portal_ai.PortalAIError('공지 상세를 찾지 못했어.', 'notice_not_found')
        if not portal_db.claim_notice_analysis(notice_id, PORTAL_DB_PATH):
            raise portal_ai.PortalAIError('공지 AI 분석 작업을 시작하지 못했어.', 'ai_job_already_running')
        result = portal_ai.analyze_notice(notice)
        portal_db.save_notice_analysis(
            notice_id,
            result,
            portal_ai.PROMPT_VERSION,
            portal_ai.provider_model(),
            portal_db.now_iso(),
            PORTAL_DB_PATH,
        )
    except Exception as exc:
        code = getattr(exc, 'code', 'ai_provider_failed')
        message = getattr(exc, 'message', str(exc) or '공지 AI 분석이 중단되었어.')
        try:
            portal_db.save_notice_analysis_failed(notice_id, code, message, PORTAL_DB_PATH)
        except Exception:
            pass
        _remember_portal_job_end(message, code)
    else:
        _remember_portal_job_end()


def start_portal_sync_job() -> bool:
    global PORTAL_JOB_THREAD, PORTAL_JOB_KIND, PORTAL_JOB_ERROR, PORTAL_JOB_ERROR_CODE
    with PORTAL_JOB_LOCK:
        if _portal_job_active():
            return False
        PORTAL_JOB_ERROR = None
        PORTAL_JOB_ERROR_CODE = None
        PORTAL_JOB_KIND = 'sync'
        PORTAL_JOB_THREAD = threading.Thread(target=_run_portal_sync_job, name='portal-sync', daemon=True)
        PORTAL_JOB_THREAD.start()
        return True


def start_portal_login_job() -> bool:
    global PORTAL_JOB_THREAD, PORTAL_JOB_KIND, PORTAL_JOB_ERROR, PORTAL_JOB_ERROR_CODE
    with PORTAL_JOB_LOCK:
        if _portal_job_active():
            return False
        PORTAL_JOB_ERROR = None
        PORTAL_JOB_ERROR_CODE = None
        PORTAL_JOB_KIND = 'login'
        PORTAL_JOB_THREAD = threading.Thread(target=_run_portal_login_job, name='portal-login', daemon=True)
        PORTAL_JOB_THREAD.start()
        return True


def start_portal_notice_analysis(notice_id: str, *, force: bool = False) -> bool:
    global PORTAL_JOB_THREAD, PORTAL_JOB_KIND, PORTAL_JOB_ERROR, PORTAL_JOB_ERROR_CODE
    with PORTAL_JOB_LOCK:
        if _portal_job_active():
            return False
        if not portal_db.queue_notice_analysis(notice_id, PORTAL_DB_PATH, force=force):
            return False
        PORTAL_JOB_ERROR = None
        PORTAL_JOB_ERROR_CODE = None
        PORTAL_JOB_KIND = 'ai'
        PORTAL_JOB_THREAD = threading.Thread(
            target=_run_portal_ai_job,
            args=(notice_id,),
            name='portal-ai-analysis',
            daemon=True,
        )
        PORTAL_JOB_THREAD.start()
        return True


def _safe_query_int(values: dict[str, list[str]], key: str, default: int) -> int:
    raw = values.get(key, [str(default)])[0]
    try:
        return int(raw)
    except (TypeError, ValueError):
        return default


class Handler(BaseHTTPRequestHandler):
    def cors(self):
        origin = self.headers.get('Origin', '')
        if origin in ORIGINS:
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Vary', 'Origin')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, X-Bridge-Token')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS, GET')
        if allows_private_network(self.headers.get('Access-Control-Request-Private-Network', '')):
            self.send_header('Access-Control-Allow-Private-Network', 'true')

    def json_out(self, status, obj):
        data = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.cors()
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        origin = self.headers.get('Origin', '')
        if origin not in ORIGINS:
            print('[bridge] rejected preflight origin', file=sys.stderr, flush=True)
        self.send_response(204)
        self.cors()
        self.end_headers()

    def _path(self) -> str:
        return urlsplit(self.path).path

    def _query(self) -> dict[str, list[str]]:
        return parse_qs(urlsplit(self.path).query, keep_blank_values=True)

    def _origin_allowed(self) -> bool:
        origin = self.headers.get('Origin', '')
        if origin in ORIGINS:
            return True
        print('[bridge] rejected origin', file=sys.stderr, flush=True)
        self.json_out(403, {'error': 'origin not allowed'})
        return False

    def _header_authenticated(self) -> bool:
        if not self._origin_allowed():
            return False
        if not token_matches(self.headers.get('X-Bridge-Token', ''), TOKEN):
            self.json_out(403, {'error': 'invalid token'})
            return False
        return True

    def _read_json_body(self) -> dict[str, object] | None:
        if self.headers.get_content_type() != 'application/json':
            self.json_out(415, {'error': 'application/json required'})
            return None
        try:
            length = int(self.headers.get('Content-Length', '0'))
        except (TypeError, ValueError):
            length = 0
        if length <= 0 or length > MAX_BODY_BYTES:
            self.json_out(413, {'error': 'invalid request size'})
            return None
        try:
            value = json.loads(self.rfile.read(length))
        except (UnicodeDecodeError, json.JSONDecodeError, ValueError):
            self.json_out(400, {'error': 'invalid JSON'})
            return None
        if not isinstance(value, dict):
            self.json_out(400, {'error': 'JSON object required'})
            return None
        return value

    def _mail_status(self):
        status = mail_db.sync_status(DB_PATH)
        with MAIL_JOB_LOCK:
            active = _mail_job_active()
            job_kind = MAIL_JOB_KIND
            job_error = MAIL_JOB_ERROR
        return {
            'ok': True,
            'source': 'sqlite',
            **status,
            'jobRunning': active,
            **({'jobKind': job_kind} if job_kind else {}),
            **({'jobError': job_error} if job_error else {}),
        }

    def _portal_status(self):
        try:
            from portal_client import profile_session_state, resolve_profile_path

            session_state = profile_session_state(resolve_profile_path(ROOT))
        except Exception:
            session_state = 'unknown'
        with PORTAL_JOB_LOCK:
            active = _portal_job_active()
            job_kind = PORTAL_JOB_KIND
            job_error = PORTAL_JOB_ERROR
            job_error_code = PORTAL_JOB_ERROR_CODE
        if not active and job_kind is None:
            # A Bridge restart loses the in-memory worker flag while SQLite
            # may still contain the previous run's `running` state. Recover
            # that stale state before exposing status to the UI.
            portal_db.recover_interrupted_sync(PORTAL_DB_PATH)
            portal_db.recover_interrupted_ai(PORTAL_DB_PATH)
        status = portal_db.sync_status(PORTAL_DB_PATH)
        persisted_error_code = status.get('lastErrorCode')
        effective_error_code = job_error_code or persisted_error_code
        if effective_error_code in {'login_required', 'session_expired'}:
            session_state = effective_error_code
        return {
            'ok': True,
            **status,
            'source': 'sqlite',
            'session': {'state': session_state},
            'jobRunning': active,
            **({'jobKind': job_kind} if job_kind else {}),
            **({'jobError': job_error} if job_error else {}),
            **({'jobErrorCode': job_error_code} if job_error_code else {}),
        }

    def _portal_notices_response(self):
        query = self._query()
        type_values = query.get('type', [])
        notice_type = type_values[0].strip().upper() if type_values else None
        if notice_type == '':
            notice_type = None
        if notice_type is not None and notice_type not in portal_db.NOTICE_TYPES:
            return self.json_out(400, {'ok': False, 'source': 'sqlite', 'error': 'unsupported portal notice type'})
        department_values = query.get('department', [])
        department = department_values[0].strip() if department_values else None
        if department == '':
            department = None
        limit = max(1, min(500, _safe_query_int(query, 'limit', 100)))
        items = portal_db.list_notices(
            PORTAL_DB_PATH,
            notice_type=notice_type,
            department=department,
            limit=limit,
        )
        return self.json_out(200, {
            'ok': True,
            'source': 'sqlite',
            'items': items,
            'departments': portal_db.notice_departments(PORTAL_DB_PATH),
            'sync': self._portal_status(),
        })

    def _single_portal_notice_response(self, notice_id: str):
        if not notice_id or len(notice_id) > 512:
            return self.json_out(400, {'ok': False, 'source': 'sqlite', 'error': 'notice not found'})
        item = portal_db.get_notice(notice_id, PORTAL_DB_PATH)
        if item is None:
            return self.json_out(404, {'ok': False, 'source': 'sqlite', 'error': 'notice not found'})
        return self.json_out(200, {'ok': True, 'source': 'sqlite', 'item': item})

    def _analysis_response(self):
        query = self._query()
        folder_values = query.get('folder', [])
        folder = folder_values[0].strip() if folder_values else None
        if folder == '':
            folder = None
        if folder is not None and folder not in mail_db.TARGET_FOLDERS:
            return self.json_out(400, {'ok': False, 'source': 'sqlite', 'error': 'unsupported mail analysis folder'})
        limit = max(1, min(100, _safe_query_int(query, 'limit', 100)))
        items = mail_db.list_analysis(DB_PATH, folder=folder, limit=limit)
        return self.json_out(200, {
            'ok': True,
            'source': 'sqlite',
            'folders': list(mail_db.TARGET_FOLDERS),
            'items': items,
            'sync': self._mail_status(),
        })

    def _planning_response(self):
        return self.json_out(200, {
            'ok': True,
            'source': 'sqlite',
            'folders': list(mail_db.TARGET_FOLDERS),
            'tasks': mail_db.list_tasks(DB_PATH, limit=200),
            'items': mail_db.list_analysis(DB_PATH, limit=100),
            'sync': self._mail_status(),
        })

    def _single_analysis_response(self, mail_id: str):
        if not mail_id or len(mail_id) > 256:
            return self.json_out(400, {'ok': False, 'source': 'sqlite', 'error': 'mail not found'})
        item = mail_db.get_analysis(DB_PATH, mail_id)
        if item is None:
            return self.json_out(404, {'ok': False, 'source': 'sqlite', 'error': 'mail not found'})
        return self.json_out(200, {'ok': True, 'source': 'sqlite', 'item': item})

    def do_GET(self):
        path = self._path()
        if path == '/health':
            return self.json_out(200, {'ok': True})
        if path == '/portal/status':
            if not self._header_authenticated():
                return
            try:
                return self.json_out(200, self._portal_status())
            except portal_db.PortalDatabaseError:
                return self.json_out(503, {'ok': False, 'source': 'sqlite', 'error': 'database_error'})
        if path == '/portal/notices':
            if not self._header_authenticated():
                return
            try:
                return self._portal_notices_response()
            except portal_db.PortalDatabaseError:
                return self.json_out(503, {'ok': False, 'source': 'sqlite', 'error': 'database_error'})
        if path.startswith('/portal/notices/'):
            if not self._header_authenticated():
                return
            notice_id = unquote(path[len('/portal/notices/'):])
            try:
                return self._single_portal_notice_response(notice_id)
            except portal_db.PortalDatabaseError:
                return self.json_out(503, {'ok': False, 'source': 'sqlite', 'error': 'database_error'})
        if path == '/mail/sync-status':
            if not self._header_authenticated():
                return
            try:
                return self.json_out(200, self._mail_status())
            except mail_db.MailDatabaseError:
                return self.json_out(503, {'ok': False, 'source': 'sqlite', 'error': 'database_unavailable'})
        if path == '/mail/analysis':
            if not self._header_authenticated():
                return
            try:
                return self._analysis_response()
            except mail_db.MailDatabaseError:
                return self.json_out(503, {'ok': False, 'source': 'sqlite', 'error': 'database_unavailable'})
        if path == '/mail/planning':
            if not self._header_authenticated():
                return
            try:
                return self._planning_response()
            except mail_db.MailDatabaseError:
                return self.json_out(503, {'ok': False, 'source': 'sqlite', 'error': 'database_unavailable'})
        if path.startswith('/mail/analysis/'):
            if not self._header_authenticated():
                return
            mail_id = unquote(path[len('/mail/analysis/'):])
            try:
                return self._single_analysis_response(mail_id)
            except mail_db.MailDatabaseError:
                return self.json_out(503, {'ok': False, 'source': 'sqlite', 'error': 'database_unavailable'})
        return self.json_out(404, {'error': 'not found'})

    def _legacy_mail_post(self, path: str, body: dict[str, object]):
        if path == '/mail/recent':
            try:
                folder = normalize_folder_id(body.get('folder', 'inbox'))
                account, items = get_recent_mail(bridge_config.thunderbird, clamp_mail_limit(body.get('limit', 5)), folder)
            except ThunderbirdMailError as exc:
                return self.json_out(exc.http_status, {'ok': False, 'source': 'thunderbird', 'error': exc.code})
            return self.json_out(200, {
                'ok': True,
                'source': 'thunderbird',
                'account': account,
                'folder': folder,
                'items': [item.to_dict() for item in items],
            })
        if path == '/mail/folders':
            try:
                account, folders = get_mail_folders(bridge_config.thunderbird)
            except ThunderbirdMailError as exc:
                return self.json_out(exc.http_status, {'ok': False, 'source': 'thunderbird', 'error': exc.code})
            return self.json_out(200, {
                'ok': True,
                'source': 'thunderbird',
                'account': account,
                'folders': [folder.to_dict() for folder in folders],
            })
        if path == '/mail/message':
            try:
                folder = normalize_folder_id(body.get('folder', 'inbox'))
                account, message = get_mail_message(bridge_config.thunderbird, body.get('mailId'), folder)
            except ThunderbirdMailError as exc:
                return self.json_out(exc.http_status, {'ok': False, 'source': 'thunderbird', 'error': exc.code})
            return self.json_out(200, {
                'ok': True,
                'source': 'thunderbird',
                'account': account,
                'folder': folder,
                'item': message.item.to_dict(),
                'body': message.body,
            })
        if path == '/mail/open':
            try:
                message_id = body.get('messageId') if 'messageId' in body else None
                launch_thunderbird(message_id)
            except ThunderbirdMailError as exc:
                return self.json_out(exc.http_status, {'ok': False, 'source': 'thunderbird', 'error': exc.code})
            return self.json_out(200, {'ok': True, 'source': 'thunderbird'})
        return None

    def _analysis_post(self, path: str, body: dict[str, object]):
        if path == '/mail/sync':
            if not start_sync_job():
                return self.json_out(409, {'ok': False, 'source': 'sqlite', 'error': 'sync_already_running'})
            return self.json_out(202, {'ok': True, 'source': 'sqlite', 'status': 'running', 'jobKind': 'sync'})

        if path == '/mail/analysis/candidate':
            mail_id = body.get('mailId')
            candidate_id = body.get('candidateId')
            status = body.get('status')
            if not all(isinstance(value, str) and value.strip() for value in (mail_id, candidate_id, status)):
                return self.json_out(400, {'ok': False, 'source': 'sqlite', 'error': 'invalid candidate request'})
            try:
                candidate = mail_db.update_candidate(
                    mail_id.strip(),
                    candidate_id.strip(),
                    status.strip(),
                    title=body.get('title') if isinstance(body.get('title'), str) else None,
                    start=body.get('start') if isinstance(body.get('start'), str) else None,
                    end=body.get('end') if isinstance(body.get('end'), str) else None,
                    all_day=body.get('allDay') if isinstance(body.get('allDay'), bool) else None,
                    calendar_event_id=body.get('calendarEventId') if isinstance(body.get('calendarEventId'), str) else None,
                    path=DB_PATH,
                )
            except mail_db.MailDatabaseError as exc:
                return self.json_out(404 if 'not found' in str(exc) else 400, {'ok': False, 'source': 'sqlite', 'error': str(exc)})
            return self.json_out(200, {'ok': True, 'source': 'sqlite', 'candidate': candidate})

        if path == '/mail/task':
            task_id = body.get('taskId')
            status = body.get('status')
            if not isinstance(task_id, str) or not task_id.strip() or len(task_id) > 256 or not isinstance(status, str) or not status.strip():
                return self.json_out(400, {'ok': False, 'source': 'sqlite', 'error': 'invalid mail task request'})
            try:
                task = mail_db.update_task(
                    task_id.strip(),
                    status.strip(),
                    title=body.get('title') if isinstance(body.get('title'), str) else None,
                    description=body.get('description') if isinstance(body.get('description'), str) else None,
                    due_at=body.get('dueAt') if isinstance(body.get('dueAt'), str) else None,
                    path=DB_PATH,
                )
            except mail_db.MailDatabaseError as exc:
                return self.json_out(404 if 'not found' in str(exc) else 400, {'ok': False, 'source': 'sqlite', 'error': str(exc)})
            return self.json_out(200, {'ok': True, 'source': 'sqlite', 'task': task})

        prefix = '/mail/analysis/'
        if path.startswith(prefix) and path.endswith('/reanalyze'):
            mail_id = unquote(path[len(prefix):-len('/reanalyze')]).strip()
            if not mail_id or len(mail_id) > 256:
                return self.json_out(400, {'ok': False, 'source': 'sqlite', 'error': 'mail not found'})
            try:
                if mail_db.get_analysis(DB_PATH, mail_id) is None:
                    return self.json_out(404, {'ok': False, 'source': 'sqlite', 'error': 'mail not found'})
                if not mail_db.queue_analysis(mail_id, DB_PATH, force=True):
                    return self.json_out(400, {'ok': False, 'source': 'sqlite', 'error': 'mail analysis could not be queued'})
            except mail_db.MailDatabaseError:
                return self.json_out(503, {'ok': False, 'source': 'sqlite', 'error': 'database_unavailable'})
            if not start_reanalyze_job(mail_id):
                return self.json_out(409, {'ok': False, 'source': 'sqlite', 'error': 'mail_job_already_running'})
            return self.json_out(202, {'ok': True, 'source': 'sqlite', 'status': 'queued', 'mailId': mail_id})
        return None

    def _portal_post(self, path: str, body: dict[str, object] | None = None):
        if path == '/portal/sync':
            if not start_portal_sync_job():
                return self.json_out(409, {'ok': False, 'source': 'sqlite', 'error': 'sync_already_running'})
            return self.json_out(202, {'ok': True, 'source': 'sqlite', 'status': 'running', 'jobKind': 'sync'})
        if path == '/portal/login':
            if not start_portal_login_job():
                return self.json_out(409, {'ok': False, 'source': 'sqlite', 'error': 'portal_job_already_running'})
            return self.json_out(202, {'ok': True, 'source': 'sqlite', 'status': 'running', 'jobKind': 'login'})
        prefix = '/portal/notices/'
        if body is not None and path.startswith(prefix) and path.endswith('/analyze'):
            notice_id = unquote(path[len(prefix):-len('/analyze')]).strip()
            if not notice_id or len(notice_id) > 512:
                return self.json_out(400, {'ok': False, 'source': 'sqlite', 'error': 'notice not found'})
            if portal_db.get_notice(notice_id, PORTAL_DB_PATH) is None:
                return self.json_out(404, {'ok': False, 'source': 'sqlite', 'error': 'notice not found'})
            if not start_portal_notice_analysis(notice_id, force=body.get('force') is True):
                return self.json_out(409, {'ok': False, 'source': 'sqlite', 'error': 'ai_job_already_running'})
            return self.json_out(202, {'ok': True, 'source': 'sqlite', 'status': 'queued', 'jobKind': 'ai', 'noticeId': notice_id})
        if body is not None and path.startswith(prefix) and path.endswith('/candidate'):
            notice_id = unquote(path[len(prefix):-len('/candidate')]).strip()
            candidate_id = body.get('candidateId')
            status = body.get('status')
            if not notice_id or len(notice_id) > 512 or not isinstance(candidate_id, str) or not candidate_id.strip() or not isinstance(status, str) or not status.strip():
                return self.json_out(400, {'ok': False, 'source': 'sqlite', 'error': 'invalid portal notice candidate request'})
            try:
                candidate = portal_db.update_notice_calendar_candidate(
                    notice_id,
                    candidate_id.strip(),
                    status.strip(),
                    title=body.get('title') if isinstance(body.get('title'), str) else None,
                    start=body.get('start') if isinstance(body.get('start'), str) else None,
                    end=body.get('end') if isinstance(body.get('end'), str) else None,
                    all_day=body.get('allDay') if isinstance(body.get('allDay'), bool) else None,
                    calendar_event_id=body.get('calendarEventId') if isinstance(body.get('calendarEventId'), str) else None,
                    path=PORTAL_DB_PATH,
                )
            except portal_db.PortalDatabaseError as exc:
                return self.json_out(404 if 'not found' in str(exc) else 400, {'ok': False, 'source': 'sqlite', 'error': str(exc)})
            return self.json_out(200, {'ok': True, 'source': 'sqlite', 'candidate': candidate})
        if body is not None and path.startswith(prefix) and path.endswith('/state'):
            notice_id = unquote(path[len(prefix):-len('/state')]).strip()
            if not notice_id or len(notice_id) > 512:
                return self.json_out(400, {'ok': False, 'source': 'sqlite', 'error': 'notice not found'})
            state_fields = {
                'isRead': 'is_read',
                'isImportant': 'is_important',
                'isArchived': 'is_archived',
            }
            provided = {key: body.get(key) for key in state_fields if key in body}
            if not provided or any(not isinstance(value, bool) for value in provided.values()):
                return self.json_out(400, {'ok': False, 'source': 'sqlite', 'error': 'invalid notice state'})
            try:
                item = portal_db.update_notice_state(
                    notice_id,
                    **{
                        state_fields[key]: value
                        for key, value in provided.items()
                    },
                    path=PORTAL_DB_PATH,
                )
            except portal_db.PortalDatabaseError as exc:
                if 'not found' in str(exc):
                    return self.json_out(404, {'ok': False, 'source': 'sqlite', 'error': 'notice not found'})
                raise
            return self.json_out(200, {'ok': True, 'source': 'sqlite', 'item': item})
        return None

    def do_POST(self):
        path = self._path()
        allowed = (
            '/open', '/open-folder', '/launch', '/mail/recent', '/mail/folders',
            '/mail/message', '/mail/open', '/mail/sync', '/mail/analysis/candidate', '/mail/task',
            '/portal/sync', '/portal/login',
        )
        is_portal_state = path.startswith('/portal/notices/') and path.endswith('/state')
        is_portal_analyze = path.startswith('/portal/notices/') and path.endswith('/analyze')
        is_portal_candidate = path.startswith('/portal/notices/') and path.endswith('/candidate')
        if path not in allowed and not is_portal_state and not is_portal_analyze and not is_portal_candidate and not (path.startswith('/mail/analysis/') and path.endswith('/reanalyze')):
            return self.json_out(404, {'error': 'not found'})
        if not self._origin_allowed():
            return
        body = self._read_json_body()
        if body is None:
            return
        if not token_matches(body.get('token', ''), TOKEN):
            return self.json_out(403, {'error': 'invalid token'})
        try:
            portal_response = self._portal_post(path, body)
            if portal_response is not None:
                return portal_response
            analysis_response = self._analysis_post(path, body)
            if analysis_response is not None:
                return analysis_response
            legacy_response = self._legacy_mail_post(path, body)
            if legacy_response is not None:
                return legacy_response
            if path == '/launch':
                request = normalize_shortcut_request(body)
                launch_shortcut(request)
                return self.json_out(200, {'ok': True, 'type': request['type']})
            target = target_for_endpoint(ROOT, path, str(body.get('path', '')))
            launch(target)
            return self.json_out(200, {'ok': True, 'path': str(target)})
        except FileNotFoundError as exc:
            if path.startswith(MAIL_PATH_PREFIX):
                return self.json_out(503, {'ok': False, 'source': 'thunderbird', 'error': 'profile_not_found'})
            return self.json_out(404, {'error': 'local file not found', 'detail': str(exc)})
        except ThunderbirdMailError as exc:
            return self.json_out(exc.http_status, {'ok': False, 'source': 'thunderbird', 'error': exc.code})
        except mail_db.MailDatabaseError:
            return self.json_out(503, {'ok': False, 'source': 'sqlite', 'error': 'database_unavailable'})
        except portal_db.PortalDatabaseError:
            return self.json_out(503, {'ok': False, 'source': 'sqlite', 'error': 'database_error'})
        except Exception:
            if path.startswith(MAIL_PATH_PREFIX):
                return self.json_out(400, {'ok': False, 'source': 'sqlite', 'error': 'request_failed'})
            return self.json_out(400, {'error': 'request failed'})

    def log_message(self, fmt, *args):
        # Do not log URL paths, query strings, mail IDs, request bodies, or
        # bridge tokens. The status code is enough for local diagnostics.
        print('[bridge] request', flush=True)


print(f'Master Thesis OS Bridge: http://127.0.0.1:{PORT}')
ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
