'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { createP0Task, deleteP0Task, listP0Tasks, markP0TasksSeen, setP0SyncBridge, updateP0Task, type P0SyncBridge, type P0SyncStatus, type P0Task, type P0TaskCategory } from '@/lib/p0-tasks-client';
import { clearP0PendingCreate, readP0PendingCreate, saveP0PendingCreate, type P0PendingCreate } from '@/lib/p0-pending-create';
import { buildP0HomeView, dueLabel, p0TodayInTokyo, pickNowTasks, type P0HomeCategory } from '@/lib/p0-home';
import type { ResearchProject } from '@/lib/projects';
import type { CalendarEvent } from '@/lib/calendar';
import { addDays, homeHiddenIds, isMissedOccurrence, nextStep, type TaskMeta } from '@/lib/mtos-planning';
import { completeTask, deferOccurrence, skipOccurrence } from '@/lib/mtos-task-actions';
import { FocusRecommendations } from '@/app/focus-recommendations';
import { TaskAssist } from '@/app/task-assist';
import { DetailDrawer } from '@/app/detail-drawer';
import styles from './p0-home-tasks.module.css';

const categoryLabels: Record<P0TaskCategory, string> = {
  research: '연구',
  school: '학교',
  personal: '개인',
  unclassified: '미분류',
};
const categoryOptions: Array<{ value: P0HomeCategory; label: string }> = [
  { value: 'all', label: '전체' },
  { value: 'research', label: '연구' },
  { value: 'school', label: '학교' },
  { value: 'personal', label: '개인' },
  { value: 'unclassified', label: '미분류' },
];

type DetailDraft = {
  title: string;
  due_date: string;
  is_today: boolean;
  category: P0TaskCategory;
  project_id: string;
  source_url: string;
  memo: string;
};
type HomeState = 'loading' | 'ready' | 'error';
type NativeP0Window = Window & { MTOS_SYNC_BRIDGE?: P0SyncBridge };

function storage() {
  if (typeof window === 'undefined') return null;
  try { return window.sessionStorage; } catch { return null; }
}

function toDetailDraft(task: P0Task): DetailDraft {
  return {
    title: task.title,
    due_date: task.due_date ?? '',
    is_today: task.is_today,
    category: task.category,
    project_id: task.project_id ?? '',
    source_url: task.source_url ?? '',
    memo: task.memo,
  };
}

const EMPTY_META = new Map<string, TaskMeta>();

