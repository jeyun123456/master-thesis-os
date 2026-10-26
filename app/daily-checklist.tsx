'use client';

import { useEffect, useRef, useState } from 'react';
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

type DailyChecklistProps = { todayEventCount: number; onShowToday: () => void };

export function DailyChecklist({ todayEventCount, onShowToday }: DailyChecklistProps) {
  const [today, setToday] = useState(() => seoulDateKey());
  const [checklist, setChecklist] = useState<DailyChecklistRecord>(() => createDailyChecklist());
  const checklistRef = useRef(checklist);
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
          <span><strong>메일 확인</strong><small>Gmail · Outlook</small></span>
        </label>
      </div>

      <div className="daily-checklist-row">
        <label className="daily-checklist-label">
          <input type="checkbox" checked={checklist.items.portalSync} onChange={(event) => updateItem('portalSync', event.target.checked)} />
          <span><strong>학교 공지 확인</strong><small>연결 준비 중 · 직접 확인</small></span>
        </label>
      </div>

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
