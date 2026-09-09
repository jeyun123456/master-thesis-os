import json, os, platform, subprocess, sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from bridge_config import CONFIG_ERROR_EXIT_CODE, ConfigError, load_bridge_config
from bridge_security import allows_private_network, target_for_endpoint, token_matches

HERE = Path(__file__).resolve().parent
CONFIG = HERE / 'config.json'
MAX_BODY_BYTES = 16 * 1024

try:
    bridge_config = load_bridge_config(CONFIG)
except ConfigError as exc:
    print(str(exc), file=sys.stderr)
    raise SystemExit(CONFIG_ERROR_EXIT_CODE) from exc

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
        self.send_response(204); self.cors(); self.end_headers()
    def do_GET(self):
        if self.path == '/health': return self.json_out(200, {'ok':True})
        return self.json_out(404, {'error':'not found'})
    def do_POST(self):
        if self.path not in ('/open', '/open-folder'): return self.json_out(404, {'error':'not found'})
        try:
            origin = self.headers.get('Origin','')
            if origin not in ORIGINS: return self.json_out(403, {'error':'origin not allowed'})
            if self.headers.get_content_type() != 'application/json': return self.json_out(415, {'error':'application/json required'})
            length=int(self.headers.get('Content-Length','0'))
            if length <= 0 or length > MAX_BODY_BYTES: return self.json_out(413, {'error':'invalid request size'})
            body=json.loads(self.rfile.read(length))
            if not token_matches(body.get('token',''), TOKEN): return self.json_out(403, {'error':'invalid token'})
            target = target_for_endpoint(ROOT, self.path, str(body.get('path','')))
            launch(target)
            return self.json_out(200, {'ok':True,'path':str(target)})
        except FileNotFoundError as e: return self.json_out(404, {'error':'local file not found','detail':str(e)})
        except Exception as e: return self.json_out(400, {'error':str(e)})
    def log_message(self, fmt, *args):
        print('[bridge]', fmt % args)

print(f'Master Thesis OS Bridge: http://127.0.0.1:{PORT}')
ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
