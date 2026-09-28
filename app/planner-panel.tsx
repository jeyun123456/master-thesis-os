'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { dashboardApi, type CalendarApiResponse } from '@/lib/client-api';
import type { CalendarEvent } from '@/lib/calendar';
import { addCalendarEvent } from '@/lib/calendar-client';
import {
  addPlannerTask,
  loadPlannerTasks,
  savePlannerTasks,
} from '@/lib/planner-tasks-client';
import { loadCachedPlannerTasks, mergePlannerTasks, saveCachedPlannerTasks, type PlannerTask, type PlannerTaskStatus } from '@/lib/planner-tasks';
import { getMailPlanning, MailAnalysisClientError, readBridgeToken, updateMailCandidate, updateMailTask } from '@/lib/mail-analysis-client';
import type { MailAnalysisItem, StoredMailCalendarCandidate } from '@/lib/mail-analysis';
import type { MailPlanning, MailTask, MailTaskStatus } from '@/lib/mail-planning';
import { openThunderbird, openThunderbirdMessage, ThunderbirdMailError, thunderbirdMailErrorMessage, type ThunderbirdMailErrorCode } from '@/lib/thunderbird-mail';
import { CalendarCandidateCard, type CalendarCandidateEdit } from './mail-analysis-details';

type PlannerCandidate = { item: MailAnalysisItem; candidate: StoredMailCalendarCandidate };
type CalendarResponse = CalendarApiResponse;

