from __future__ import annotations

import threading
from pathlib import Path

import mail_cli
import mail_db
from thunderbird_mail import ThunderbirdSettings


class MailJobs:
    def __init__(self, settings: ThunderbirdSettings, db_path: str | Path):
        self._settings = settings
        self._db_path = db_path
        self._job_lock = threading.Lock()
        self._job_thread: threading.Thread | None = None
        self._job_kind: str | None = None
        self._job_error: str | None = None
        self._ai_lock = threading.Lock()
        self._ai_thread: threading.Thread | None = None
        self._ai_error: str | None = None

    def _job_active(self) -> bool:
        return self._job_thread is not None and self._job_thread.is_alive()

    def _ai_active(self) -> bool:
        return self._ai_thread is not None and self._ai_thread.is_alive()

    def _remember_job_end(self, error: str | None = None) -> None:
        with self._job_lock:
            self._job_thread = None
            self._job_kind = None
            self._job_error = error

    def _remember_ai_end(self, error: str | None = None) -> None:
        with self._ai_lock:
            self._ai_thread = None
            self._ai_error = error

    def _run_sync_job(self) -> None:
        try:
            mail_cli.sync_mail(self._settings, self._db_path, analyze=False)
        except Exception:
            message = '메일 동기화 작업이 중단되었어.'
            for folder in mail_db.TARGET_FOLDERS:
                try:
                    mail_db.fail_sync_folder(folder, mail_db.now_iso(), message, self._db_path)
                except mail_db.MailDatabaseError:
                    pass
            self._remember_job_end(message)
        else:
            self._remember_job_end()
            self.ensure_ai_worker()

    def _run_ai_job(self) -> None:
        try:
            settings = mail_cli.load_settings()
            while True:
                mail_cli.analyze_new(settings, self._db_path)
                status = mail_db.sync_status(self._db_path)
                if int(status.get('counts', {}).get('queued', 0)) <= 0:
                    break
        except Exception:
            self._remember_ai_end('메일 AI 분석 작업이 중단되었어.')
        else:
            self._remember_ai_end()

    def ensure_ai_worker(self) -> bool:
        with self._ai_lock:
            if self._ai_active() or self._job_active():
                return False
            status = mail_db.sync_status(self._db_path)
            if int(status.get('counts', {}).get('queued', 0)) <= 0:
                return False
            self._ai_error = None
            self._ai_thread = threading.Thread(target=self._run_ai_job, name='mail-ai-batch', daemon=True)
            self._ai_thread.start()
            return True

    def start_sync(self) -> bool:
        with self._job_lock:
            if self._job_active():
                return False
            self._job_error = None
            self._job_kind = 'sync'
            self._job_thread = threading.Thread(target=self._run_sync_job, name='mail-sync', daemon=True)
            self._job_thread.start()
            return True

    def status(self) -> dict[str, object]:
        with self._job_lock:
            active = self._job_active()
            job_kind = self._job_kind
            job_error = self._job_error
        with self._ai_lock:
            ai_active = self._ai_active()
            ai_error = self._ai_error
        if not active and not ai_active:
            mail_db.recover_interrupted_analysis(self._db_path)
            self.ensure_ai_worker()
            with self._ai_lock:
                ai_active = self._ai_active()
                ai_error = self._ai_error
        status = mail_db.sync_status(self._db_path)
        return {
            'ok': True,
            'source': 'sqlite',
            **status,
            'jobRunning': active,
            **({'jobKind': job_kind} if job_kind else {}),
            **({'jobError': job_error} if job_error else {}),
            'aiRunning': ai_active,
            **({'aiError': ai_error} if ai_error else {}),
        }
