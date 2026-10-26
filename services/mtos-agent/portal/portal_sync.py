"""Server-side Student Portal notice collector.

    python portal_sync.py status
    python portal_sync.py login                      # visible window; the user signs in (MFA included)
    python portal_sync.py sync --request req.json    # headless, reuses the saved browser session

`sync` reads one JSON request {"since": ISO, "known": {id: fingerprint}, "refresh": [id], "files_dir": path}
and prints one JSON line: {"ok", "code", "message", "notices": [...]}. It never fills login forms,
never stores credentials and never retries a login: an expired session just reports
code=session_expired / login_required so the caller can stop and ask for a re-login.
"""

from __future__ import annotations

import argparse
import dataclasses
import hashlib
import json
import re
import sys
from pathlib import Path

from portal_client import PortalClient, PortalError, profile_session_state

MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024
MAX_DETAILS_PER_RUN = 40


def emit(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")


def fingerprint(summary: dict) -> str:
    keys = ("title", "department", "published_at", "expires_at", "deadline", "importance", "category", "notice_type")
    return hashlib.sha1("|".join(str(summary.get(k, "")) for k in keys).encode("utf-8")).hexdigest()


def safe_name(name: str) -> str:
    return re.sub(r'[\\/:*?"<>|\x00-\x1f]+', "_", name).strip()[:150] or "attachment"


def save_bytes(body: bytes, filename: str, files_dir: Path) -> dict:
    digest = hashlib.sha256(body).hexdigest()
    target = files_dir / digest[:2] / f"{digest}{Path(safe_name(filename)).suffix.lower()[:10]}"
    target.parent.mkdir(parents=True, exist_ok=True)
    if not target.exists():
        target.write_bytes(body)
    return {"path": str(target), "sha256": digest, "size": len(body)}


def download_table_files(page, wanted: dict[str, dict], files_dir: Path) -> None:
    """Files in the portal's attachment table only have a Download button: click it and take the browser download."""
    rows = page.locator("tr[role='row'][data-row-key-value^='06A']")
    for index in range(min(rows.count(), 20)):
        row = rows.nth(index)
        try:
            name = (row.locator("[data-label='File Name']").first.get_attribute("data-cell-value") or "").strip()
            ext = (row.locator("[data-label='File Type']").first.get_attribute("data-cell-value") or "").strip()
            filename = name if not ext or name.lower().endswith(f".{ext.lower()}") else f"{name}.{ext}"
            entry = wanted.get(filename)
            if entry is None or entry["path"]:
                continue
            with page.expect_download(timeout=45000) as download:
                row.locator("[data-label='Download'] button").first.click(timeout=10000)
            temp = files_dir / f".download-{index}.tmp"
            files_dir.mkdir(parents=True, exist_ok=True)
            download.value.save_as(str(temp))
            body = temp.read_bytes()
            temp.unlink(missing_ok=True)
            if body and len(body) <= MAX_ATTACHMENT_BYTES:
                entry.update(save_bytes(body, filename, files_dir))
        except Exception:
            continue


def download_attachments(context, attachments: list[dict], files_dir: Path, page=None) -> list[dict]:
    """Saves attachments that have a direct URL, through the logged-in browser context.

    Files the portal only offers behind a script-driven button have no URL; those keep
    their name and are reported as not downloaded instead of being guessed.
    """
    result: list[dict] = []
    for attachment in attachments:
        entry = {"filename": attachment.get("filename", ""), "url": attachment.get("url", ""), "path": None, "sha256": None, "size": None}
        url = entry["url"]
        if url.startswith("https://sp.ritsumei.ac.jp/"):
            try:
                response = context.request.get(url, timeout=60000)
                body = response.body() if response.ok else b""
                if body and len(body) <= MAX_ATTACHMENT_BYTES and "text/html" not in (response.headers.get("content-type") or ""):
                    digest = hashlib.sha256(body).hexdigest()
                    target = files_dir / digest[:2] / f"{digest}{Path(safe_name(entry['filename'])).suffix.lower()[:10]}"
                    target.parent.mkdir(parents=True, exist_ok=True)
                    if not target.exists():
                        target.write_bytes(body)
                    entry.update(path=str(target), sha256=digest, size=len(body))
            except Exception:
                pass
        result.append(entry)
    if page is not None:
        download_table_files(page, {e["filename"]: e for e in result if not e["path"]}, files_dir)
    return result


def run_sync(request: dict) -> dict:
    since = str(request.get("since") or "")
    known: dict = request.get("known") or {}
    refresh = set(request.get("refresh") or [])
    files_dir = Path(request["files_dir"])
    client = PortalClient()
    summaries = client.list_notices()
    listed = []
    wanted = []
    for summary in summaries:
        row = dataclasses.asdict(summary)
        row["fingerprint"] = fingerprint(row)
        listed.append(row)
        in_window = not row["published_at"] or not since or row["published_at"] >= since
        if not in_window:
            continue
        if known.get(row["notice_id"]) != row["fingerprint"] or row["notice_id"] in refresh:
            wanted.append((summary, row))
    notices = []
    errors = []
    sync_playwright, _, _ = client._playwright()
    if wanted:
        with sync_playwright() as playwright:
            with client._authenticated_context(playwright) as (context, page):
                for summary, row in wanted[:MAX_DETAILS_PER_RUN]:
                    try:
                        detail = client._get_notice_detail_on_page(page, summary)
                    except PortalError as exc:
                        if exc.code in ("session_expired", "login_required"):
                            raise
                        errors.append({"notice_id": summary.notice_id, "code": exc.code})
                        continue
                    detail["attachments"] = download_attachments(context, detail.get("attachments") or [], files_dir, page)
                    detail["fingerprint"] = row["fingerprint"]
                    notices.append(detail)
    return {
        "ok": True, "code": "ok", "message": "",
        "listed": [{"notice_id": r["notice_id"], "fingerprint": r["fingerprint"], "published_at": r["published_at"]} for r in listed],
        "notices": notices, "errors": errors, "pending": max(0, len(wanted) - MAX_DETAILS_PER_RUN),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("status", "login", "sync"))
    parser.add_argument("--request")
    args = parser.parse_args()
    try:
        if args.command == "status":
            emit({"ok": True, "code": "ok", "session": profile_session_state()})
        elif args.command == "login":
            emit({"ok": True, "code": "ok", **PortalClient().login()})
        else:
            emit(run_sync(json.loads(Path(args.request).read_text(encoding="utf-8"))))
    except PortalError as exc:
        emit({"ok": False, "code": exc.code, "message": exc.message})
    except Exception as exc:  # unexpected: report without internals
        emit({"ok": False, "code": "unexpected", "message": type(exc).__name__})
    return 0


if __name__ == "__main__":
    sys.exit(main())
