'use client';

import { useEffect, useRef, useState } from 'react';
import { getMailSyncStatus, startMailSync } from '@/lib/mail-analysis-client';
import type { MailSyncStatus } from '@/lib/mail-analysis';
import { getPortalStatus, startPortalSync } from '@/lib/portal-notices-client';
import type { PortalSyncStatus } from '@/lib/portal-notices-client';
import {
  createDailyChecklist,
  dailyChecklistCompletedCount,
  loadDailyChecklist,
  saveDailyChecklist,
  seoulDateKey,
  setDailyChecklistItem,
  type DailyChecklistItemId,
  type DailyChecklistRecord,
} from '@/lib/daily-checklist';
import { startAndWaitForDailySync } from '@/lib/daily-checklist-actions';
import { readBridgeToken } from '@/lib/inbox-persistence-client';

type DailyChecklistProps = { todayEventCount: number; onShowToday: () => void };
type SyncAction = 'mail' | 'portal' | null;

function formatLastSync(value: string | null | undefined): string {
  if (!value) return '오늘 실행 전';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '시간 정보 없음';
  return `마지막 ${new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date)}`;
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function DailyChecklist({ todayEventCount, onShowToday }: DailyChecklistProps) {
  const [today, setToday] = useState(() => seoulDateKey());
  const [checklist, setChecklist] = useState<DailyChecklistRecord>(() => createDailyChecklist());
  const checklistRef = useRef(checklist);
  const [mailStatus, setMailStatus] = useState<MailSyncStatus | null>(null);
  const [portalStatus, setPortalStatus] = useState<PortalSyncStatus | null>(null);
  const [activeSync, setActiveSync] = useState<SyncAction>(null);
  const [syncError, setSyncError] = useState<{ item: 'mailSync' | 'portalSync'; message: string } | null>(null);
  const [storageError, setStorageError] = useState('');

  useEffect(() => {
    const updateToday = () => setToday(seoulDateKey());
    updateToday();
    const timer = window.setInterval(updateToday, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const next = loadDailyChecklist(undefined, today);
    checklistRef.current = next;
    setChecklist(next);
  }, [today]);

  useEffect(() => {
    let cancelled = false;
    const token = readBridgeToken();
    if (!token) return () => { cancelled = true; };

    void Promise.allSettled([getMailSyncStatus(token), getPortalStatus(token)]).then(([mail, portal]) => {
      if (cancelled) return;
      if (mail.status === 'fulfilled') setMailStatus(mail.value);
      if (portal.status === 'fulfilled') setPortalStatus(portal.value);
    });
    return () => { cancelled = true; };
  }, []);

  function updateItem(item: DailyChecklistItemId, checked: boolean) {
    const date = seoulDateKey();
    const current = checklistRef.current.date === date
      ? checklistRef.current
      : loadDailyChecklist(undefined, date);
    const next = setDailyChecklistItem(current, item, checked);
    checklistRef.current = next;
    setChecklist(next);
    setToday(date);
    setStorageError(saveDailyChecklist(next) ? '' : '오늘 체크 상태를 브라우저에 저장하지 못했어요.');
  }

  async function runSync(kind: 'mail' | 'portal') {
    if (activeSync) return;
    const item = kind === 'mail' ? 'mailSync' : 'portalSync';
    const token = readBridgeToken();
    setActiveSync(kind);
    setSyncError(null);
    try {
      if (kind === 'mail') {
        const result = await startAndWaitForDailySync({
          start: () => startMailSync(token),
          readStatus: () => getMailSyncStatus(token),
        });
        setMailStatus(result);
      } else {
        const result = await startAndWaitForDailySync({
          start: () => startPortalSync(token),
          readStatus: () => getPortalStatus(token),
        });
        setPortalStatus(result);
      }
      updateItem(item, true);
    } catch (error) {
      updateItem(item, false);
      setSyncError({
        item,
        message: errorText(error, kind === 'mail' ? '메일 동기화에 실패했어요.' : '학교 공지 동기화에 실패했어요.'),
      });
    } finally {
      setActiveSync(null);
    }
  }

  const completed = dailyChecklistCompletedCount(checklist);

  return <section className="card section daily-checklist-card" aria-labelledby="daily-checklist-title">
    <div className="head daily-checklist-head">
      <div>
        <span className="capture-eyebrow">DAILY CHECK</span>
        <h3 id="daily-checklist-title">오늘의 기본 확인</h3>
      </div>
      <span className="daily-checklist-count">{completed} / 3 완료</span>
    </div>

    <div className="daily-checklist-items">
      <div className="daily-checklist-row">
        <label className="daily-checklist-label">
          <input type="checkbox" checked={checklist.items.mailSync} onChange={(event) => updateItem('mailSync', event.target.checked)} />
          <span><strong>메일 동기화</strong><small>{formatLastSync(mailStatus?.lastSyncAt)}</small></span>
        </label>
        <button type="button" className="daily-checklist-action" disabled={activeSync !== null} onClick={() => void runSync('mail')}>
          {activeSync === 'mail' ? '동기화 중…' : '동기화'}
        </button>
      </div>
      {syncError?.item === 'mailSync' && <p className="daily-checklist-error" role="alert">{syncError.message}</p>}

      <div className="daily-checklist-row">
        <label className="daily-checklist-label">
          <input type="checkbox" checked={checklist.items.portalSync} onChange={(event) => updateItem('portalSync', event.target.checked)} />
          <span><strong>학교 공지 동기화</strong><small>{formatLastSync(portalStatus?.lastSyncAt)}</small></span>
        </label>
        <button type="button" className="daily-checklist-action" disabled={activeSync !== null} onClick={() => void runSync('portal')}>
          {activeSync === 'portal' ? '동기화 중…' : '동기화'}
        </button>
      </div>
      {syncError?.item === 'portalSync' && <p className="daily-checklist-error" role="alert">{syncError.message}</p>}

      <div className="daily-checklist-row">
        <label className="daily-checklist-label">
          <input type="checkbox" checked={checklist.items.todaySchedule} onChange={(event) => updateItem('todaySchedule', event.target.checked)} />
          <span><strong>금일 일정 확인</strong><small>오늘 일정 {todayEventCount}건</small></span>
        </label>
        <button type="button" className="daily-checklist-action" onClick={onShowToday}>일정 보기</button>
      </div>
    </div>

    {storageError && <p className="daily-checklist-error" role="status">{storageError}</p>}
    <div className="daily-checklist-progress" aria-label={`오늘 checklist ${completed}개 완료, 3개 중`}>
      <span style={{ width: `${(completed / 3) * 100}%` }} />
    </div>
    <span className="sr-only">기준 날짜 {today}</span>
  </section>;
}