export function P0HomeWorkspace({
  projects,
  onOpenPlanner,
  focusCreateRequest,
  meta = EMPTY_META,
  onMetaChanged,
  calendarEvents = [],
  selectTaskRequest,
  reloadSignal = 0,
  onTasksChanged,
}: {
  projects: ResearchProject[];
  onOpenPlanner: () => void;
  focusCreateRequest?: number;
  meta?: Map<string, TaskMeta>;
  onMetaChanged?: () => void;
  calendarEvents?: CalendarEvent[];
  selectTaskRequest?: { id: string; n: number } | null;
  reloadSignal?: number;
  onTasksChanged?: () => void;
}) {
  const [state, setState] = useState<HomeState>('loading');
  const [tasks, setTasks] = useState<P0Task[]>([]);
  const [error, setError] = useState('');
  const [category, setCategory] = useState<P0HomeCategory>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DetailDraft | null>(null);
  const [pendingCreate, setPendingCreate] = useState<P0PendingCreate | null>(null);
  const [title, setTitle] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [memo, setMemo] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [newCategory, setNewCategory] = useState<P0TaskCategory>('unclassified');
  const [focusNew, setFocusNew] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [bridgeEnabled, setBridgeEnabled] = useState(false);
  const [bridgeLoaded, setBridgeLoaded] = useState(false);
  const [bridgeError, setBridgeError] = useState('');
  const [syncStatus, setSyncStatus] = useState<P0SyncStatus | null>(null);
  const [syncDetailsOpen, setSyncDetailsOpen] = useState(false);
  const [recommendedIds, setRecommendedIds] = useState<string[]>([]);
  const nativeFrame = useRef<HTMLIFrameElement>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const today = p0TodayInTokyo();

  const load = useCallback(async () => {
    setState('loading');
    setError('');
    try {
      const result = await listP0Tasks();
      setTasks(result.tasks.filter((task) => !task.deleted));
      setSyncStatus(result.syncStatus ?? null);
      setState('ready');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'P0 할 일을 읽지 못했어.');
      setState('error');
    }
  }, []);

  const handleNativeLoad = useCallback(() => {
    const frameWindow = nativeFrame.current?.contentWindow as NativeP0Window | null | undefined;
    const bridge = frameWindow?.MTOS_SYNC_BRIDGE;
    if (!bridge) {
      setBridgeError('오프라인 동기화 엔진을 초기화하지 못했어. 온라인 API로 연결할게.');
      void load();
      return;
    }
    setP0SyncBridge(bridge);
    setBridgeLoaded(true);
    setBridgeError('');
    void load();
  }, [load]);

  useEffect(() => {
    try { window.localStorage.setItem('mtos.session', 'mtos-native-cookie-v1'); } catch { /* P0 API auth still uses the HttpOnly session cookie. */ }
    setBridgeEnabled(true);
    return () => setP0SyncBridge(null);
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== nativeFrame.current?.contentWindow) return;
      const payload = event.data as { source?: unknown; type?: unknown; status?: P0SyncStatus };
      if (payload?.source !== 'mtos-p0-native' || payload.type !== 'sync-status' || !payload.status) return;
      setSyncStatus(payload.status);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  useEffect(() => {
    setPendingCreate(readP0PendingCreate(storage()));
  }, [load]);

  useEffect(() => {
    if (focusCreateRequest) setCreateOpen(true);
  }, [focusCreateRequest]);

  useEffect(() => {
    if (reloadSignal) void load();
  }, [reloadSignal, load]);

  useEffect(() => {
    if (!selectTaskRequest) return;
    const task = tasks.find((item) => item.id === selectTaskRequest.id);
    if (task) {
      setSelectedId(task.id);
      setDraft(toDetailDraft(task));
    }
    // Only when a new request arrives or the task list first contains it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectTaskRequest?.n, tasks.length]);

  // Recommended and snoozed tasks are not repeated in the lists below.
  const hidden = useMemo(() => homeHiddenIds(tasks, meta, today, recommendedIds), [tasks, meta, today, recommendedIds]);
  const view = useMemo(() => buildP0HomeView(tasks.filter((task) => task.is_today || !hidden.has(task.id)), today, category), [tasks, hidden, today, category]);
  const snoozed = useMemo(() => tasks.filter((task) => task.status === 'open' && !task.is_today && (meta.get(task.id)?.snooze_until ?? '') > today), [tasks, meta, today]);
  const newCount = tasks.filter((task) => task.is_new).length;
  const selected = tasks.find((task) => task.id === selectedId) ?? null;

  async function sendCreate(candidate: P0PendingCreate) {
    setCreateBusy(true);
    setError('');
    try {
      const result = await createP0Task(candidate);
      clearP0PendingCreate(storage());
      setPendingCreate(null);
      setTitle('');
      setMemo('');
      setCreateOpen(false);
      setDueDate('');
      setFocusNew(false);
      setTasks((current) => [result.task, ...current.filter((task) => task.id !== result.task.id)]);
      setSelectedId(result.task.id);
      setDraft(toDetailDraft(result.task));
      await load();
      onTasksChanged?.();
    } catch (reason) {
      setPendingCreate(candidate);
      setError(reason instanceof Error ? reason.message : '할 일을 저장하지 못했어. 같은 요청 ID로 안전하게 재시도할 수 있어.');
    } finally {
      setCreateBusy(false);
    }
  }

  async function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (createBusy) return;
    if (pendingCreate) {
      await sendCreate(pendingCreate);
      return;
    }
    if (!title.trim()) return;
    const id = crypto.randomUUID();
    const candidate: P0PendingCreate = {
      id,
      op_id: `mtos-web-create-${id}`,
      fields: {
        title: title.trim(),
        due_date: dueDate || null,
        category: newCategory,
        status: 'open',
        is_today: focusNew,
        memo: memo.trim(),
      },
    };
    if (!saveP0PendingCreate(storage(), candidate)) {
      setError('이 기기에서 안전한 재시도 키를 저장하지 못했어. 브라우저 저장소를 확인해줘.');
      return;
    }
    await sendCreate(candidate);
  }

  async function toggleStatus(task: P0Task) {
    setSavingId(task.id);
    setError('');
    try {
      const recurring = task.status === 'open' && Boolean(meta.get(task.id)?.recur);
      const result = task.status === 'open'
        ? await completeTask(task, meta.get(task.id), today)
        : await updateP0Task(task.id, { base_version: task.version, changes: { status: 'open' }, op_id: `mtos-web-status-${crypto.randomUUID()}` });
      setTasks((current) => current.map((item) => item.id === task.id ? result.task : item));
      onTasksChanged?.();
      if (recurring) {
        onMetaChanged?.();
        await load();
      }
      if (result.conflicts.length) setError('다른 기기에서 동시에 수정한 항목이 있어. Planner의 동기화 상태를 확인해줘.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '완료 상태를 저장하지 못했어.');
    } finally {
      setSavingId(null);
    }
  }

  async function selectTask(task: P0Task) {
    setSelectedId(task.id);
    setDraft(toDetailDraft(task));
    setError('');
    if (!task.is_new) return;
    try {
      await markP0TasksSeen({ ids: [task.id] });
      setTasks((current) => current.map((item) => item.id === task.id ? { ...item, is_new: false } : item));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '읽음 상태를 저장하지 못했어.');
    }
  }

  async function markAllSeen() {
    if (!newCount) return;
    try {
      await markP0TasksSeen({ all: true });
      setTasks((current) => current.map((task) => ({ ...task, is_new: false })));
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '새 항목을 읽음 처리하지 못했어.');
    }
  }

  function closeDetail() {
    setSelectedId(null);
    setDraft(null);
  }

  async function saveDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !draft || savingId) return;
    if (!draft.title.trim()) {
      setError('제목은 비워둘 수 없어.');
      return;
    }
    const next = {
      title: draft.title.trim(),
      due_date: draft.due_date || null,
      is_today: draft.is_today,
      category: draft.category,
      project_id: draft.project_id || null,
      source_url: draft.source_url.trim() || null,
      memo: draft.memo,
    };
    const changes = Object.fromEntries(Object.entries(next).filter(([key, value]) => selected[key as keyof P0Task] !== value));
    if (!Object.keys(changes).length) {
      setError('');
      return;
    }
    setSavingId(selected.id);
    setError('');
    try {
      const result = await updateP0Task(selected.id, {
        base_version: selected.version,
        changes,
        op_id: `mtos-web-edit-${crypto.randomUUID()}`,
      });
      setTasks((current) => current.map((task) => task.id === selected.id ? result.task : task));
      setDraft(toDetailDraft(result.task));
      if (result.conflicts.length) setError('일부 필드는 다른 기기에서 먼저 수정돼 보존됐어. 새 값을 확인한 뒤 다시 저장해줘.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '할 일을 저장하지 못했어.');
    } finally {
      setSavingId(null);
    }
  }

  async function removeTask(task: P0Task) {
    if (!window.confirm(`“${task.title}” 할 일을 삭제할까? 삭제는 SQLite 원본에 기록돼.`)) return;
    setSavingId(task.id);
    setError('');
    try {
      await deleteP0Task(task.id);
      setTasks((current) => current.filter((item) => item.id !== task.id));
      if (selectedId === task.id) {
        setSelectedId(null);
        setDraft(null);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '할 일을 삭제하지 못했어.');
    } finally {
      setSavingId(null);
    }
  }

  async function occurrenceAction(task: P0Task, action: 'skip' | 'defer') {
    const taskMeta = meta.get(task.id);
    if (!taskMeta) return;
    const to = action === 'defer' ? window.prompt('언제로 미룰까? (YYYY-MM-DD)', addDays(today, 1)) : null;
    if (action === 'defer' && !to) return;
    setSavingId(task.id);
    setError('');
    try {
      if (action === 'skip') await skipOccurrence(task, taskMeta, today);
      else await deferOccurrence(task, taskMeta, to as string);
      onMetaChanged?.();
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '반복 회차를 처리하지 못했어.');
    } finally {
      setSavingId(null);
    }
  }

  async function pinToday(task: P0Task) {
    const result = await updateP0Task(task.id, { base_version: task.version, changes: { is_today: true }, op_id: `mtos-focus-accept-${task.id}-${today}` });
    setTasks((current) => current.map((item) => item.id === task.id ? result.task : item));
  }

  const toneOf = { late: styles.chipDanger, soon: styles.chipWarn, later: '' } as const;
  function dueChip(task: P0Task) {
    const label = dueLabel(task.due_date, today);
    return label && { text: label.text, tone: toneOf[label.level] };
  }

  function taskMetaLine(task: P0Task) {
    const taskMeta = meta.get(task.id);
    const step = nextStep(task.id, tasks, meta);
    const due = dueChip(task);
    const project = task.project_id ? projects.find((item) => item.id === task.project_id)?.title ?? task.project_id : '';
    return <span className={styles.metaLine}>
      <span className={styles.metaText}>{categoryLabels[task.category]}{project ? ` · ${project}` : ''}</span>
      {taskMeta?.recur && <span className={styles.tag}>반복</span>}
      {taskMeta?.ai_generated && <span className={styles.tag}>AI</span>}
      {task._pending ? <span className={`${styles.tag} ${styles.pending}`}>동기화 대기</span> : task.is_new && <span className={styles.tag}>새 항목</span>}
      {step.next && <span className={styles.metaText}>다음 단계 {step.done}/{step.total}: {step.next.title}</span>}
      {step.allDone && task.status === 'open' && <span className={styles.metaText}>모든 단계 완료 · 상위 작업을 확인해줘</span>}
      {taskMeta?.blocked_reason && <span className={`${styles.chip} ${styles.chipDanger}`}>막힘: {taskMeta.blocked_reason}</span>}
    </span>;
  }

  function renderTask(task: P0Task, done = false, large = false) {
    const taskMeta = meta.get(task.id);
    const missed = isMissedOccurrence(task, taskMeta, today);
    return <li className={`${styles.taskRow} ${large ? styles.nowRow : ''}`} key={task.id}>
      <input
        type="checkbox"
        aria-label={task.status === 'done' ? `${task.title} 다시 열기` : `${task.title} 완료`}
        checked={done || task.status === 'done'}
        disabled={savingId === task.id}
        onChange={() => void toggleStatus(task)}
      />
      <button className={styles.taskSelect} type="button" data-detail-item aria-pressed={selectedId === task.id} onClick={() => void selectTask(task)}>
        <span className={styles.taskTitle}>{task.title}</span>
        {taskMetaLine(task)}
      </button>
      {dueChip(task) && <span className={`${styles.chip} ${dueChip(task)?.tone}`}>{dueChip(task)?.text}</span>}
      {missed && <span className={styles.rowActions}>
        <button className="mini" type="button" disabled={savingId === task.id} onClick={() => void toggleStatus(task)}>완료</button>
        <button className="mini" type="button" disabled={savingId === task.id} onClick={() => void occurrenceAction(task, 'skip')}>건너뛰기</button>
        <button className="mini" type="button" disabled={savingId === task.id} onClick={() => void occurrenceAction(task, 'defer')}>미루기</button>
      </span>}
    </li>;
  }

  const nowTasks = pickNowTasks(view);
  const nowIds = new Set(nowTasks.map((task) => task.id));
  const restFocus = view.focus.filter((task) => !nowIds.has(task.id));
  const restGroups = view.groups.map((group) => ({ ...group, tasks: group.tasks.filter((task) => !nowIds.has(task.id)) })).filter((group) => group.tasks.length);
  const restCount = restFocus.length + restGroups.reduce((sum, group) => sum + group.tasks.length, 0);

  return <section className={`card section ${styles.root}`} aria-labelledby="p0-home-title">
    <div className={styles.header}>
      <div><h3 id="p0-home-title">오늘 할 일</h3><p>{today} · {state === 'ready' ? `미완료 ${view.openCount}개${view.overdueCount ? ` · 기한 지남 ${view.overdueCount}개` : ''}` : '할 일 확인 중'}</p></div>
      <div className={styles.headerActions}>
        <button className="mini primary" type="button" onClick={() => setCreateOpen(true)}>? ??</button>
        <details className={styles.headerMore}><summary>? ??</summary>
        {newCount > 0 && <button className="mini" type="button" onClick={() => void markAllSeen()}>새 항목 {newCount}개 읽음</button>}
        <button className="mini" type="button" onClick={() => void load()} disabled={state === 'loading'}>새로고침</button>
        <button className="mini" type="button" onClick={onOpenPlanner}>Planner</button>
        </details>
      </div>
    </div>

    {error && <p className={styles.error} role="alert">{error}</p>}
    {state === 'loading' && <div className={styles.empty}>P0 할 일을 불러오는 중…</div>}
    {state === 'error' && <div className={styles.empty}>{error || 'P0에 연결할 수 없어.'}</div>}

    {state === 'ready' && <section className={styles.now} aria-labelledby="p0-now-title">
      <h4 id="p0-now-title">지금 할 일 <span className={styles.count}>{nowTasks.length}</span></h4>
      {nowTasks.length
        ? <ul className={styles.taskList}>{nowTasks.map((task) => renderTask(task, false, true))}</ul>
        : <p className={styles.empty}>지금 급한 일이 없어. 아래에서 오늘 집중할 일을 골라봐.</p>}
      <details><summary>AI ??</summary><FocusRecommendations tasks={tasks} meta={meta} today={today} calendarEvents={calendarEvents} onAccept={pinToday} onVisibleChange={setRecommendedIds} /></details>
    </section>}

    <DetailDrawer compact open={createOpen} title="? ? ?" onClose={() => setCreateOpen(false)}>
      <p className={styles.createIntro}>? ?? ???? ??? ??? ?????.</p>
      <form className={styles.drawerForm} onSubmit={(event) => void submitCreate(event)}>
        <label>? ? ?? *<input ref={titleInput} value={title} onChange={(event) => setTitle(event.target.value)} maxLength={500} placeholder="??? ?? ????" required={!pendingCreate} disabled={createBusy || Boolean(pendingCreate)} /></label>
        <label>???<input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} disabled={createBusy || Boolean(pendingCreate)} /></label>
        <label>??<select value={newCategory} onChange={(event) => setNewCategory(event.target.value as P0TaskCategory)} disabled={createBusy || Boolean(pendingCreate)}>{Object.entries(categoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>??<textarea rows={3} maxLength={10000} value={memo} onChange={(event) => setMemo(event.target.value)} placeholder="?? ?? (??)" disabled={createBusy || Boolean(pendingCreate)} /></label>
        <label className={styles.detailCheck}><input type="checkbox" checked={focusNew} onChange={(event) => setFocusNew(event.target.checked)} disabled={createBusy || Boolean(pendingCreate)} /> ?? ??</label>
        <button className="mini primary" type="submit" disabled={createBusy || (!pendingCreate && !title.trim())}>{createBusy ? '?? ??' : pendingCreate ? '?? ?? ???' : '? ? ??'}</button>
        <button className="mini" type="button" onClick={() => setCreateOpen(false)}>??</button>
      </form>
    </DetailDrawer>
    {pendingCreate && <p className={styles.message} role="status">이전 생성 요청을 확인할 수 없어. 같은 ID로 재시도하면 중복 생성되지 않아.</p>}

    {state === 'ready' && <>
      <details className={styles.filterDetails}><summary>?? ??</summary><div className={styles.toolbar}>
        <div className={styles.filters} role="group" aria-label="분류 필터">
          {categoryOptions.map((option) => <button key={option.value} className="mini" type="button" aria-pressed={category === option.value} onClick={() => setCategory(option.value)}>{option.label}</button>)}
        </div>
        <span className={styles.message}>나머지 {restCount}개</span>
      </div></details>

      <div className={styles.listColumn}>
        {restFocus.length > 0 && <details className={styles.group} open>
          <summary>오늘 집중 <span className={styles.count}>{restFocus.length}</span></summary>
          <ul className={styles.taskList}>{restFocus.map((task) => renderTask(task))}</ul>
        </details>}
        {restGroups.map((group) => <details className={`${styles.group} ${group.id === 'overdue' ? styles.groupDanger : ''}`} key={group.id} open={group.id === 'overdue' || group.id === 'today'}>
          <summary>{group.label} <span className={styles.count}>{group.tasks.length}</span></summary>
          <ul className={styles.taskList}>{group.tasks.map((task) => renderTask(task))}</ul>
        </details>)}
        {!view.openCount && <div className={styles.empty}>미완료 할 일이 없어. 위에서 새 항목을 하나 등록해봐.</div>}
        {snoozed.length > 0 && <details className={styles.group}>
          <summary>미뤄둔 일 <span className={styles.count}>{snoozed.length}</span></summary>
          <ul className={styles.taskList}>{snoozed.map((task) => <li key={task.id} className={styles.taskRow}><span />
            <button className={styles.taskSelect} type="button" data-detail-item onClick={() => void selectTask(task)}><span className={styles.taskTitle}>{task.title}</span><span className={styles.metaText}>{meta.get(task.id)?.snooze_until}에 다시 표시</span></button>
          </li>)}</ul>
        </details>}
        <details className={styles.group}>
          <summary>오늘 완료한 일 {view.doneToday.length ? <span className={styles.count}>{view.doneToday.length}</span> : null}</summary>
          {view.doneToday.length ? <ul className={styles.taskList}>{view.doneToday.map((task) => renderTask(task, true))}</ul> : <p className={styles.empty}>오늘 완료한 일이 아직 없어.</p>}
        </details>
      </div>
    </>}

    <DetailDrawer open={Boolean(selected && draft)} title={draft?.title || '할 일 상세'} onClose={closeDetail}>
      {selected && draft && <>
        <form className={styles.drawerForm} onSubmit={(event) => void saveDetails(event)}>
          <label>제목<input value={draft.title} maxLength={500} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
          <div className={styles.inlineFields}>
            <label>기한<input type="date" value={draft.due_date} onChange={(event) => setDraft({ ...draft, due_date: event.target.value })} /></label>
            <label>분류<select value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value as P0TaskCategory })}>{Object.entries(categoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          </div>
          <label className={styles.detailCheck}><input type="checkbox" checked={draft.is_today} onChange={(event) => setDraft({ ...draft, is_today: event.target.checked })} /> 오늘 집중</label>
          <label>연구 프로젝트
            <select value={draft.project_id} onChange={(event) => setDraft({ ...draft, project_id: event.target.value })}>
              <option value="">프로젝트 연결 안 함</option>
              {draft.project_id && !projects.some((project) => project.id === draft.project_id) && <option value={draft.project_id}>기존 연결 유지 ({draft.project_id})</option>}
              {projects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}
            </select>
          </label>
          <label>원본 링크<input type="url" value={draft.source_url} onChange={(event) => setDraft({ ...draft, source_url: event.target.value })} /></label>
          <label>메모<textarea rows={5} value={draft.memo} onChange={(event) => setDraft({ ...draft, memo: event.target.value })} /></label>
          <div className={styles.rowActions}>
            <button className="mini primary" type="submit" disabled={savingId === selected.id}>{savingId === selected.id ? '저장 중…' : '저장'}</button>
            <button className="mini" type="button" disabled={savingId === selected.id} onClick={() => void removeTask(selected)}>삭제</button>
          </div>
        </form>
        <TaskAssist task={selected} tasks={tasks} meta={meta} today={today} onChanged={() => { onMetaChanged?.(); void load(); }} onCompleteParent={(task) => void toggleStatus(task)} />
      </>}
    </DetailDrawer>

    <details className={styles.operations}>
      <summary>동기화 · 연결 상세{syncStatus && (syncStatus.authRequired || syncStatus.conflicts || syncStatus.rejected) ? ' · 확인 필요' : ''}</summary>
    <div className={styles.syncBar} role="status" aria-live="polite">
      <span>{syncStatus ? syncStatus.authRequired ? '다시 로그인이 필요해' : !syncStatus.online ? `오프라인 · ${syncStatus.pending}건 대기` : syncStatus.rejected ? `서버 거부 · ${syncStatus.rejected}건 확인 필요` : syncStatus.conflicts ? `충돌 · ${syncStatus.conflicts}건 확인 필요` : syncStatus.pending ? `동기화 대기 · ${syncStatus.pending}건` : 'SQLite와 동기화됨' : bridgeLoaded ? '동기화 상태 확인 중…' : '오프라인 동기화 엔진 준비 중…'}</span>
      <span>충돌 {syncStatus?.conflicts ?? 0} · 거부 {syncStatus?.rejected ?? 0}</span>
      <button className="mini" type="button" onClick={() => void load()} disabled={state === 'loading'}>지금 동기화</button>
      <button className="mini" type="button" aria-expanded={syncDetailsOpen} onClick={() => setSyncDetailsOpen((open) => !open)} disabled={!bridgeLoaded}>
        {syncDetailsOpen ? '동기화 상세 닫기' : '충돌·거부 내역 열기'}
      </button>
    </div>
    {bridgeError && <p className={styles.message} role="status">{bridgeError}</p>}
    {bridgeEnabled && <div className={syncDetailsOpen ? styles.syncDetails : styles.hiddenSyncFrame}>
      <iframe ref={nativeFrame} title="P0 오프라인 동기화 및 복구" src="/api/p0/native/" onLoad={handleNativeLoad} aria-hidden={!syncDetailsOpen} tabIndex={syncDetailsOpen ? 0 : -1} />
    </div>}
    </details>
  </section>;
}
