'use client';

import { useEffect, useState } from 'react';
import { agentErrorText, mtosApi, waitForJob } from '@/lib/mtos-client';
import { addDays, nextStep, type RecurRule, type TaskMeta } from '@/lib/mtos-planning';
import { addSteps } from '@/lib/mtos-task-actions';
import type { P0Task } from '@/lib/p0-tasks-client';
import styles from './p0-home-tasks.module.css';

type BlockEvent = { event: string; reason: string; until_date: string | null; created_at: string };

/** Steps, blockers and recurrence for one task. Lives beside the P0 edit form; all of it is optional extension data. */
export function TaskAssist({ task, tasks, meta, today, onChanged, onCompleteParent }: {
  task: P0Task;
  tasks: P0Task[];
  meta: Map<string, TaskMeta>;
  today: string;
  onChanged: () => void;
  onCompleteParent: (task: P0Task) => void;
}) {
  const own = meta.get(task.id);
  const steps = nextStep(task.id, tasks, meta);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [proposal, setProposal] = useState<string[]>([]);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [manualStep, setManualStep] = useState('');
  const [reason, setReason] = useState(own?.blocked_reason ?? '');
  const [until, setUntil] = useState(addDays(today, 3));
  const [suggestions, setSuggestions] = useState<Array<{ kind: string; title: string; detail: string }>>([]);
  const [events, setEvents] = useState<BlockEvent[]>([]);
  const [recur, setRecur] = useState<RecurRule>(own?.recur ?? { mode: 'fixed', every_days: 7, anchor_date: task.due_date ?? today });

  useEffect(() => {
    setProposal([]); setSuggestions([]); setMessage(''); setReason(own?.blocked_reason ?? '');
    setRecur(own?.recur ?? { mode: 'fixed', every_days: 7, anchor_date: task.due_date ?? today });
    void mtosApi.blockEvents(task.id).then((r) => setEvents(r.events)).catch(() => setEvents([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id]);

  async function run(action: () => Promise<unknown>, done: string) {
    setBusy(true);
    setMessage('');
    try {
      await action();
      setMessage(done);
      onChanged();
    } catch (error) {
      setMessage(agentErrorText(error, '처리하지 못했어.'));
    } finally {
      setBusy(false);
    }
  }

  const ai = async <T,>(type: 'decompose_task' | 'unblock_task', input: unknown) => {
    const { job } = await mtosApi.requestJob(type, input);
    return (await waitForJob(job.id)).result as T;
  };

  return <div className={styles.assist}>
    <section>
      <h5>단계 나누기 {steps.total > 0 && <small>{steps.done}/{steps.total} 완료</small>}</h5>
      {steps.next && <p className={styles.message}>다음 단계: <b>{steps.next.title}</b></p>}
      {steps.allDone && task.status === 'open' && <p className={styles.message}>모든 단계를 마쳤어. 상위 작업도 끝났는지 확인해줘. <button className="mini" type="button" onClick={() => onCompleteParent(task)}>상위 작업 완료</button></p>}
      <div className={styles.inlineFields}>
        <button className="mini" type="button" disabled={busy} onClick={() => void run(async () => {
          const result = await ai<{ steps: Array<{ title: string }> }>('decompose_task', { task: { id: task.id, title: task.title, memo: task.memo } });
          setProposal(result.steps.map((s) => s.title));
          setPicked(new Set(result.steps.map((_, i) => i)));
        }, '단계를 제안했어. 넣을 단계를 골라줘.')}>AI로 나누기</button>
        <input value={manualStep} onChange={(e) => setManualStep(e.target.value)} placeholder="직접 단계 추가" aria-label="단계 제목" />
        <button className="mini" type="button" disabled={busy || !manualStep.trim()} onClick={() => void run(async () => { await addSteps(task, [manualStep], steps.total + 1, crypto.randomUUID()); setManualStep(''); }, '단계를 추가했어.')}>추가</button>
      </div>
      {proposal.length > 0 && <div>
        <ul className={styles.checkList}>{proposal.map((title, i) => <li key={i}><label><input type="checkbox" checked={picked.has(i)} onChange={() => setPicked((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; })} /> {title}</label></li>)}</ul>
        <button className="mini primary" type="button" disabled={busy || !picked.size} onClick={() => void run(async () => {
          await addSteps(task, proposal.filter((_, i) => picked.has(i)), steps.total + 1, crypto.randomUUID());
          setProposal([]);
        }, '선택한 단계를 할 일로 추가했어.')}>선택한 단계 추가</button>
      </div>}
    </section>

    <section>
      <h5>막힘 {own?.blocked_reason && <small className={styles.overdue}>막힘 중</small>}</h5>
      <div className={styles.inlineFields}>
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="막힌 이유" aria-label="막힌 이유" maxLength={2000} />
        <button className="mini" type="button" disabled={busy || !reason.trim()} onClick={() => void run(() => mtosApi.blockTask(task.id, { event: 'blocked', reason }).then((r) => setEvents(r.events)), '막힘 이유를 기록했어.')}>기록</button>
        {own?.blocked_reason && <button className="mini" type="button" disabled={busy} onClick={() => void run(() => mtosApi.blockTask(task.id, { event: 'unblocked' }).then((r) => setEvents(r.events)), '막힘을 해제했어. 기록은 남아.')}>해제</button>}
      </div>
      <div className={styles.inlineFields}>
        <input type="date" value={until} min={addDays(today, 1)} onChange={(e) => setUntil(e.target.value)} aria-label="다시 표시할 날짜" />
        <button className="mini" type="button" disabled={busy || !until} onClick={() => void run(() => mtosApi.blockTask(task.id, { event: 'snoozed', until }).then((r) => setEvents(r.events)), `${until}까지 목록에서 숨겼어.`)}>잠시 미루기</button>
        <button className="mini" type="button" disabled={busy} onClick={() => void run(async () => {
          const result = await ai<{ suggestions: Array<{ kind: string; title: string; detail: string }> }>('unblock_task', { task: { id: task.id, title: task.title, memo: task.memo }, reason });
          setSuggestions(result.suggestions);
        }, 'AI가 해결 방법을 제안했어.')}>AI 해결 제안</button>
      </div>
      {suggestions.length > 0 && <ul className={styles.checkList}>{suggestions.map((s, i) => <li key={i}>
        <b>{s.kind === 'smaller_step' ? '작은 단계' : s.kind === 'alternative' ? '다른 방법' : '미루기'}</b>: {s.title} <small>{s.detail}</small>
        {s.kind !== 'defer' && <button className="mini" type="button" disabled={busy} onClick={() => void run(() => addSteps(task, [s.title], steps.total + 1, crypto.randomUUID()), '단계로 추가했어.')}>단계로 추가</button>}
      </li>)}</ul>}
      {events.length > 0 && <details><summary>막힘 기록 {events.length}건</summary><ol className={styles.checkList}>{events.map((e, i) => <li key={i}>{new Date(e.created_at).toLocaleDateString('ko-KR')} · {e.event === 'blocked' ? `막힘: ${e.reason}` : e.event === 'snoozed' ? `${e.until_date}까지 미룸` : e.event === 'unblocked' ? '해제' : e.reason}</li>)}</ol></details>}
    </section>

    <section>
      <h5>반복</h5>
      <div className={styles.inlineFields}>
        <select value={recur.mode} onChange={(e) => setRecur({ ...recur, mode: e.target.value as RecurRule['mode'] })} aria-label="반복 기준">
          <option value="fixed">고정 날짜 기준</option><option value="after_completion">마지막 완료일 기준</option>
        </select>
        <label>매 <input type="number" min={1} max={366} value={recur.every_days} onChange={(e) => setRecur({ ...recur, every_days: Number(e.target.value) || 1 })} aria-label="반복 간격(일)" />일</label>
        {recur.mode === 'fixed' && <input type="date" value={recur.anchor_date ?? ''} onChange={(e) => setRecur({ ...recur, anchor_date: e.target.value })} aria-label="기준 날짜" />}
        <button className="mini" type="button" disabled={busy || (recur.mode === 'fixed' && !recur.anchor_date)} onClick={() => void run(() => mtosApi.putTaskMeta(task.id, { recur: { ...recur, anchor_date: recur.mode === 'fixed' ? recur.anchor_date : null }, series_id: own?.series_id ?? task.id }), '반복을 저장했어. 완료하면 다음 회차가 생겨.')}>저장</button>
        {own?.recur && <button className="mini" type="button" disabled={busy} onClick={() => void run(() => mtosApi.putTaskMeta(task.id, { recur: null }), '반복을 껐어.')}>반복 끄기</button>}
      </div>
    </section>
    {message && <p className={styles.message} role="status">{message}</p>}
  </div>;
}
