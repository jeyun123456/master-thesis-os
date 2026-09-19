"""CLI and orchestration for Ritsumei Student Portal synchronization."""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Iterable

import portal_db
from portal_client import DEFAULT_LOGIN_WAIT_SECONDS, PortalClient, PortalError, resolve_profile_path, profile_session_state


DETAIL_REFRESH_DAYS = 7


def _portal_error_from_database(exc: portal_db.PortalDatabaseError) -> PortalError:
    return PortalError("database_error", "학교 공지 SQLite를 사용할 수 없어.", cause=exc)


def _list_for_sync(client: PortalClient) -> list:
    """Check the saved session without opening a headed login window."""
    return client.list_notices()


def sync_portal(
    root: str | Path | None = None,
    db_path: str | Path | None = None,
    *,
    login_wait_seconds: int = DEFAULT_LOGIN_WAIT_SECONDS,
    detail_refresh_days: int = DETAIL_REFRESH_DAYS,
) -> dict[str, object]:
    """Collect ALL/DM summaries and fetch details only when needed."""
    # Kept as a compatibility option for callers that already pass it. Login
    # is intentionally explicit so sync never opens a headed browser window.
    _ = login_wait_seconds
    resolved_db = portal_db.resolve_db_path(db_path)
    client = PortalClient(resolve_profile_path(root))
    started_at = portal_db.now_iso()
    try:
        # A previous process may have been terminated while SQLite still
        # reported a running sync. Clear that stale lifecycle state before
        # starting the next explicit sync.
        portal_db.recover_interrupted_sync(resolved_db)
        portal_db.begin_sync(resolved_db)
        summaries = _list_for_sync(client)
        summary_by_id = {summary.notice_id: summary for summary in summaries}
        summary_ids = list(summary_by_id)
        existing_ids = portal_db.existing_notice_ids(summary_ids, resolved_db)
        summary_changed_ids: set[str] = set()
        for summary in summary_by_id.values():
            result = portal_db.upsert_notice_summary(summary.to_db(), started_at, resolved_db)
            if result.changed:
                summary_changed_ids.add(summary.notice_id)
        refresh_before = portal_db.now_iso(
            datetime.now(timezone.utc) - timedelta(days=max(0, int(detail_refresh_days)))
        )
        detail_ids = portal_db.notice_ids_needing_detail(
            summary_ids,
            resolved_db,
            refresh_before=refresh_before,
        )
        detail_ids.update(summary_changed_ids)
        detail_targets = [summary for summary in summary_by_id.values() if summary.notice_id in detail_ids]
        detail_failed = 0
        updated_count = len(summary_changed_ids)
        detail_error_messages: list[str] = []
        if detail_targets:
            for summary, detail, error in client.iter_notice_details(detail_targets):
                if error is not None:
                    if error.code == "session_expired":
                        raise error
                    detail_failed += 1
                    detail_error_messages.append(f"{summary.notice_id}: {error.code}")
                    portal_db.mark_detail_error(summary.notice_id, error.message, path=resolved_db)
                    continue
                if detail is None:
                    detail_failed += 1
                    detail_error_messages.append(f"{summary.notice_id}: notice_detail_failed")
                    portal_db.mark_detail_error(summary.notice_id, "공지 상세 결과가 비어 있어.", path=resolved_db)
                    continue
                attachments = detail.get("attachments", [])
                attachment_rows = attachments if isinstance(attachments, list) else []
                detail_result = portal_db.upsert_notice_detail(
                    detail,
                    attachment_rows,
                    started_at,
                    resolved_db,
                    summary_changed=summary.notice_id in summary_changed_ids,
                )
                if detail_result.changed:
                    updated_count += 1
        finish_error_code = "notice_detail_failed" if detail_failed else None
        finish_error = "; ".join(detail_error_messages[:5]) if detail_error_messages else None
        portal_db.finish_sync(
            started_at,
            total_count=len(summary_by_id),
            new_count=len(set(summary_ids) - existing_ids),
            updated_count=updated_count,
            detail_failed_count=detail_failed,
            error_code=finish_error_code,
            error=finish_error,
            path=resolved_db,
        )
        return {
            "status": "completed",
            "lastSyncAt": started_at,
            "totalCount": len(summary_by_id),
            "newCount": len(set(summary_ids) - existing_ids),
            "updatedCount": updated_count,
            "detailCount": len(detail_targets),
            "detailFailedCount": detail_failed,
            "errorCode": finish_error_code,
            "error": finish_error,
        }
    except KeyboardInterrupt:
        try:
            portal_db.fail_sync(
                portal_db.now_iso(),
                portal_db.SYNC_INTERRUPTED_CODE,
                "사용자가 학교 공지 동기화를 중단했어.",
                path=resolved_db,
            )
        except portal_db.PortalDatabaseError:
            pass
        raise
    except PortalError as exc:
        try:
            portal_db.fail_sync(started_at, exc.code, exc.message, path=resolved_db)
        except portal_db.PortalDatabaseError:
            pass
        raise
    except portal_db.PortalDatabaseError as exc:
        try:
            portal_db.fail_sync(started_at, "database_error", "학교 공지 SQLite를 사용할 수 없어.", path=resolved_db)
        except portal_db.PortalDatabaseError:
            pass
        raise _portal_error_from_database(exc) from exc
    except Exception as exc:
        try:
            portal_db.fail_sync(started_at, "parsing_failed", "학교 공지 동기화가 중단되었어.", path=resolved_db)
        except portal_db.PortalDatabaseError:
            pass
        raise PortalError("parsing_failed", "학교 공지 동기화가 중단되었어.", cause=exc) from exc


