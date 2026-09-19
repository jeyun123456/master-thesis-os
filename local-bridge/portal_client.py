"""Playwright client for the logged-in Ritsumei Student Portal.

This client intentionally reuses a user-managed persistent browser profile. It
never fills login fields, stores credentials, or calls a portal API outside the
browser context that owns the user's authenticated cookies.
"""

from __future__ import annotations

import json
import logging
import os
import re
import subprocess
import sys
import time
from contextlib import contextmanager
from dataclasses import dataclass
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Any, Iterable, Iterator, Mapping
from urllib.parse import urljoin, urlsplit


PORTAL_ENTRY_URL = "https://sp.ritsumei.ac.jp/studentportal"
PORTAL_HOME_URL = "https://sp.ritsumei.ac.jp/studentportal/s/"
INFORMATION_HOME_URL = "https://sp.ritsumei.ac.jp/studentportal/s/information-home"
PORTAL_HOST = "sp.ritsumei.ac.jp"
PROFILE_DIRECTORY_NAME = "ritsumei-browser-profile"
PROFILE_APP_DIRECTORY_NAME = "MasterThesisOSWallpaper"
DEFAULT_WAIT_SECONDS = 60
DETAIL_NAVIGATION_TIMEOUT_MS = 30000
DEFAULT_LOGIN_WAIT_SECONDS = 300
NOTICE_TYPES = ("ALL", "DM")
DETAIL_LABELS = (
    "タイトル",
    "本文",
    "公開日",
    "担当部課",
    "重要度",
    "お知らせID",
    "終了日",
    "配信カテゴリ",
    "期日設定",
)
ATTACHMENT_EXTENSIONS = (
    ".pdf",
    ".doc",
    ".docx",
    ".xls",
    ".xlsx",
    ".ppt",
    ".pptx",
    ".csv",
    ".zip",
    ".txt",
    ".jpg",
    ".jpeg",
    ".png",
)
MAX_EXTERNAL_URL_LENGTH = 8192


