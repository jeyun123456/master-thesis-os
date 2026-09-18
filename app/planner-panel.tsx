'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  openThunderbird,
  openThunderbirdMessage,
  ThunderbirdMailError,
  thunderbirdMailErrorMessage,
  type ThunderbirdMailErrorCode,
} from '../lib/thunderbird-mail';
import {
  getMailPlanning,
  MailAnalysisClientError,
  readBridgeToken,
  updateMailCandidate,
  updateMailTask,
} from '../lib/mail-analysis-client';
import type { MailAnalysisItem, StoredMailCalendarCandidate } from '../lib/mail-analysis';
import type { MailPlanning, MailTask, MailTaskStatus } from '../lib/mail-planning';
import { addCalendarEvent } from '../lib/calendar-client';
import { CalendarCandidateCard, type CalendarCandidateEdit } from './mail-analysis-details';

type PlannerState = 'loading' | 'ready' | 'empty' | 'error';

type PlannerCandidate = {
  item: MailAnalysisItem;
  candidate: StoredMailCalendarCandidate;
};

export function PlannerPanel() {
  const [planning, setPlanning] = useState<MailPlanning | null>(null);
  const [state, setState] = useState<PlannerState>('loading');
  const [error, setError] = useState('');
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [openingMailId, setOpeningMailId] = useState<string | null>(null);
  const [openError, setOpenError] = useState<ThunderbirdMailErrorCode | null>(null);

  const loadPlanning = useCallback(async () => {
    setState('loading');
    setError('');
    try {
      const next = await getMailPlanning(readBridgeToken());
      setPlanning(next);
      setState(next.tasks.some((task) => task.status === 'pending' || task.status === 'snoozed') || pendingCandidateCount(next.items) ? 'ready' : 'empty');
    } catch (reason) {
      setPlanning(null);
      setError(reason instanceof Error ? reason.message : '메일 플래너를 읽지 못했어.');
      setState('error');
    }
  }, []);

  useEffect(() => {
    void loadPlanning();
  }, [loadPlanning]);

  const activeTasks = useMemo(
    () => (planning?.tasks || []).filter((task) => task.status === 'pending' || task.status === 'snoozed'),
    [planning?.tasks],
  );
  const closedTasks = useMemo(
    () => (planning?.tasks || []).filter((task) => task.status === 'done' || task.status === 'dismissed'),
    [planning?.tasks],
  );
  const pendingCandidates = useMemo<PlannerCandidate[]>(
    () => (planning?.items || []).flatMap((item) => item.candidates
      .filter((candidate) => candidate.status === 'pending')
      .map((candidate) => ({ item, candidate }))),
    [planning?.items],
  );

  async function changeTaskStatus(task: MailTask, status: MailTaskStatus) {
    setBusyTaskId(task.id);
    setError('');
    try {
      const updated = await updateMailTask(readBridgeToken(), { taskId: task.id, status });
      setPlanning((current) => current ? { ...current, tasks: current.tasks.map((value) => value.id === updated.id ? updated : value) } : current);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '할 일 상태를 저장하지 못했어.');
    } finally {
      setBusyTaskId(null);
    }
  }

  async function openMail(item: MailAnalysisItem) {
    setOpeningMailId(item.mail.id);
    setOpenError(null);
    try {
      if (item.mail.messageId) await openThunderbirdMessage(readBridgeToken(), item.mail.messageId);
      else await openThunderbird(readBridgeToken());
    } catch (reason) {
      setOpenError(readErrorCode(reason));
    } finally {
      setOpeningMailId(null);
    }
  }

  async function addCandidate(item: MailAnalysisItem, candidate: StoredMailCalendarCandidate, edit: CalendarCandidateEdit) {
    const result = await addCalendarEvent({
      mailId: item.mail.id,
      candidateId: candidate.id,
      title: edit.title,
      start: edit.start,
      end: edit.end,
      allDay: edit.allDay,
      type: candidate.type,
      reason: candidate.reason,
    });
    const updated = await updateMailCandidate(readBridgeToken(), {
      mailId: item.mail.id,
      candidateId: candidate.id,
      status: 'added',
      ...edit,
      ...(result.eventId ? { calendarEventId: result.eventId } : {}),
    });
    replaceCandidate(item.mail.id, updated);
  }

  async function ignoreCandidate(item: MailAnalysisItem, candidate: StoredMailCalendarCandidate) {
    const updated = await updateMailCandidate(readBridgeToken(), {
      mailId: item.mail.id,
      candidateId: candidate.id,
      status: 'ignored',
      title: candidate.title,
      start: candidate.start,
      end: candidate.end,
      allDay: candidate.allDay,
    });
    replaceCandidate(item.mail.id, updated);
  }

  function replaceCandidate(mailId: string, updated: StoredMailCalendarCandidate) {
    setPlanning((current) => current ? {
      ...current,
      items: current.items.map((item) => item.mail.id !== mailId ? item : {
        ...item,
        candidates: item.candidates.map((candidate) => candidate.id === updated.id ? updated : candidate),
      }),
    } : current);
  }

  if (state === 'loading') {
    return <section className="card section planner-panel"><div className="microsoft-mail-state">SQLite에 저장된 할 일과 일정 후보를 확인하는 중이야…</div></section>;
  }

  if (state === 'error' || !planning) {
    return <section className="card section planner-panel"><div className="head"><h3>플래너</h3><span>SQLite ● 로컬</span></div><div className="error">{error || '메일 플래너를 읽지 못했어.'}</div><div className="toolbar planner-actions"><button className="mini" onClick={() => void loadPlanning()} type="button">다시 시도</button></div></section>;
  }

  return <div className="planner-panel">
    <section className="card section planner-summary">
      <div className="head"><div><h3>메일 기반 일정관리</h3><small>Thunderbird의 학교 업무·국제과 메일을 기준으로 관리해.</small></div><span>SQLite ● 로컬</span></div>
      <div className="planner-summary-grid">
        <div><small>마지막 동기화</small><b>{formatSyncDate(planning.sync.lastSyncAt)}</b></div>
        <div><small>진행 중인 할 일</small><b>{activeTasks.length}건</b></div>
        <div><small>확인할 일정 후보</small><b>{pendingCandidates.length}건</b></div>
        <div><small>분석 실패</small><b>{planning.sync.analysisFailed}건</b></div>
      </div>
      <div className="note">새 메일 수집과 AI 분석은 메일 탭의 <b>메일 분석 동기화</b>를 눌렀을 때만 실행돼. 이 탭은 저장된 결과만 읽어.</div>
    </section>

    <section className="card section section-gap">
      <div className="head"><h3>해야 할 일</h3><span>{activeTasks.length ? `${activeTasks.length}건 진행 중` : '없음'}</span></div>
      {activeTasks.length ? <div className="planner-task-list">{activeTasks.map((task) => <PlannerTaskRow
        busy={busyTaskId === task.id}
        key={task.id}
        onOpen={() => { const item = planning.items.find((value) => value.mail.id === task.mailId); if (item) void openMail(item); }}
        onStatus={(status) => void changeTaskStatus(task, status)}
        task={task}
      />)}</div> : <div className="empty compact-empty">현재 진행 중인 할 일이 없어.</div>}
      {closedTasks.length > 0 && <details className="planner-closed"><summary>완료·숨김 {closedTasks.length}건 보기</summary><div className="planner-task-list">{closedTasks.map((task) => <PlannerTaskRow
        busy={busyTaskId === task.id}
        compact
        key={task.id}
        onOpen={() => { const item = planning.items.find((value) => value.mail.id === task.mailId); if (item) void openMail(item); }}
        onStatus={(status) => void changeTaskStatus(task, status)}
        task={task}
      />)}</div></details>}
    </section>

    <section className="card section section-gap">
      <div className="head"><h3>일정 후보</h3><span>사용자 확인 후 Calendar 등록</span></div>
      {pendingCandidates.length ? <div className="planner-candidate-list">{pendingCandidates.map(({ item, candidate }) => <article className="planner-candidate" key={candidate.id}>
        <div className="planner-candidate-source"><b>{item.mail.subject}</b><small>{item.mail.senderName} · {folderLabel(item.folder)}</small></div>
        <CalendarCandidateCard candidate={candidate} onAdd={(next, edit) => addCandidate(item, next, edit)} onIgnore={(next) => ignoreCandidate(item, next)} />
      </article>)}</div> : <div className="empty compact-empty">현재 확인할 일정 후보가 없어.</div>}
    </section>

    {planning.items.some((item) => item.analysis.status === 'failed') && <section className="card section section-gap"><div className="note">AI 분석에 실패한 메일이 있어. 메일 탭에서 해당 메일의 <b>AI 재분석</b>을 실행해줘.</div></section>}
    {openError && <div className="error planner-open-error">{thunderbirdMailErrorMessage(openError)}</div>}
    {error && <div className="error planner-open-error">{error}</div>}
    <div className="toolbar planner-actions"><button className="mini" onClick={() => void loadPlanning()} type="button">새로고침</button></div>
  </div>;
}