def login_portal(root: str | Path | None = None, *, timeout_seconds: int = DEFAULT_LOGIN_WAIT_SECONDS) -> dict[str, str]:
    client = PortalClient(resolve_profile_path(root))
    try:
        return client.login(timeout_seconds=timeout_seconds)
    except PortalError:
        raise


def status_portal(root: str | Path | None = None, db_path: str | Path | None = None) -> dict[str, object]:
    profile = resolve_profile_path(root)
    try:
        portal_db.recover_interrupted_sync(db_path)
        sync = portal_db.sync_status(db_path)
    except portal_db.PortalDatabaseError as exc:
        raise _portal_error_from_database(exc) from exc
    persisted_error_code = sync.get("lastErrorCode")
    state = profile_session_state(profile)
    if persisted_error_code in {"login_required", "session_expired"}:
        state = str(persisted_error_code)
    return {
        "session": {
            "state": state,
            "profile": str(profile),
        },
        "sync": sync,
    }


def _print_json(value: object) -> None:
    print(json.dumps(value, ensure_ascii=False, indent=2))


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Ritsumei Student Portal local sync")
    subparsers = parser.add_subparsers(dest="command", required=True)
    login_parser = subparsers.add_parser("login", help="open a persistent browser for manual login")
    login_parser.add_argument("--wait-seconds", type=int, default=DEFAULT_LOGIN_WAIT_SECONDS)
    sync_parser = subparsers.add_parser("sync", help="sync ALL and DM notices")
    sync_parser.add_argument("--wait-seconds", type=int, default=DEFAULT_LOGIN_WAIT_SECONDS)
    sync_parser.add_argument(
        "--refresh-details",
        action="store_true",
        help="re-read all stored notice details now instead of waiting for the refresh interval",
    )
    subparsers.add_parser("status", help="show session and SQLite status")
    notices_parser = subparsers.add_parser("notices", help="list notices already stored in SQLite")
    notices_parser.add_argument("--type", choices=portal_db.NOTICE_TYPES)
    notices_parser.add_argument("--limit", type=int, default=20)
    args = parser.parse_args(list(argv) if argv is not None else None)
    try:
        if args.command == "login":
            _print_json(login_portal(timeout_seconds=max(1, args.wait_seconds)))
        elif args.command == "sync":
            _print_json(
                sync_portal(
                    login_wait_seconds=max(1, args.wait_seconds),
                    detail_refresh_days=0 if args.refresh_details else DETAIL_REFRESH_DAYS,
                )
            )
        elif args.command == "status":
            _print_json(status_portal())
        elif args.command == "notices":
            _print_json(portal_db.list_notices(notice_type=args.type, limit=args.limit))
        else:
            parser.error("unknown command")
    except PortalError as exc:
        print(json.dumps({"ok": False, "errorCode": exc.code, "error": exc.message}, ensure_ascii=False), file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        code = portal_db.SYNC_INTERRUPTED_CODE if args.command == "sync" else "portal_unreachable"
        message = "사용자가 학교 공지 동기화를 중단했어." if args.command == "sync" else "학교 포털 작업을 중단했어."
        print(json.dumps({"ok": False, "errorCode": code, "error": message}, ensure_ascii=False), file=sys.stderr)
        return 130
    except portal_db.PortalDatabaseError as exc:
        print(json.dumps({"ok": False, "errorCode": "database_error", "error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 3
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
