import hmac, json, os, platform, subprocess
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from bridge_security import safe_path

HERE = Path(__file__).resolve().parent
CONFIG = HERE / 'config.json'
if not CONFIG.exists():
    raise SystemExit('Missing config.json. Copy config.example.json -> config.json and edit it.')
config = json.loads(CONFIG.read_text(encoding='utf-8'))
ROOT = Path(config['master_path']).expanduser().resolve()
TOKEN = str(config.get('token',''))
PORT = int(config.get('port',38471))
ORIGINS = set(config.get('allowed_origins', ['http://localhost:3000']))
MAX_BODY_BYTES = 16 * 1024

if not ROOT.is_dir():
    raise SystemExit(f'master_path is not an existing directory: {ROOT}')
if len(TOKEN) < 32 or TOKEN.startswith('CHANGE-THIS'):
    raise SystemExit('Bridge token must be a non-placeholder value of at least 32 characters.')
if not ORIGINS or any(not origin.startswith(('http://localhost:', 'http://127.0.0.1:')) for origin in ORIGINS):
    raise SystemExit('allowed_origins must contain only explicit localhost origins.')
if not 1024 <= PORT <= 65535:
    raise SystemExit('port must be between 1024 and 65535.')

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
    def json_out(self, status, obj):
        data=json.dumps(obj,ensure_ascii=False).encode('utf-8')
        self.send_response(status); self.cors(); self.send_header('Content-Type','application/json; charset=utf-8'); self.send_header('Content-Length',str(len(data))); self.end_headers(); self.wfile.write(data)
    def do_OPTIONS(self):
        self.send_response(204); self.cors(); self.end_headers()
    def do_GET(self):
        if self.path == '/health': return self.json_out(200, {'ok':True})
        return self.json_out(404, {'error':'not found'})
    def do_POST(self):
        if self.path != '/open': return self.json_out(404, {'error':'not found'})
        try:
            origin = self.headers.get('Origin','')
            if origin not in ORIGINS: return self.json_out(403, {'error':'origin not allowed'})
            if self.headers.get_content_type() != 'application/json': return self.json_out(415, {'error':'application/json required'})
            length=int(self.headers.get('Content-Length','0'))
            if length <= 0 or length > MAX_BODY_BYTES: return self.json_out(413, {'error':'invalid request size'})
            body=json.loads(self.rfile.read(length))
            if not hmac.compare_digest(str(body.get('token','')), TOKEN): return self.json_out(403, {'error':'invalid token'})
            target=safe_path(ROOT, str(body.get('path',''))); launch(target)
            return self.json_out(200, {'ok':True,'path':str(target)})
        except FileNotFoundError as e: return self.json_out(404, {'error':'local file not found','detail':str(e)})
        except Exception as e: return self.json_out(400, {'error':str(e)})
    def log_message(self, fmt, *args):
        print('[bridge]', fmt % args)

print(f'Master Thesis OS Bridge: http://127.0.0.1:{PORT}')
ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