function PlannerTaskRow({
  task,
  busy,
  compact = false,
  onStatus,
  onOpen,
}: {
  task: MailTask;
  busy: boolean;
  compact?: boolean;
  onStatus: (status: MailTaskStatus) => void;
  onOpen: () => void;
}) {
  const active = task.status === 'pending' || task.status === 'snoozed';
  return <article className={`planner-task-row ${task.status}${compact ? ' compact' : ''}`}>
    <span className="planner-task-check" aria-hidden="true">{task.status === 'done' ? '✓' : task.status === 'dismissed' ? '–' : '○'}</span>
    <div className="planner-task-main"><b>{task.title}</b><small>{task.mail.subject} · {folderLabel(task.folder)}</small>{task.dueAt && <small className="planner-task-due">기한 {formatPlannerDate(task.dueAt)}</small>}</div>
    <div className="planner-task-actions">
      <button className="mini" disabled={busy} onClick={onOpen} type="button">메일 열기</button>
      {active ? <><button className="mini" disabled={busy} onClick={() => onStatus('done')} type="button">완료</button><button className="mini" disabled={busy} onClick={() => onStatus(task.status === 'snoozed' ? 'pending' : 'snoozed')} type="button">{task.status === 'snoozed' ? '다시 진행' : '나중에'}</button><button className="mini" disabled={busy} onClick={() => onStatus('dismissed')} type="button">숨기기</button></> : <button className="mini" disabled={busy} onClick={() => onStatus('pending')} type="button">다시 열기</button>}
    </div>
  </article>;
}

function pendingCandidateCount(items: MailAnalysisItem[]): number {
  return items.reduce((count, item) => count + item.candidates.filter((candidate) => candidate.status === 'pending').length, 0);
}

function folderLabel(folder: MailAnalysisItem['folder'] | MailTask['folder']): string {
  return folder === 'international-office' ? '국제과' : '학교 업무';
}

function formatPlannerDate(value: string): string {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const date = new Date(dateOnly ? `${value}T00:00:00+09:00` : value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    ...(dateOnly ? {} : { hour: '2-digit', minute: '2-digit' }),
  }).format(date);
}

function formatSyncDate(value: string | null): string {
  return value ? formatPlannerDate(value) : '없음';
}

function readErrorCode(error: unknown): ThunderbirdMailErrorCode {
  if (error instanceof ThunderbirdMailError) return error.code;
  if (error instanceof MailAnalysisClientError) return error.code === 'bridge_auth' ? 'bridge_auth' : 'bridge_offline';
  return 'bridge_offline';
}
