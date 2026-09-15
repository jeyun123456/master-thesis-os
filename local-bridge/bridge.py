import json, os, platform, subprocess, sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from bridge_config import CONFIG_ERROR_EXIT_CODE, ConfigError, load_bridge_config, resolve_config_path
from bridge_security import allows_private_network, target_for_endpoint, token_matches
from thunderbird_mail import (
    ThunderbirdMailError,
    clamp_mail_limit,
    get_mail_folders,
    get_recent_mail,
    launch_thunderbird,
    normalize_folder_id,
)

HERE = Path(__file__).resolve().parent
CONFIG = resolve_config_path(HERE)
MAX_BODY_BYTES = 16 * 1024

try:
    bridge_config = load_bridge_config(CONFIG)
except ConfigError as exc:
    print(str(exc), file=sys.stderr)
    raise SystemExit(CONFIG_ERROR_EXIT_CODE) from exc

from shortcut_launcher import launch_shortcut, normalize_shortcut_request

ROOT = bridge_config.root
TOKEN = bridge_config.token
PORT = bridge_config.port
ORIGINS = bridge_config.origins

def launch(path: Path):
    system = platform.system()
    if system == 'Windows': os.startfile(str(path))
    elif system == 'Darwin': subprocess.Popen(['open', str(path)])
    else: subprocess.Popen(['xdg-open', str(path)])

class Handler(BaseHTTPRequestHandler):
    def cors(self):
        origin = self.headers.get('Origin','')
        if origin in ORIGINS:
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Vary','Origin')
        self.send_header('Access-Control-Allow-Headers','Content-Type')
        self.send_header('Access-Control-Allow-Methods','POST, OPTIONS, GET')
        if allows_private_network(self.headers.get('Access-Control-Request-Private-Network', '')):
            self.send_header('Access-Control-Allow-Private-Network', 'true')
    def json_out(self, status, obj):
        data=json.dumps(obj,ensure_ascii=False).encode('utf-8')
        self.send_response(status); self.cors(); self.send_header('Content-Type','application/json; charset=utf-8'); self.send_header('Content-Length',str(len(data))); self.end_headers(); self.wfile.write(data)
    def do_OPTIONS(self):
        origin = self.headers.get('Origin', '')
        if origin not in ORIGINS:
            # Preflight can fail before POST; keep diagnostics limited to the origin.
            print(f'[bridge] rejected preflight origin: {origin!r}', file=sys.stderr, flush=True)
        self.send_response(204); self.cors(); self.end_headers()
    def do_GET(self):
        if self.path == '/health': return self.json_out(200, {'ok':True})
        return self.json_out(404, {'error':'not found'})
    def do_POST(self):
        if self.path not in ('/open', '/open-folder', '/launch', '/mail/recent', '/mail/folders', '/mail/open'):
            return self.json_out(404, {'error':'not found'})
        try:
            origin = self.headers.get('Origin','')
            if origin not in ORIGINS:
                # Keep diagnostics limited to the browser origin; never log token/body/path.
                print(f'[bridge] rejected origin: {origin!r}', file=sys.stderr, flush=True)
                return self.json_out(403, {'error':'origin not allowed'})
            if self.headers.get_content_type() != 'application/json': return self.json_out(415, {'error':'application/json required'})
            length=int(self.headers.get('Content-Length','0'))
            if length <= 0 or length > MAX_BODY_BYTES: return self.json_out(413, {'error':'invalid request size'})
            body=json.loads(self.rfile.read(length))
            if not token_matches(body.get('token',''), TOKEN): return self.json_out(403, {'error':'invalid token'})
            if self.path == '/mail/recent':
                try:
                    folder = normalize_folder_id(body.get('folder', 'inbox'))
                    account, items = get_recent_mail(bridge_config.thunderbird, clamp_mail_limit(body.get('limit', 5)), folder)
                except ThunderbirdMailError as exc:
                    return self.json_out(exc.http_status, {'ok':False, 'source':'thunderbird', 'error':exc.code})
                return self.json_out(200, {
                    'ok': True,
                    'source': 'thunderbird',
                    'account': account,
                    'folder': folder,
                    'items': [item.to_dict() for item in items],
                })
            if self.path == '/mail/folders':
                try:
                    account, folders = get_mail_folders(bridge_config.thunderbird)
                except ThunderbirdMailError as exc:
                    return self.json_out(exc.http_status, {'ok':False, 'source':'thunderbird', 'error':exc.code})
                return self.json_out(200, {
                    'ok': True,
                    'source': 'thunderbird',
                    'account': account,
                    'folders': [folder.to_dict() for folder in folders],
                })
            if self.path == '/mail/open':
                try:
                    launch_thunderbird()
                except ThunderbirdMailError as exc:
                    return self.json_out(exc.http_status, {'ok':False, 'source':'thunderbird', 'error':exc.code})
                return self.json_out(200, {'ok':True, 'source':'thunderbird'})
            if self.path == '/launch':
                request = normalize_shortcut_request(body)
                launch_shortcut(request)
                return self.json_out(200, {'ok':True,'type':request['type']})
            target = target_for_endpoint(ROOT, self.path, str(body.get('path','')))
            launch(target)
            return self.json_out(200, {'ok':True,'path':str(target)})
        except FileNotFoundError as e:
            if self.path.startswith('/mail/'):
                return self.json_out(503, {'ok':False, 'source':'thunderbird', 'error':'profile_not_found'})
            return self.json_out(404, {'error':'local file not found','detail':str(e)})
        except ThunderbirdMailError as e: return self.json_out(e.http_status, {'ok':False, 'source':'thunderbird', 'error':e.code})
        except Exception as e:
            if self.path.startswith('/mail/'):
                return self.json_out(400, {'ok':False, 'source':'thunderbird', 'error':'parse_error'})
            return self.json_out(400, {'error':str(e)})
    def log_message(self, fmt, *args):
        print('[bridge]', fmt % args, flush=True)

print(f'Master Thesis OS Bridge: http://127.0.0.1:{PORT}')
ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
