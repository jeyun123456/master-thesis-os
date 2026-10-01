from __future__ import annotations

import threading
from pathlib import Path

import portal_db


class PortalJobs:
    def __init__(self, root: Path, db_path: str | Path):
        self._root = root
        self._db_path = db_path
        self._job_lock = threading.Lock()
        self._job_thread: threading.Thread | None = None
        self._job_kind: str | None = None
        self._job_error: str | None = None
        self._job_error_code: str | None = None
        self._ai_lock = threading.Lock()
        self._ai_thread: threading.Thread | None = None
        self._ai_error: str | None = None
        self._ai_error_code: str | None = None

    def _job_active(self) -> bool:
        return self._job_thread is not None and self._job_thread.is_alive()

    def _ai_active(self) -> bool:
        return self._ai_thread is not None and self._ai_thread.is_alive()

    def _remember_job_end(self, error: str | None = None, error_code: str | None = None) -> None:
        with self._job_lock:
            self._job_thread = None
            self._job_kind = None
            self._job_error = error
            self._job_error_code = error_code

    def _remember_ai_end(self, error: str | None = None, error_code: str | None = None) -> None:
        with self._ai_lock:
            self._ai_thread = None
            self._ai_error = error
            self._ai_error_code = error_code

    def _run_sync_job(self) -> None:
        try:
            from portal_cli import sync_portal

            sync_portal(self._root, self._db_path)
        except Exception as exc:
            code = getattr(exc, 'code', 'parsing_failed')
            message = getattr(exc, 'message', '학교 공지 동기화가 중단되었어.')
            self._remember_job_end(message, code)
        else:
            self._remember_job_end()
            try:
                self.queue_backfill()
            except Exception:
                # Sync itself succeeded. AI backfill errors are exposed through the
                # independent AI worker state instead of turning sync into failure.
                pass

    def _run_login_job(self) -> None:
        try:
            from portal_cli import login_portal

            login_portal(self._root, self._db_path)
        except Exception as exc:
            code = getattr(exc, 'code', 'portal_unreachable')
            message = getattr(exc, 'message', '학교 포털 로그인 창을 처리하지 못했어.')
            self._remember_job_end(message, code)
        else:
            self._remember_job_end()

    def _run_ai_worker(self) -> None:
        last_error: str | None = None
        last_error_code: str | None = None
        try:
            import portal_ai

            while True:
                notice_ids = portal_db.claim_notice_analysis_batch(
                    portal_ai.MAX_NOTICE_BATCH_SIZE,
                    self._db_path,
                )
                if not notice_ids:
                    break
                notices: list[dict[str, object]] = []
                for notice_id in notice_ids:
                    notice = portal_db.get_notice(notice_id, self._db_path)
                    if notice is None:
                        portal_db.save_notice_analysis_failed(
                            notice_id,
                            'notice_not_found',
                            '공지 상세를 찾지 못했어.',
                            self._db_path,
                        )
                        continue
                    notices.append(notice)
                if not notices:
                    continue
                try:
                    results = portal_ai.analyze_notices(notices)
                except Exception as exc:
                    code = getattr(exc, 'code', 'ai_provider_failed')
                    message = getattr(exc, 'message', str(exc) or '공지 AI batch 분석이 중단되었어.')
                    last_error = message
                    last_error_code = code
                    for notice in notices:
                        try:
                            portal_db.save_notice_analysis_failed(
                                str(notice.get('noticeId') or notice.get('notice_id') or ''),
                                code,
                                message,
                                self._db_path,
                            )
                        except Exception:
                            pass
                    continue
                model = portal_ai.provider_model()
                analyzed_at = portal_db.now_iso()
                for notice in notices:
                    notice_id = str(notice.get('noticeId') or notice.get('notice_id') or '')
                    result = results.get(notice_id)
                    if result is None:
                        portal_db.save_notice_analysis_failed(
                            notice_id,
                            'ai_response_invalid',
                            'AI provider가 공지 결과를 반환하지 않았어.',
                            self._db_path,
                        )
                        continue
                    try:
                        portal_db.save_notice_analysis(
                            notice_id,
                            result,
                            portal_ai.PROMPT_VERSION,
                            model,
                            analyzed_at,
                            self._db_path,
                        )
                    except Exception as exc:
                        last_error = str(exc) or '공지 AI 분석 결과를 저장하지 못했어.'
                        last_error_code = getattr(exc, 'code', 'ai_storage_failed')
                        try:
                            portal_db.save_notice_analysis_failed(
                                notice_id,
                                last_error_code,
                                last_error,
                                self._db_path,
                            )
                        except Exception:
                            pass
        except Exception as exc:
            last_error = getattr(exc, 'message', str(exc) or '공지 AI worker가 중단되었어.')
            last_error_code = getattr(exc, 'code', 'ai_provider_failed')
        self._remember_ai_end(last_error, last_error_code)

    def _ensure_ai_worker(self) -> bool:
        with self._ai_lock:
            if self._ai_active():
                return False
            progress = portal_db.ai_progress(self._db_path)
            if progress.get('queued', 0) <= 0:
                return False
            self._ai_error = None
            self._ai_error_code = None
            self._ai_thread = threading.Thread(
                target=self._run_ai_worker,
                name='portal-ai-batch',
                daemon=True,
            )
            self._ai_thread.start()
            return True

    def queue_backfill(self, *, include_failed: bool = False) -> int:
        import portal_ai

        notice_ids = portal_db.notices_needing_analysis(
            portal_ai.PROMPT_VERSION,
            portal_ai.provider_model(),
            self._db_path,
            include_failed=include_failed,
        )
        queued = portal_db.queue_notice_analyses(
            notice_ids,
            self._db_path,
            force=True,
        )
        self._ensure_ai_worker()
        return queued

    def start_sync(self) -> bool:
        with self._job_lock:
            if self._job_active():
                return False
            self._job_error = None
            self._job_error_code = None
            self._job_kind = 'sync'
            self._job_thread = threading.Thread(target=self._run_sync_job, name='portal-sync', daemon=True)
            self._job_thread.start()
            return True

    def start_login(self) -> bool:
        with self._job_lock:
            if self._job_active():
                return False
            self._job_error = None
            self._job_error_code = None
            self._job_kind = 'login'
            self._job_thread = threading.Thread(target=self._run_login_job, name='portal-login', daemon=True)
            self._job_thread.start()
            return True

    def start_notice_analysis(self, notice_id: str, *, force: bool = False) -> bool:
        if not portal_db.queue_notice_analysis(notice_id, self._db_path, force=force):
            return False
        self._ensure_ai_worker()
        return True

    def status(self):
        try:
            from portal_client import profile_session_state, resolve_profile_path

            session_state = profile_session_state(resolve_profile_path(self._root))
        except Exception:
            session_state = 'unknown'
        with self._job_lock:
            active = self._job_active()
            job_kind = self._job_kind
            job_error = self._job_error
            job_error_code = self._job_error_code
        with self._ai_lock:
            ai_active = self._ai_active()
            ai_error = self._ai_error
            ai_error_code = self._ai_error_code
        if not active:
            portal_db.recover_interrupted_sync(self._db_path)
        if not ai_active:
            portal_db.recover_interrupted_ai(self._db_path)
        status = portal_db.sync_status(self._db_path)
        if not active and status.get('status') != 'running':
            try:
                self.queue_backfill()
            except Exception as exc:
                ai_error = getattr(exc, 'message', str(exc) or '공지 AI backfill을 시작하지 못했어.')
                ai_error_code = getattr(exc, 'code', 'ai_provider_failed')
            with self._ai_lock:
                ai_active = self._ai_active()
        ai_progress = portal_db.ai_progress(self._db_path)
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
            'ai': {
                **ai_progress,
                'running': ai_active,
                **({'error': ai_error} if ai_error else {}),
                **({'errorCode': ai_error_code} if ai_error_code else {}),
            },
        }