class PortalError(RuntimeError):
    """Safe, user-facing portal error with a stable error code."""

    def __init__(self, code: str, message: str, *, cause: BaseException | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.cause = cause


@dataclass(frozen=True)
class NoticeSummary:
    notice_id: str
    record_id: str
    notice_type: str
    title: str
    department: str
    published_at: str
    expires_at: str
    deadline: str
    importance: str
    category: str
    source_url: str

    def to_db(self) -> dict[str, str]:
        return {
            "notice_id": self.notice_id,
            "type": self.notice_type,
            "title": self.title,
            "department": self.department,
            "published_at": self.published_at,
            "expires_at": self.expires_at,
            "deadline": self.deadline,
            "importance": self.importance,
            "category": self.category,
            "source_url": self.source_url,
        }


def resolve_profile_path(root: str | Path | None = None) -> Path:
    override = os.environ.get("RITSUMEI_BROWSER_PROFILE_DIR", "").strip()
    if override:
        return Path(override).expanduser().resolve(strict=False)
    # Browser state is user/session data, not repository data. Keep it in the
    # local Windows application-data directory so the source tree, releases,
    # and SQLite backups never become an accidental cookie transport.
    local_app_data = os.environ.get("LOCALAPPDATA", "").strip()
    if local_app_data:
        return (
            Path(local_app_data)
            / PROFILE_APP_DIRECTORY_NAME
            / "data"
            / PROFILE_DIRECTORY_NAME
        ).resolve(strict=False)

    # This fallback keeps the CLI usable on non-Windows development machines.
    # On Windows LOCALAPPDATA is normally always present.
    if root is not None:
        root_path = Path(root).expanduser().resolve(strict=False)
        return root_path / "local-bridge" / "data" / PROFILE_DIRECTORY_NAME
    return Path(__file__).resolve().parent / "data" / PROFILE_DIRECTORY_NAME


def browser_channel() -> str | None:
    """Return the Playwright browser channel used for the dedicated profile.

    Chrome is preferred for the real local workflow. ``chromium`` (or
    ``bundled``) explicitly selects Playwright's bundled Chromium, which is
    also the automatic fallback when the installed Chrome channel is absent.
    """

    configured = os.environ.get("RITSUMEI_BROWSER_CHANNEL", "chrome").strip().lower()
    if configured in {"", "chrome", "google-chrome"}:
        return "chrome"
    if configured in {"chromium", "bundled", "playwright"}:
        return None
    if configured in {"msedge", "edge"}:
        return "msedge"
    raise ValueError(
        "RITSUMEI_BROWSER_CHANNEL must be chrome, msedge, chromium, bundled, or playwright"
    )


def profile_has_browser_state(profile_path: str | Path | None = None) -> bool:
    profile = resolve_profile_path() if profile_path is None else Path(profile_path).expanduser()
    if not profile.is_dir():
        return False
    return any(
        (profile / relative).is_file()
        for relative in (
            Path("Default") / "Network" / "Cookies",
            Path("Default") / "Cookies",
        )
    )


def profile_session_state(profile_path: str | Path | None = None) -> str:
    profile = resolve_profile_path() if profile_path is None else Path(profile_path).expanduser()
    if not profile.is_dir() or not profile_has_browser_state(profile):
        return "login_required"
    return "saved"


def _logger(profile_path: Path) -> logging.Logger:
    logger = logging.getLogger("ritsumei.portal")
    logger.setLevel(logging.INFO)
    logger.propagate = False
    if not any(getattr(handler, "name", "") == "ritsumei-portal-file" for handler in logger.handlers):
        profile_path.parent.mkdir(parents=True, exist_ok=True)
        handler = RotatingFileHandler(
            profile_path.parent / "portal-debug.log",
            maxBytes=512 * 1024,
            backupCount=2,
            encoding="utf-8",
        )
        handler.name = "ritsumei-portal-file"
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
        logger.addHandler(handler)
    return logger


def _portal_error(code: str, message: str, cause: BaseException | None = None) -> PortalError:
    return PortalError(code, message, cause=cause)


def validate_external_url(value: object) -> str:
    """Return a safe absolute web URL for a local browser launch."""
    if not isinstance(value, str):
        raise _portal_error("invalid_url", "브라우저로 열 URL이 올바르지 않아.")
    url = value.strip()
    parsed = urlsplit(url)
    if (
        not url
        or len(url) > MAX_EXTERNAL_URL_LENGTH
        or parsed.scheme.lower() not in {"http", "https"}
        or not parsed.netloc
        or any(ord(character) < 0x20 or ord(character) == 0x7F or character.isspace() for character in url)
    ):
        raise _portal_error("invalid_url", "http 또는 https URL만 기본 브라우저로 열 수 있어.")
    return url


def open_url_in_default_browser(url: object) -> None:
    """Open an absolute portal or attachment URL through the OS default browser."""
    safe_url = validate_external_url(url)
    try:
        if os.name == "nt":
            # ``startfile`` delegates to the Windows file/URL association,
            # so this follows the user's configured default browser.
            os.startfile(safe_url)  # type: ignore[attr-defined]
        elif sys.platform == "darwin":
            subprocess.Popen(
                ["open", safe_url],
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                start_new_session=True,
            )
        else:
            subprocess.Popen(
                ["xdg-open", safe_url],
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                start_new_session=True,
            )
    except OSError as exc:
        raise _portal_error("default_browser_failed", "기본 브라우저를 실행하지 못했어.", exc) from exc


def _safe_url_path(url: str) -> str:
    return urlsplit(url).path or "/"


def _is_login_page(page: Any) -> bool:
    url = str(getattr(page, "url", ""))
    if "login.microsoftonline.com" in url or "login.live.com" in url:
        return True
    try:
        text = page.locator("body").inner_text(timeout=1500)
    except Exception:
        return False
    return "Sign in" in text and "Ritsumeikan" in text


def _is_portal_page(page: Any) -> bool:
    url = str(getattr(page, "url", ""))
    parsed = urlsplit(url)
    path = parsed.path.rstrip("/")
    return parsed.hostname == PORTAL_HOST and (
        path == "/studentportal/s" or path.startswith("/studentportal/s/")
    )


def _text(value: object) -> str:
    return str(value or "").strip()


def _record_list(value: object) -> list[dict[str, object]]:
    """Find notice rows in an Aura JSON response without relying on request r=."""
    found: list[dict[str, object]] = []
    if isinstance(value, dict):
        record_id = value.get("Id")
        if (
            isinstance(record_id, str)
            and record_id.strip()
            and ("R_Title__c" in value or "R_TitleEn__c" in value)
        ):
            found.append(value)
        for child in value.values():
            found.extend(_record_list(child))
    elif isinstance(value, list):
        for child in value:
            found.extend(_record_list(child))
    return found


def classify_notice_type(value: object) -> str:
    """Map the portal's observed 全体/個人 classification to ALL/DM."""
    normalized = _text(value).upper()
    if normalized in {"個人", "DM", "DIRECT MESSAGE"}:
        return "DM"
    return "ALL"


def _normalize_datetime(value: object) -> str:
    raw = _text(value)
    if not raw:
        return ""
    try:
        from datetime import datetime, timezone

        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    except ValueError:
        return raw


def _summary_from_record(record: Mapping[str, object], page_url: str) -> NoticeSummary | None:
    record_id = _text(record.get("Id"))
    if not record_id:
        return None
    notice_id = _text(record.get("Name")) or record_id
    title = _text(record.get("R_Title__c")) or _text(record.get("R_TitleEn__c"))
    if not title:
        return None
    source_url = urljoin(
        page_url,
        f"/studentportal/s/r-information/{record_id}/view",
    )
    return NoticeSummary(
        notice_id=notice_id,
        record_id=record_id,
        notice_type=classify_notice_type(record.get("R_InformationCategory__c")),
        title=title,
        department=_text(record.get("R_DepartmentForStudentF__c")),
        published_at=_normalize_datetime(record.get("R_StartDateTime__c")),
        expires_at=_normalize_datetime(record.get("R_EndDateTime__c")),
        deadline=_text(record.get("R_DeadlineSetting__c")),
        importance=_text(record.get("R_Importance__c")),
        category=(
            _text(record.get("R_BroadCast__c"))
            or _text(record.get("R_FavoriteInformation__c"))
            or _text(record.get("R_Category__c"))
        ),
        source_url=source_url,
    )


def _unique_summaries(records: Iterable[Mapping[str, object]], page_url: str) -> list[NoticeSummary]:
    result: list[NoticeSummary] = []
    seen: set[str] = set()
    for record in records:
        summary = _summary_from_record(record, page_url)
        if summary is None or summary.notice_id in seen:
            continue
        seen.add(summary.notice_id)
        result.append(summary)
    return result


def _lines(text: str) -> list[str]:
    return [line.strip() for line in text.replace("\r\n", "\n").split("\n")]


def extract_labeled_value(text: str, label: str, labels: Iterable[str] = DETAIL_LABELS) -> str:
    """Read a value following an exact visible metadata label."""
    values = _lines(text)
    label_set = set(labels)
    positions = [index for index, value in enumerate(values) if value == label]
    if not positions:
        return ""
    start = positions[-1] + 1
    collected: list[str] = []
    for value in values[start:]:
        if value in label_set:
            break
        if value:
            collected.append(value)
    return "\n".join(collected).strip()


def _validated_deadline(value: object) -> str:
    """Keep only a date-like detail value, not footer or file-table text."""
    for line in _lines(_text(value)):
        if re.fullmatch(
            r"\d{4}(?:[/-]\d{1,2}[/-]\d{1,2}|年\d{1,2}月\d{1,2}日)(?:\s+\d{1,2}:\d{2})?",
            line,
        ):
            return line
    return ""


def _attachment_candidate(href: str, text: str, download: str | None) -> bool:
    lower = href.lower()
    path = urlsplit(href).path.lower()
    if download:
        return True
    if any(path.endswith(extension) for extension in ATTACHMENT_EXTENSIONS):
        return True
    return any(token in lower for token in ("filedownload", "filefield", "/servlet/", "/file/"))


def _filename_from_link(href: str, text: str, download: str | None) -> str:
    candidate = _text(download) or _text(text)
    if candidate:
        return candidate
    path_name = Path(urlsplit(href).path).name
    return path_name or href


class PortalClient:
    def __init__(self, profile_path: str | Path | None = None):
        self.profile_path = resolve_profile_path() if profile_path is None else Path(profile_path).expanduser().resolve(strict=False)
        self.logger = _logger(self.profile_path)

    @staticmethod
    def _playwright():
        try:
            from playwright.sync_api import Error as PlaywrightError
            from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
            from playwright.sync_api import sync_playwright
        except ImportError as exc:
            raise _portal_error(
                "portal_unreachable",
                "Playwright가 설치되지 않았어. local-bridge 실행 환경을 확인해줘.",
                exc,
            ) from exc
        return sync_playwright, PlaywrightError, PlaywrightTimeoutError

    @contextmanager
    def _profile_lock(self) -> Iterator[None]:
        """Serialize browser access to the dedicated persistent profile.

        Chromium profiles are not safe to open from two processes at once.
        The lock file contains no authentication data and remains on disk so
        the operating-system lock, rather than file deletion, controls the
        lifetime of the reservation.
        """

        self.profile_path.parent.mkdir(parents=True, exist_ok=True)
        lock_path = self.profile_path.with_name(f"{self.profile_path.name}.lock")
        handle = lock_path.open("a+b")
        locked = False
        try:
            handle.seek(0)
            handle.write(b"0")
            handle.flush()
            handle.seek(0)
            try:
                if os.name == "nt":
                    import msvcrt

                    msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
                else:
                    import fcntl

                    fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                locked = True
            except (OSError, IOError) as exc:
                raise _portal_error(
                    "portal_unreachable",
                    "포털 브라우저가 이미 실행 중이야. 기존 로그인 또는 동기화가 끝난 뒤 다시 시도해줘.",
                    exc,
                ) from exc
            yield
        finally:
            if locked:
                try:
                    if os.name == "nt":
                        import msvcrt

                        handle.seek(0)
                        msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
                    else:
                        import fcntl

                        fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
                except (OSError, IOError):
                    self.logger.exception("failed to release browser profile lock")
            handle.close()

    @contextmanager
    def _persistent_context(self, playwright: Any, *, headless: bool) -> Iterator[Any]:
        with self._profile_lock():
            context = self._launch(playwright, headless=headless)
            try:
                yield context
            finally:
                self._close_context(context)

    def _launch(self, playwright: Any, *, headless: bool) -> Any:
        self.profile_path.mkdir(parents=True, exist_ok=True)
        options = {
            "headless": headless,
            "viewport": {"width": 1440, "height": 900},
        }
        if not headless:
            # A headed login must be discoverable on the user's desktop even
            # if the dedicated profile has stale window-placement preferences.
            options["viewport"] = None
            options["args"] = ["--start-maximized", "--window-position=0,0"]
        try:
            preferred_channel = browser_channel()
        except ValueError as exc:
            raise _portal_error("portal_unreachable", str(exc), exc) from exc

        if preferred_channel is not None:
            try:
                return playwright.chromium.launch_persistent_context(
                    str(self.profile_path),
                    channel=preferred_channel,
                    **options,
                )
            except Exception as exc:
                # A normal Windows install may not have Google Chrome. The
                # same persistent profile can safely fall back to Playwright's
                # bundled Chromium without exposing a visible sync window.
                self.logger.warning(
                    "preferred browser channel unavailable channel=%s; falling back to bundled Chromium (%s)",
                    preferred_channel,
                    type(exc).__name__,
                )

        try:
            context = playwright.chromium.launch_persistent_context(
                str(self.profile_path),
                **options,
            )
            if preferred_channel is not None:
                self.logger.info("using bundled Chromium fallback for persistent profile")
            return context
        except Exception as exc:
            self.logger.exception("persistent context launch failed")
            raise _portal_error("portal_unreachable", "포털 브라우저를 열지 못했어.", exc) from exc

    @staticmethod
    def _close_context(context: Any) -> None:
        try:
            context.close()
        except Exception:
            # The user may close the headed login window first. In that case
            # Playwright reports TargetClosedError while the desired session
            # state has already been written by Chromium.
            pass

    @staticmethod
    def _page(context: Any) -> Any:
        pages = list(context.pages)
        if pages:
            for page in reversed(pages):
                if _is_portal_page(page) or _is_login_page(page):
                    return page
            return pages[-1]
        return context.new_page()

    def _wait_for_login(self, context: Any, timeout_seconds: int) -> Any:
        deadline = time.monotonic() + max(1, timeout_seconds)
        saw_login = False
        observed_paths: set[str] = set()
        while time.monotonic() < deadline:
            for page in list(context.pages):
                page_path = _safe_url_path(str(getattr(page, "url", "")))
                if page_path not in observed_paths:
                    observed_paths.add(page_path)
                    self.logger.info("login wait observed page path=%s", page_path)
                if _is_login_page(page):
                    saw_login = True
                if _is_portal_page(page):
                    # The portal may finish the SSO redirect before its
                    # localized body has hydrated. The authenticated portal
                    # URL is the stable signal; the collection methods still
                    # validate the actual notice page structure afterward.
                    return page
            time.sleep(0.5)
        if saw_login:
            raise _portal_error("login_required", "학교 포털에 직접 로그인해줘.")
        raise _portal_error("portal_unreachable", "포털 로그인 완료를 확인하지 못했어.")

    def login(self, timeout_seconds: int = DEFAULT_LOGIN_WAIT_SECONDS) -> dict[str, str]:
        sync_playwright, PlaywrightError, _ = self._playwright()
        try:
            with sync_playwright() as playwright:
                with self._persistent_context(playwright, headless=False) as context:
                    page = self._page(context)
                    try:
                        page.bring_to_front()
                    except Exception:
                        self.logger.debug("could not bring login page to front", exc_info=True)
                    page.goto(PORTAL_ENTRY_URL, wait_until="domcontentloaded", timeout=60000)
                    if _is_portal_page(page):
                        self.logger.info("login reused saved session")
                        return {"status": "authenticated", "url": _safe_url_path(page.url)}
                    self.logger.info("login window opened; waiting for user-authenticated portal page")
                    authenticated = self._wait_for_login(context, timeout_seconds)
                    self.logger.info("user-authenticated portal page detected: %s", _safe_url_path(authenticated.url))
                    return {"status": "authenticated", "url": _safe_url_path(authenticated.url)}
        except PortalError:
            raise
        except PlaywrightError as exc:
            self.logger.exception("login navigation failed")
            raise _portal_error("portal_unreachable", "포털 로그인 창을 처리하지 못했어.", exc) from exc

    @contextmanager
    def _authenticated_context(
        self,
        playwright: Any,
        response_handler: Any | None = None,
    ) -> Iterator[tuple[Any, Any]]:
        # Normal collection reuses the persistent profile without opening a
        # visible browser window. The headed context is reserved for the
        # explicit `login` command, so a sync does not keep popping Chrome.
        with self._persistent_context(playwright, headless=True) as context:
            page = self._page(context)
            if response_handler is not None:
                page.on("response", response_handler)
            try:
                page.goto(INFORMATION_HOME_URL, wait_until="domcontentloaded", timeout=60000)
            except Exception as exc:
                self.logger.exception("information page navigation failed")
                raise _portal_error("portal_unreachable", "포털 공지 페이지에 연결하지 못했어.", exc) from exc
            if _is_login_page(page):
                code = "session_expired" if profile_has_browser_state(self.profile_path) else "login_required"
                message = "학교 포털 세션이 만료되었어. login 명령으로 다시 로그인해줘." if code == "session_expired" else "학교 포털에 먼저 직접 로그인해줘."
                raise _portal_error(code, message)
            if not _is_portal_page(page):
                raise _portal_error("parsing_failed", "포털 공지 페이지 구조를 확인하지 못했어.")
            try:
                yield context, page
            finally:
                if response_handler is not None:
                    try:
                        page.remove_listener("response", response_handler)
                    except Exception:
                        pass

    def _capture_list_records(self, page: Any, candidates: list[list[dict[str, object]]]) -> list[NoticeSummary]:
        deadline = time.monotonic() + DEFAULT_WAIT_SECONDS
        stable_until = deadline
        largest_count = 0
        while time.monotonic() < deadline:
            if candidates:
                # The live page emits several Aura responses while the list
                # hydrates. Keep listening until the largest response has been
                # stable briefly, rather than accepting the first small
                # response from an unrelated list component.
                current_count = max(len(items) for items in candidates)
                if current_count > largest_count:
                    largest_count = current_count
                    stable_until = min(deadline, time.monotonic() + 1500 / 1000)
                elif time.monotonic() >= stable_until:
                    break
            page.wait_for_timeout(250)
        if not candidates:
            self.logger.error("no notice records found in portal XHR responses")
            raise _portal_error("parsing_failed", "공지 목록 JSON 응답을 찾지 못했어.")
        records: dict[str, dict[str, object]] = {}
        for candidate_list in candidates:
            for candidate in candidate_list:
                record_id = _text(candidate.get("Id"))
                if not record_id:
                    continue
                existing = records.setdefault(record_id, {})
                # The portal can emit a compact row first and a fuller row
                # later. Merge non-empty fields so a later partial response
                # does not erase metadata already captured.
                for key, value in candidate.items():
                    if value is not None and value != "":
                        existing[key] = value
        summaries = _unique_summaries(records.values(), page.url)
        if not summaries:
            raise _portal_error("parsing_failed", "공지 목록을 해석하지 못했어.")
        self.logger.info("captured merged portal notice records=%d summaries=%d", len(records), len(summaries))
        return summaries

    def _expand_notice_lists(self, page: Any) -> None:
        """Expand the live ALL and DM lists before collecting Aura responses.

        The portal initially renders the tabs with a ``すべて表示`` button and
        does not expose the complete list in the DOM until that button is
        activated for each tab. This is intentionally scoped to the observed
        notice page; if the UI changes, the JSON listener can still provide a
        useful parsing error and the debug log records which step was absent.
        """
        for tab_name in NOTICE_TYPES:
            try:
                tab = page.get_by_role("tab", name=tab_name, exact=True)
                if tab.count():
                    tab.first.click(timeout=10000)
                    page.wait_for_timeout(300)

                show_all = page.get_by_role("button", name="すべて表示", exact=True)
                if show_all.count():
                    show_all.first.click(timeout=10000)
                    page.wait_for_timeout(700)
                    self.logger.info("expanded portal notice list tab=%s", tab_name)
                else:
                    self.logger.debug("portal notice list already expanded or button missing tab=%s", tab_name)
            except Exception:
                self.logger.exception("portal notice list expansion failed tab=%s", tab_name)

    def list_notices(self) -> list[NoticeSummary]:
        sync_playwright, _, _ = self._playwright()
        candidates: list[list[dict[str, object]]] = []

        def on_response(response: Any) -> None:
            if response.request.resource_type not in ("xhr", "fetch"):
                return
            if "/sfsites/aura" not in response.url:
                return
            try:
                value = json.loads(response.body().decode("utf-8", "replace"))
            except Exception:
                return
            records = _record_list(value)
            if records:
                candidates.append(records)
                self.logger.info("captured portal JSON response path=%s records=%d", _safe_url_path(response.url), len(records))

        with sync_playwright() as playwright:
            with self._authenticated_context(playwright, response_handler=on_response) as (_, page):
                self._expand_notice_lists(page)
                return self._capture_list_records(page, candidates)

    def _get_notice_detail_on_page(self, page: Any, summary: NoticeSummary) -> dict[str, object]:
        try:
            # Some portal detail navigations keep network requests open. The
            # document is usable as soon as navigation commits; the rich-text
            # polling below waits for the actual detail marker.
            page.goto(
                summary.source_url,
                wait_until="commit",
                timeout=DETAIL_NAVIGATION_TIMEOUT_MS,
            )
        except Exception as exc:
            self.logger.exception("notice detail navigation failed")
            raise _portal_error("notice_detail_failed", "공지 상세 페이지를 열지 못했어.", exc) from exc
        if _is_login_page(page):
            raise _portal_error("session_expired", "학교 포털 세션이 만료되었어.")
        deadline = time.monotonic() + DEFAULT_WAIT_SECONDS
        rich_text = page.locator("lightning-formatted-rich-text.slds-rich-text-editor__output")
        while time.monotonic() < deadline and rich_text.count() == 0:
            page.wait_for_timeout(250)
        page_text = page.locator("body").inner_text(timeout=15000)
        if summary.title not in page_text and rich_text.count() == 0:
            self.logger.error("notice detail markers missing id=%s", summary.notice_id)
            raise _portal_error("notice_detail_failed", "공지 상세 내용을 해석하지 못했어.")
        body_values = [
            _text(value)
            for value in rich_text.all_inner_texts()
            if _text(value) and "言語切替/Language" not in _text(value)
        ]
        body = max(body_values, key=len) if body_values else ""
        title = extract_labeled_value(page_text, "タイトル", (*DETAIL_LABELS, "タイトル", "本文")) or summary.title
        detail: dict[str, object] = {
            **summary.to_db(),
            "title": title,
            "department": extract_labeled_value(page_text, "担当部課") or summary.department,
            "published_at": summary.published_at or extract_labeled_value(page_text, "公開日"),
            "expires_at": summary.expires_at or extract_labeled_value(page_text, "終了日"),
            # The detail DOM leaves the deadline label in place even when no
            # deadline is configured; the following footer/file-table text
            # must never become the deadline value. The list JSON is the
            # preferred canonical source, with a date-like DOM fallback.
            "deadline": summary.deadline or _validated_deadline(
                extract_labeled_value(page_text, "期日設定")
            ),
            "importance": extract_labeled_value(page_text, "重要度") or summary.importance,
            "category": extract_labeled_value(page_text, "配信カテゴリ") or summary.category,
            "body": body,
            "source_url": page.url,
        }
        detail["attachments"] = self._extract_attachments(page, body_locator=rich_text)
        self.logger.info("notice detail parsed id=%s attachments=%d", summary.notice_id, len(detail["attachments"]))
        return detail

    def get_notice_detail(self, summary: NoticeSummary) -> dict[str, object]:
        sync_playwright, _, _ = self._playwright()
        with sync_playwright() as playwright:
            with self._authenticated_context(playwright) as (_, page):
                return self._get_notice_detail_on_page(page, summary)

    def iter_notice_details(
        self,
        summaries: Iterable[NoticeSummary],
    ) -> Iterable[tuple[NoticeSummary, dict[str, object] | None, PortalError | None]]:
        """Read multiple details through one persistent context/browser."""
        sync_playwright, _, _ = self._playwright()
        with sync_playwright() as playwright:
            with self._authenticated_context(playwright) as (_, page):
                for summary in summaries:
                    try:
                        yield summary, self._get_notice_detail_on_page(page, summary), None
                    except PortalError as exc:
                        yield summary, None, exc
                    except Exception as exc:
                        self.logger.exception("unexpected notice detail parsing failure id=%s", summary.notice_id)
                        yield summary, None, _portal_error(
                            "notice_detail_failed",
                            "공지 상세 내용을 해석하지 못했어.",
                            cause=exc,
                        )

    @staticmethod
    def _extract_attachments(page: Any, *, body_locator: Any) -> list[dict[str, str]]:
        anchors: list[dict[str, object]] = []
        # Salesforce can render files inside the rich-text body or as a
        # separate attachment component. Inspect both, then keep only
        # file-like/download links so navigation anchors are not stored.
        locator = body_locator.first.locator("a") if body_locator.count() else page.locator("a")
        anchors = locator.evaluate_all(
            """(els) => els.map((e) => ({
                text: (e.innerText || e.textContent || '').trim(),
                href: e.href || '',
                download: e.getAttribute('download') || ''
            }))"""
        )
        if body_locator.count():
            anchors += page.locator("a").evaluate_all(
                """(els) => els.map((e) => ({
                    text: (e.innerText || e.textContent || '').trim(),
                    href: e.href || '',
                    download: e.getAttribute('download') || ''
                }))"""
            )
        attachments: list[dict[str, str]] = []
        seen: set[tuple[str, str]] = set()
        for anchor in anchors:
            href = _text(anchor.get("href"))
            text = _text(anchor.get("text"))
            download = _text(anchor.get("download"))
            if not href or not _attachment_candidate(href, text, download):
                continue
            key = (href, download or text)
            if key in seen:
                continue
            seen.add(key)
            attachments.append({"filename": _filename_from_link(href, text, download), "url": href})

        # The live portal's Salesforce file table does not expose an <a href>
        # for the Download action. It renders one row per file with the name
        # and extension in data-cell-value attributes and a button that starts
        # the download. Keep that metadata even when a stable file URL is not
        # available without initiating the download.
        try:
            rows = page.locator("tr[role='row']").evaluate_all(
                """(rows) => rows.map((row) => {
                    const nameCell = row.querySelector("[data-label='File Name']");
                    const typeCell = row.querySelector("[data-label='File Type']");
                    const link = row.querySelector("a[href]");
                    const name = (nameCell?.getAttribute('data-cell-value') || '').trim();
                    const extension = (typeCell?.getAttribute('data-cell-value') || '').trim();
                    const href = link?.href || '';
                    return {
                        filename: name && extension && !name.toLowerCase().endsWith(`.${extension.toLowerCase()}`)
                            ? `${name}.${extension}`
                            : name,
                        url: href,
                    };
                }).filter((item) => item.filename)"""
            )
        except Exception:
            rows = []
        for row in rows:
            filename = _text(row.get("filename"))
            href = _text(row.get("url"))
            if not filename:
                continue
            key = (href, filename)
            if key in seen:
                continue
            seen.add(key)
            attachments.append({"filename": filename, "url": href})
        return attachments


__all__ = [
    "DEFAULT_LOGIN_WAIT_SECONDS",
    "INFORMATION_HOME_URL",
    "NoticeSummary",
    "PortalClient",
    "PortalError",
    "browser_channel",
    "classify_notice_type",
    "extract_labeled_value",
    "open_url_in_default_browser",
    "profile_session_state",
    "resolve_profile_path",
    "validate_external_url",
]
