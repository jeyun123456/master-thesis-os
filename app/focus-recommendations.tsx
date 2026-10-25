'use client';

import { useEffect, useMemo, useState } from 'react';
import type { CalendarEvent } from '@/lib/calendar';
import { agentErrorText, mtosApi, waitForJob, type FocusState } from '@/lib/mtos-client';
import { focusSlots, type TaskMeta } from '@/lib/mtos-planning';
import type { P0Task } from '@/lib/p0-tasks-client';
import styles from './p0-home-tasks.module.css';

/**
 * AI picks 1–5 tasks for today. It never touches pinned focus tasks or
 * deadlines: accepting a pick marks it "오늘 집중" exactly like a manual pin.
 */
export function FocusRecommendations({ tasks, meta, today, calendarEvents, onAccept, onVisibleChange }: {
  tasks: P0Task[];
  meta: Map<string, TaskMeta>;
  today: string;
  calendarEvents: CalendarEvent[];
  onAccept: (task: P0Task) => Promise<void>;
  onVisibleChange: (ids: string[]) => void;
}) {
  const [state, setState] = useState<FocusState | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [condition, setCondition] = useState('');
  const [available, setAvailable] = useState(true);

  useEffect(() => {
    void mtosApi.focus(today).then((s) => { setState(s); setAvailable(true); }).catch(() => setAvailable(false));
  }, [today]);

  const open = useMemo(() => new Map(tasks.filter((t) => t.status === 'open' && !t.deleted).map((t) => [t.id, t])), [tasks]);
  const decided = new Set(state?.feedback.map((f) => f.task_id) ?? []);
  const visible = (state?.items ?? []).filter((item) => open.has(item.task_id) && !open.get(item.task_id)?.is_today && !decided.has(item.task_id));
  const visibleKey = visible.map((v) => v.task_id).join(',');
  useEffect(() => { onVisibleChange(visibleKey ? visibleKey.split(',') : []); }, [visibleKey, onVisibleChange]);

  async function recommend() {
    setBusy(true);
    setMessage('');
    try {
      const free = focusSlots(calendarEvents.filter((e) => e.status !== 'cancelled'), today, Date.now());
      const { job } = await mtosApi.requestJob('recommend_focus', {
        date: today, condition,
        pinned_ids: tasks.filter((t) => t.is_today).map((t) => t.id),
        free_slots: free,
        tasks: [...open.values()].map((t) => ({ id: t.id, title: t.title, status: t.status, due_date: t.due_date, project_id: t.project_id, category: t.category, blocked: Boolean(meta.get(t.id)?.blocked_reason), parent_task_id: meta.get(t.id)?.parent_task_id ?? null })),
      });
      await waitForJob(job.id);
      setState(await mtosApi.focus(today));
    } catch (error) {
      setMessage(`${agentErrorText(error, 'AI 추천에 실패했어.')} 오늘 집중은 직접 골라도 돼.`);
    } finally {
      setBusy(false);
    }
  }

  async function decide(taskId: string, action: 'accepted' | 'rejected') {
    const task = open.get(taskId);
    try {
      if (action === 'accepted' && task) await onAccept(task);
      setState(await mtosApi.focusFeedback(today, taskId, action));
    } catch (error) {
      setMessage(agentErrorText(error, '저장하지 못했어.'));
    }
  }

  if (!available) return <p className={styles.message}>AI 추천을 지금 쓸 수 없어. 오늘 집중은 직접 골라줘.</p>;
  return <div className={styles.recommend}>
    <div className={styles.recommendHead}>
      <b>AI 추천</b>
      <input value={condition} onChange={(e) => setCondition(e.target.value)} maxLength={300} placeholder="오늘 컨디션 (선택)" aria-label="오늘 컨디션" />
      <button className="mini" type="button" disabled={busy} onClick={() => void recommend()}>{busy ? '추천 중…' : visible.length ? '다시 추천' : '추천 받기'}</button>
    </div>
    {visible.length > 0 && <ul className={styles.taskList}>{visible.map((item) => <li key={item.task_id} className={styles.recommendRow}>
      <div><span className={styles.taskTitle}>{open.get(item.task_id)?.title}</span><span className={styles.taskMeta}>{item.reason}</span></div>
      <button className="mini primary" type="button" onClick={() => void decide(item.task_id, 'accepted')}>오늘 집중에 추가</button>
      <button className="mini" type="button" onClick={() => void decide(item.task_id, 'rejected')}>빼기</button>
    </li>)}</ul>}
    {state && state.free_slots.length > 0 && <p className={styles.message}>집중 가능 시간: {state.free_slots.map((s) => `${s.start}–${s.end}`).join(', ')} · 캘린더에는 자동으로 넣지 않아.</p>}
    {message && <p className={styles.message} role="status">{message}</p>}
  </div>;
}