export function PlannerPanel() {
  const [month, setMonth] = useState(() => currentMonth());
  const [selectedDate, setSelectedDate] = useState(() => todayDate());
  const [calendar, setCalendar] = useState<CalendarResponse | null>(null);
  const [calendarLoading, setCalendarLoading] = useState(true);
  const [calendarError, setCalendarError] = useState('');
  const [tasks, setTasks] = useState<PlannerTask[]>([]);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [taskError, setTaskError] = useState('');
  const [vaultSaved, setVaultSaved] = useState(false);
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [planning, setPlanning] = useState<MailPlanning | null>(null);
  const [mailError, setMailError] = useState('');
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [openingMailId, setOpeningMailId] = useState<string | null>(null);
  const [openError, setOpenError] = useState<ThunderbirdMailErrorCode | null>(null);

  const loadMonth = useCallback(async () => {
    setCalendarLoading(true);
    setCalendarError('');
    try {
      const next = await dashboardApi.calendarMonth(month);
      setCalendar(next);
      if (next.error) setCalendarError(next.error);
    } catch (error) {
      setCalendar(null);
      setCalendarError(error instanceof Error ? error.message : 'Google Calendar을 불러오지 못했어.');
    } finally {
      setCalendarLoading(false);
    }
  }, [month]);

  const loadTasks = useCallback(async () => {
    setTasksLoading(true);
    const cached = loadCachedPlannerTasks();
    setTasks(cached);
    try {
      const stored = await loadPlannerTasks();
      const merged = mergePlannerTasks(stored, cached);
      setTasks(merged);
      saveCachedPlannerTasks(merged);
      const storedById = new Map(stored.map((task) => [task.id, task]));
      const needsSync = merged.some((task) => {
        const value = storedById.get(task.id);
        return !value || Date.parse(task.updatedAt) > Date.parse(value.updatedAt);
      });
      if (needsSync) {
        const saved = await savePlannerTasks(merged);
        setTasks(saved);
        saveCachedPlannerTasks(saved);
      }
      setVaultSaved(true);
      setTaskError('');
    } catch (error) {
      setVaultSaved(false);
      setTaskError(error instanceof Error ? `${error.message} 브라우저 캐시는 유지돼.` : 'Vault에 연결하지 못했어. 브라우저 캐시는 유지돼.');
    } finally {
      setTasksLoading(false);
    }
  }, []);

  useEffect(() => { void loadMonth(); }, [loadMonth]);
  useEffect(() => { void loadTasks(); }, [loadTasks]);
  useEffect(() => {
    let active = true;
    void getMailPlanning(readBridgeToken()).then((next) => {
      if (active) { setPlanning(next); setMailError(''); }
    }).catch((error) => {
      if (active) setMailError(error instanceof Error ? error.message : '메일에서 나온 보조 일정 후보를 읽지 못했어.');
    });
    return () => { active = false; };
  }, []);

  const activeTasks = useMemo(() => tasks.filter((task) => task.status === 'pending'), [tasks]);
  const doneTasks = useMemo(() => tasks.filter((task) => task.status === 'done'), [tasks]);
  const pendingCandidates = useMemo<PlannerCandidate[]>(() => (planning?.items || []).flatMap((item) => item.candidates
    .filter((candidate) => candidate.status === 'pending')
    .map((candidate) => ({ item, candidate }))), [planning?.items]);
  const eventsByDate = useMemo(() => groupByDate(calendar?.items || []), [calendar?.items]);
  const monthCells = useMemo(() => buildMonthCells(month), [month]);
  const weekDays = useMemo(() => mondayWeek(selectedDate), [selectedDate]);
  const selectedEvents = eventsByDate.get(selectedDate) || [];
  const weekEvents = (calendar?.items || []).filter((event) => weekDays.some((day) => eventDate(event) === day));

  async function createTask(event: React.FormEvent) {
    event.preventDefault();
    const cleanTitle = title.trim();
    if (!cleanTitle) return;
    const now = new Date().toISOString();
    const id = `task:${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
    const task: PlannerTask = { id, title: cleanTitle, description: '', dueDate: dueDate || null, sourceInboxId: null, status: 'pending', createdAt: now, updatedAt: now, completedAt: null };
    setTasks((current) => mergePlannerTasks([task, ...current], []));
    setTitle('');
    setDueDate('');
    setTaskError('');
    saveCachedPlannerTasks([task, ...tasks]);
    try {
      const saved = await addPlannerTask(task);
      setTasks(saved);
      saveCachedPlannerTasks(saved);
      setVaultSaved(true);
    } catch (error) {
      setVaultSaved(false);
      setTaskError(error instanceof Error ? `${error.message} 이 할 일은 브라우저 캐시에 남아 있어.` : 'Vault 저장에 실패했어. 브라우저 캐시는 유지돼.');
    }
  }

  async function changeTaskStatus(task: PlannerTask, status: PlannerTaskStatus) {
    const now = new Date().toISOString();
    const updated = { ...task, status, updatedAt: now, completedAt: status === 'done' ? now : null };
    const next = tasks.map((value) => value.id === task.id ? updated : value);
    setTasks(next);
    saveCachedPlannerTasks(next);
    setBusyTaskId(task.id);
    setTaskError('');
    try {
      const saved = await savePlannerTasks(next);
      setTasks(saved);
      saveCachedPlannerTasks(saved);
      setVaultSaved(true);
    } catch (error) {
      setVaultSaved(false);
      setTaskError(error instanceof Error ? `${error.message} 상태는 브라우저 캐시에 남아 있어.` : '상태를 Vault에 저장하지 못했어.');
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
    } catch (reason) { setOpenError(readMailError(reason)); }
    finally { setOpeningMailId(null); }
  }

  async function changeMailTask(task: MailTask, status: MailTaskStatus) {
    setBusyTaskId(task.id);
    try {
      const updated = await updateMailTask(readBridgeToken(), { taskId: task.id, status });
      setPlanning((current) => current ? { ...current, tasks: current.tasks.map((value) => value.id === updated.id ? updated : value) } : current);
    } catch (error) { setMailError(error instanceof Error ? error.message : '메일 할 일 상태를 저장하지 못했어.'); }
    finally { setBusyTaskId(null); }
  }

  async function addCandidate(item: MailAnalysisItem, candidate: StoredMailCalendarCandidate, edit: CalendarCandidateEdit) {
    const result = await addCalendarEvent({ mailId: item.mail.id, candidateId: candidate.id, title: edit.title, start: edit.start, end: edit.end, allDay: edit.allDay, type: candidate.type, reason: candidate.reason });
    const updated = await updateMailCandidate(readBridgeToken(), { mailId: item.mail.id, candidateId: candidate.id, status: 'added', ...edit, ...(result.eventId ? { calendarEventId: result.eventId } : {}) });
    replaceCandidate(item.mail.id, updated);
    await loadMonth();
  }

  async function ignoreCandidate(item: MailAnalysisItem, candidate: StoredMailCalendarCandidate) {
    const updated = await updateMailCandidate(readBridgeToken(), { mailId: item.mail.id, candidateId: candidate.id, status: 'ignored', title: candidate.title, start: candidate.start, end: candidate.end, allDay: candidate.allDay });
    replaceCandidate(item.mail.id, updated);
  }

  function replaceCandidate(mailId: string, updated: StoredMailCalendarCandidate) {
    setPlanning((current) => current ? { ...current, items: current.items.map((item) => item.mail.id !== mailId ? item : { ...item, candidates: item.candidates.map((candidate) => candidate.id === updated.id ? updated : candidate) }) } : current);
  }

  return <div className="planner-workspace">
    <section className="card section planner-calendar-card">
      <div className="head"><div><h3>월간 Calendar</h3><small>Google Calendar · {calendar?.items.length || 0}개 일정</small></div><div className="planner-month-nav"><button className="mini" type="button" aria-label="이전 달" onClick={() => { const next = shiftMonth(month, -1); setMonth(next); setSelectedDate(`${next}-01`); }}>←</button><b>{monthLabel(month)}</b><button className="mini" type="button" aria-label="다음 달" onClick={() => { const next = shiftMonth(month, 1); setMonth(next); setSelectedDate(`${next}-01`); }}>→</button><button className="mini" type="button" onClick={() => { setMonth(currentMonth()); setSelectedDate(todayDate()); }}>오늘</button></div></div>
      {calendarError && <div className="error">{calendarError}</div>}
      {calendarLoading && <div className="muted">Google Calendar를 불러오는 중…</div>}
      <div className="planner-month-grid" role="grid" aria-label={`${month} 일정`}>
        {['월', '화', '수', '목', '금', '토', '일'].map((day) => <b className="planner-weekday" role="columnheader" key={day}>{day}</b>)}
        {monthCells.map((cell) => {
          const dayEvents = eventsByDate.get(cell.date) || [];
          return <button key={cell.date} type="button" role="gridcell" aria-pressed={selectedDate === cell.date} className={`planner-day${cell.inMonth ? '' : ' outside'}${cell.date === todayDate() ? ' today' : ''}${selectedDate === cell.date ? ' selected' : ''}`} onClick={() => setSelectedDate(cell.date)}>
            <span>{Number(cell.date.slice(-2))}</span>{dayEvents.length > 0 && <small>{dayEvents.length}건</small>}
          </button>;
        })}
      </div>
      <div className="planner-selected-day"><div className="head"><h4>{formatDateLabel(selectedDate)}</h4><span>{selectedEvents.length}건</span></div>
        {selectedEvents.length ? selectedEvents.map((event) => <CalendarEventRow key={`${event.calendarId}:${event.id}`} event={event} />) : <div className="empty compact-empty">선택한 날짜에 일정이 없어.</div>}
      </div>
    </section>

    <section className="card section planner-timetable-card">
      <div className="head"><div><h3>주간 Timetable</h3><small>{formatDateLabel(weekDays[0])} – {formatDateLabel(weekDays[6])}</small></div><span>{weekEvents.length}건</span></div>
      <div className="planner-timetable">
        <div className="planner-timetable-header"><span>시간</span>{weekDays.map((day) => <button className={day === todayDate() ? 'today' : ''} key={day} type="button" onClick={() => setSelectedDate(day)}>{weekdayLabel(day)}<b>{day.slice(-2)}</b></button>)}</div>
        <div className="planner-all-day-row"><b>종일</b>{weekDays.map((day) => <div key={day}>{(eventsByDate.get(day) || []).filter((event) => event.allDay).map((event) => <span key={event.id} title={event.title}>{event.title}</span>)}</div>)}</div>
        {Array.from({ length: 15 }, (_, index) => index + 7).map((hour) => <div className="planner-hour-row" key={hour}><time>{String(hour).padStart(2, '0')}:00</time>{weekDays.map((day) => <div key={day}>{(eventsByDate.get(day) || []).filter((event) => !event.allDay && eventHour(event) === hour).map((event) => <span className="planner-time-event" key={event.id} title={`${event.title} · ${formatEventTime(event)}`}>{formatEventTime(event)} {event.title}</span>)}</div>)}</div>)}
      </div>
    </section>

    <section className="card section planner-tasks-card">
      <div className="head"><div><h3>해야 할 일</h3><small>Inbox에서 전달된 할 일과 직접 추가한 작업</small></div><span>{activeTasks.length}개 미완료</span></div>
      <form className="planner-task-create" onSubmit={(event) => void createTask(event)}><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="새 할 일" aria-label="새 할 일" maxLength={1200} /><input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} aria-label="할 일 마감일" /><button className="btn primary" type="submit" disabled={!title.trim()}>추가</button></form>
      <div className="planner-persistence-status"><span className={vaultSaved ? 'saved' : 'local'}>{vaultSaved ? 'Vault · shared/planner/tasks.json' : '브라우저 캐시'}</span><button className="mini" type="button" disabled={tasksLoading} onClick={() => void loadTasks()}>새로고침</button></div>
      {taskError && <div className="error">{taskError}</div>}
      {activeTasks.length ? <div className="planner-task-list">{activeTasks.map((task) => <article className="planner-user-task" key={task.id}><button type="button" className="planner-task-toggle" aria-label={`${task.title} 완료`} disabled={busyTaskId === task.id} onClick={() => void changeTaskStatus(task, 'done')}>○</button><div><b>{task.title}</b>{task.description && <small>{task.description}</small>}{task.dueDate && <time>기한 {task.dueDate}</time>}</div><span>{task.sourceInboxId ? 'Inbox' : '개인'}</span></article>)}</div> : tasksLoading ? <div className="empty compact-empty">Vault 할 일을 읽는 중…</div> : <div className="empty compact-empty">미완료 할 일이 없어.</div>}
      {doneTasks.length > 0 && <details className="planner-closed"><summary>완료 {doneTasks.length}개 보기</summary><div className="planner-task-list">{doneTasks.map((task) => <article className="planner-user-task done" key={task.id}><button type="button" className="planner-task-toggle" aria-label={`${task.title} 다시 열기`} disabled={busyTaskId === task.id} onClick={() => void changeTaskStatus(task, 'pending')}>✓</button><div><b>{task.title}</b>{task.dueDate && <time>기한 {task.dueDate}</time>}</div><span>완료</span></article>)}</div></details>}
    </section>

    <section className="card section planner-candidates-card">
      <div className="head"><h3>메일 일정 후보</h3><span>보조 기능 · 사용자 확인 후 Calendar 등록</span></div>
      {mailError && <div className="error">{mailError}</div>}
      {pendingCandidates.length ? <div className="planner-candidate-list">{pendingCandidates.map(({ item, candidate }) => <article className="planner-candidate" key={candidate.id}><div className="planner-candidate-source"><b>{item.mail.subject}</b><small>{item.mail.senderName} · {folderLabel(item.folder)}</small><button className="mini" type="button" disabled={openingMailId === item.mail.id} onClick={() => void openMail(item)}>{openingMailId === item.mail.id ? '여는 중…' : '메일 열기'}</button></div><CalendarCandidateCard candidate={candidate} onAdd={(next, edit) => addCandidate(item, next, edit)} onIgnore={(next) => ignoreCandidate(item, next)} /></article>)}</div> : <div className="empty compact-empty">{planning ? '확인할 메일 일정 후보가 없어.' : '메일의 보조 일정 후보를 확인할 수 없어.'}</div>}
      {openError && <div className="error">{thunderbirdMailErrorMessage(openError)}</div>}
      {planning?.tasks.filter((task) => task.status === 'pending' || task.status === 'snoozed').map((task) => <article className="planner-mail-task" key={task.id}><span>{task.title}</span><small>{task.mail.subject} · {task.dueAt || '기한 없음'}</small><div><button className="mini" type="button" disabled={busyTaskId === task.id} onClick={() => void changeMailTask(task, 'done')}>완료</button><button className="mini" type="button" disabled={busyTaskId === task.id} onClick={() => { const item = planning.items.find((value) => value.mail.id === task.mailId); if (item) void openMail(item); }}>메일 열기</button></div></article>)}
    </section>
  </div>;
}

function groupByDate(events: CalendarEvent[]) {
  const result = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    const key = eventDate(event);
    if (!key) continue;
    const group = result.get(key) || [];
    group.push(event);
    result.set(key, group);
  }
  for (const group of result.values()) group.sort((a, b) => a.start.localeCompare(b.start));
  return result;
}

function eventDate(event: CalendarEvent) {
  if (event.allDay || /^\d{4}-\d{2}-\d{2}$/.test(event.start)) return event.start.slice(0, 10);
  const date = new Date(event.start);
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function eventHour(event: CalendarEvent) {
  const date = new Date(event.start);
  if (Number.isNaN(date.getTime())) return -1;
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', hour: '2-digit', hourCycle: 'h23' }).format(date));
}

function formatEventTime(event: CalendarEvent) {
  if (event.allDay) return '종일';
  const date = new Date(event.start);
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
}

function CalendarEventRow({ event }: { event: CalendarEvent }) {
  return <div className="planner-calendar-event"><time>{event.allDay ? '종일' : formatEventTime(event)}</time><b>{event.title}</b><small>{event.category}</small></div>;
}

function todayDate() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
function currentMonth() { return todayDate().slice(0, 7); }
function monthLabel(month: string) { const [year, number] = month.split('-').map(Number); return `${year}년 ${number}월`; }
function shiftMonth(month: string, amount: number) { const [year, number] = month.split('-').map(Number); return new Date(Date.UTC(year, number - 1 + amount, 1)).toISOString().slice(0, 7); }
function buildMonthCells(month: string) {
  const [year, number] = month.split('-').map(Number);
  const first = new Date(Date.UTC(year, number - 1, 1));
  const offset = (first.getUTCDay() + 6) % 7;
  const count = new Date(Date.UTC(year, number, 0)).getUTCDate();
  const cells = Math.ceil((offset + count) / 7) * 7;
  return Array.from({ length: cells }, (_, index) => {
    const day = index - offset + 1;
    const date = new Date(Date.UTC(year, number - 1, day)).toISOString().slice(0, 10);
    return { date, inMonth: date.startsWith(month) };
  });
}
function mondayWeek(dateValue: string) {
  const date = new Date(`${dateValue}T12:00:00+09:00`);
  const day = date.getDay();
  date.setDate(date.getDate() - ((day + 6) % 7));
  return Array.from({ length: 7 }, (_, index) => {
    const current = new Date(date);
    current.setDate(date.getDate() + index);
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(current);
  });
}
function formatDateLabel(value: string) { const date = new Date(`${value}T00:00:00+09:00`); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', weekday: 'short', year: 'numeric', month: 'long', day: 'numeric' }).format(date); }
function weekdayLabel(value: string) { return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', weekday: 'short' }).format(new Date(`${value}T00:00:00+09:00`)); }
function folderLabel(folder: MailAnalysisItem['folder']) { return folder === 'international-office' ? '국제과' : '학교 업무'; }
function readMailError(error: unknown): ThunderbirdMailErrorCode { if (error instanceof ThunderbirdMailError) return error.code; if (error instanceof MailAnalysisClientError) return error.code === 'bridge_auth' ? 'bridge_auth' : 'bridge_offline'; return 'bridge_offline'; }
