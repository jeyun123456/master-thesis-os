"""Production smoke test for the school-notice UI and local bridge.

This test reuses only the Local Bridge token already configured on the local
machine. It never reads or stores school credentials, and it does not click a
notice, so the test does not change the local read state.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from urllib.parse import urlsplit


PRODUCTION_URL = "https://master-thesis-os.vercel.app/"
PRODUCTION_ORIGIN = "https://master-thesis-os.vercel.app"

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")


def config_path() -> Path:
    local_app_data = os.environ.get("LOCALAPPDATA", "").strip()
    if not local_app_data:
        raise RuntimeError("LOCALAPPDATA is not configured")
    return Path(local_app_data) / "MasterThesisOSWallpaper" / "bridge" / "config.json"


def bridge_config() -> tuple[str, int]:
    path = config_path()
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise RuntimeError("Local Bridge config could not be read") from exc
    token = value.get("token") if isinstance(value, dict) else None
    port = value.get("port", 38471) if isinstance(value, dict) else 38471
    if not isinstance(token, str) or not token.strip():
        raise RuntimeError("Local Bridge token is not configured")
    if isinstance(port, bool) or not isinstance(port, int) or not 1024 <= port <= 65535:
        raise RuntimeError("Local Bridge port is invalid")
    return token, port


def bridge_json(path: str, token: str, port: int) -> dict[str, object]:
    request = Request(
        f"http://127.0.0.1:{port}{path}",
        headers={"Origin": PRODUCTION_ORIGIN, "X-Bridge-Token": token},
    )
    try:
        with urlopen(request, timeout=10) as response:
            value = json.loads(response.read().decode("utf-8"))
    except (OSError, HTTPError, URLError, UnicodeError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"Local Bridge request failed: {path}") from exc
    if not isinstance(value, dict):
        raise RuntimeError(f"Local Bridge returned an invalid response: {path}")
    return value


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def run() -> dict[str, object]:
    token, port = bridge_config()
    status_response = bridge_json("/portal/status", token, port)
    notices_response = bridge_json("/portal/notices?limit=500", token, port)
    status = status_response.get("sync") if isinstance(status_response.get("sync"), dict) else status_response
    items = notices_response.get("items")
    require(isinstance(status, dict), "portal status payload is invalid")
    require(isinstance(items, list), "portal notice list payload is invalid")
    notice_ids = [item.get("noticeId") for item in items if isinstance(item, dict)]
    require(len(notice_ids) == len(set(notice_ids)), "duplicate noticeId values found in the Local Bridge list")
    require(int(status.get("storedCount", 0)) > 0, "Local Bridge has no stored school notices")
    require(isinstance(status.get("history"), list) and len(status["history"]) > 0, "sync history is not exposed by the running Local Bridge")

    first_notice = items[0] if items and isinstance(items[0], dict) else None
    body_search_term = ""
    if first_notice and isinstance(first_notice.get("noticeId"), str):
        detail = bridge_json(f"/portal/notices/{first_notice['noticeId']}", token, port)
        detail_item = detail.get("item") if isinstance(detail.get("item"), dict) else {}
        body = detail_item.get("body") if isinstance(detail_item, dict) else ""
        if isinstance(body, str):
            body_search_term = next((part[:12] for part in body.split() if len(part) >= 3), "")

    from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
    from playwright.sync_api import sync_playwright

    with sync_playwright() as playwright:
        try:
            browser = playwright.chromium.launch(channel="chrome", headless=True)
        except Exception:
            browser = playwright.chromium.launch(headless=True)
        context = browser.new_context(locale="ko-KR", viewport={"width": 1440, "height": 1100})
        page = context.new_page()
        try:
            # Headless Chrome blocks a public HTTPS page's direct request to a
            # loopback address before the Local Bridge can answer it. Route
            # only the browser-side portal calls through the same live Bridge
            # API checked above; this keeps the test production-UI based while
            # avoiding a security flag or a fake notice fixture.
            def route_bridge_request(route, request) -> None:
                parsed = urlsplit(request.url)
                cors_headers = {
                    "Access-Control-Allow-Origin": PRODUCTION_ORIGIN,
                    "Access-Control-Allow-Headers": "Content-Type, X-Bridge-Token",
                    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
                    "Access-Control-Allow-Private-Network": "true",
                }
                if request.method == "OPTIONS":
                    route.fulfill(status=204, headers=cors_headers)
                    return
                if not parsed.path.startswith("/portal/"):
                    route.abort()
                    return
                require(request.headers.get("x-bridge-token") == token, "production UI did not send the configured Local Bridge token")
                path = parsed.path + (f"?{parsed.query}" if parsed.query else "")
                payload = bridge_json(path, token, port)
                route.fulfill(
                    status=200,
                    headers=cors_headers,
                    content_type="application/json; charset=utf-8",
                    body=json.dumps(payload, ensure_ascii=False),
                )

            page.route(f"http://127.0.0.1:{port}/**", route_bridge_request)
            page.goto(PRODUCTION_URL, wait_until="domcontentloaded", timeout=30_000)
            page.evaluate("(token) => localStorage.setItem('thesisBridgeToken', token)", token)
            page.reload(wait_until="domcontentloaded", timeout=30_000)
            # The app opens on the home page. Navigate through the same
            # sidebar control a user would use before asserting portal UI.
            # The desktop navigation order is fixed in the app and the portal
            # entry is the eighth button (the mobile copy is outside nav.nav).
            page.locator("nav.nav button").nth(7).click(timeout=10_000)
            page.get_by_role("heading", name="학교 공지").first.wait_for(timeout=20_000)
            search = page.get_by_label("공지 제목, 본문, 담당부서 검색")
            search.wait_for(timeout=10_000)
            rows = page.locator(".portal-notice-row")
            rows.first.wait_for(timeout=20_000)
            initial_rows = rows.count()
            require(initial_rows > 0, "production UI did not render stored notice rows")
            require(page.locator(".portal-sync-history").count() == 1, "production UI did not render sync history")

            title = page.locator(".portal-notice-main b").first.inner_text().strip()
            title_term = title[: min(5, len(title))]
            require(bool(title_term), "first notice title is empty")
            search.fill(title_term)
            require(rows.count() > 0, "title search returned no notice")
            search.fill("")
            require(rows.count() == initial_rows, "clearing search did not restore notice rows")

            body_rows = None
            if body_search_term:
                search.fill(body_search_term)
                body_rows = rows.count()
                require(body_rows > 0, "body search returned no notice")

            return {
                "ok": True,
                "productionUrl": PRODUCTION_URL,
                "storedCount": status.get("storedCount"),
                "listCount": len(items),
                "duplicateNoticeIds": 0,
                "syncHistoryCount": len(status["history"]),
                "uiRows": initial_rows,
                "bodySearchRows": body_rows,
            }
        except PlaywrightTimeoutError as exc:
            raise RuntimeError("production UI did not finish loading in time") from exc
        finally:
            context.close()
            browser.close()


if __name__ == "__main__":
    try:
        print(json.dumps(run(), ensure_ascii=False))
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        raise SystemExit(1)
