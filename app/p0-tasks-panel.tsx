'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  createP0Task,
  listP0Tasks,
  updateP0Task,
  type P0Task,
  type P0TaskCategory,
  type P0TaskList,
} from '@/lib/p0-tasks-client';
import { clearP0PendingCreate, readP0PendingCreate, saveP0PendingCreate, type P0PendingCreate } from '@/lib/p0-pending-create';
import { useP0Auth } from '@/app/p0-auth-gate';

const categoryLabels: Record<P0TaskCategory, string> = { research: '연구', school: '학교', personal: '개인' };
type CategoryFilter = 'all' | P0TaskCategory;

function sessionStorageOrNull(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function P0TasksPanel() {
  const { authenticated } = useP0Auth();
  const [tasks, setTasks] = useState<P0Task[]>([]);
  const [loading, setLoading] = useState(true);

  const [createBusy, setCreateBusy] = useState(false);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [category, setCategory] = useState<P0TaskCategory>('personal');
  const [filter, setFilter] = useState<CategoryFilter>('all');
  const [pendingCreate, setPendingCreate] = useState<P0PendingCreate | null>(null);
  const [pendingCreateReady, setPendingCreateReady] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState('');
  const [recoveryOpen, setRecoveryOpen] = useState(false);


  const loadTasks = useCallback(async () => {
    setLoading(true);
    try {
      const result: P0TaskList = await listP0Tasks();
      setTasks(result.tasks.filter((task) => !task.deleted));
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'P0 할 일을 불러오지 못했어.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const saved = readP0PendingCreate(sessionStorageOrNull());
    if (saved) {
      setPendingCreate(saved);
      setTitle(saved.fields.title);
      setDueDate(saved.fields.due_date || '');
      setCategory(saved.fields.category);
    }
    setPendingCreateReady(true);
  }, []);

  useEffect(() => { void loadTasks(); }, [loadTasks]);

  const orderedTasks = useMemo(() => tasks
    .filter((task) => filter === 'all' || task.category === filter)
    .sort((left, right) => Number(right.is_today) - Number(left.is_today)
      || Number(left.status === 'done') - Number(right.status === 'done')
      || (left.due_date || '9999-99-99').localeCompare(right.due_date || '9999-99-99')
      || left.category.localeCompare(right.category)
      || Date.parse(right.created_at) - Date.parse(left.created_at)), [filter, tasks]);
  const openCount = tasks.filter((task) => task.status === 'open').length;

  async function submitTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (createBusy || !authenticated || !pendingCreateReady) return;
    const cleanTitle = title.trim();
    if (!pendingCreate && !cleanTitle) return;
    const payload: P0PendingCreate = pendingCreate ?? {
      id: crypto.randomUUID(),
      op_id: `mtos-web-${crypto.randomUUID()}`,
      fields: { title: cleanTitle, due_date: dueDate || null, category, status: 'open', is_today: false },
    };
    const retryWarning = !pendingCreate && !saveP0PendingCreate(sessionStorageOrNull(), payload)
      ? '중복 방지 재시도 정보를 탭에 저장하지 못했어. 요청이 실패하면 이 화면을 닫지 말고 같은 요청을 재시도해줘.'
      : '';
    setPendingCreate(payload);
    setCreateBusy(true);
    setError(retryWarning);
    try {
      await createP0Task(payload);
      clearP0PendingCreate(sessionStorageOrNull());
      setPendingCreate(null);
      setTitle('');
      setDueDate('');
      await loadTasks();
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'P0에 저장하지 못했어. 같은 요청으로 다시 시도할 수 있어.';
      setError(retryWarning ? `${retryWarning} ${message}` : message);
    } finally {
      setCreateBusy(false);
    }
  }

  async function changeTask(task: P0Task, changes: Record<string, unknown>) {
    if (busyTaskId) return;
    setBusyTaskId(task.id);
    setError('');
    try {
      const result = await updateP0Task(task.id, {
        base_version: task.version,
        changes,
        op_id: `mtos-web-${crypto.randomUUID()}`,
      });
      setTasks((current) => current.map((value) => value.id === task.id ? result.task : value));
      setEditingId(null);
      if (result.conflicts.length) setError('다른 기기에서 같은 항목을 바꿨어. 서버의 현재 값을 다시 불러왔어.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'P0 할 일을 수정하지 못했어.');
    } finally {
      setBusyTaskId(null);
    }
  }

  async function saveTitle(task: P0Task) {
    const nextTitle = titleDraft.trim();
    if (!nextTitle || nextTitle === task.title) {
      setEditingId(null);
      return;
    }
    await changeTask(task, { title: nextTitle });
  }

  return <section className="card section planner-tasks-card" aria-labelledby="p0-tasks-title">
    <div className="head">
      <div><h3 id="p0-tasks-title">오늘 집중 · SQLite 할 일</h3><small>P0가 실행 상태의 원본이야. 기존 Planner 항목은 따로 보존돼.</small></div>
      <div><span>{openCount}개 미완료</span><button className="mini" type="button" aria-expanded={recoveryOpen} onClick={() => setRecoveryOpen((open) => !open)}>{recoveryOpen ? '간단 화면' : '오프라인·복구'}</button></div>
    </div>
    {recoveryOpen ? <>
      <p className="p0-recovery-note">검증된 P0 화면을 same-origin 프록시로 불러와. 로그인 bearer token은 HttpOnly·SameSite 쿠키에 저장되고 브라우저 JavaScript나 localStorage에서 읽을 수 없어.</p>
      <div className="p0-native-shell"><iframe src="/api/p0/native/" title="P0 오프라인·충돌·거부 복구 화면" loading="lazy" /></div>
    </> : <>
    {authenticated && <>
      <form className="planner-task-create p0-task-create" onSubmit={(event) => void submitTask(event)}>
        <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="새 할 일" aria-label="P0 새 할 일" maxLength={500} disabled={!pendingCreateReady || createBusy || Boolean(pendingCreate)} />
        <input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} aria-label="P0 할 일 마감일" disabled={!pendingCreateReady || createBusy || Boolean(pendingCreate)} />
        <select value={category} onChange={(event) => setCategory(event.target.value as P0TaskCategory)} aria-label="P0 할 일 분류" disabled={!pendingCreateReady || createBusy || Boolean(pendingCreate)}>
          <option value="research">연구</option><option value="school">학교</option><option value="personal">개인</option>
        </select>
        <button className="btn primary" type="submit" disabled={!pendingCreateReady || createBusy || (!pendingCreate && !title.trim())}>{createBusy ? '저장 중…' : pendingCreate ? '같은 요청 재시도' : '추가'}</button>
      </form>
      <div className="planner-persistence-status"><span className="saved">SQLite · P0 서버</span><label>분류 <select value={filter} onChange={(event) => setFilter(event.target.value as CategoryFilter)} aria-label="P0 할 일 분류 필터"><option value="all">전체</option><option value="research">연구</option><option value="school">학교</option><option value="personal">개인</option></select></label><button className="mini" type="button" disabled={loading} onClick={() => void loadTasks()}>새로고침</button></div>
      {tasks.length ? <div className="planner-task-list">{orderedTasks.map((task) => {
        const done = task.status === 'done';
        return <article className={done ? 'planner-user-task done' : 'planner-user-task'} key={task.id}>
          <button type="button" className="planner-task-toggle" aria-label={done ? `${task.title} 다시 열기` : `${task.title} 완료`} aria-pressed={done} disabled={busyTaskId === task.id} onClick={() => void changeTask(task, { status: done ? 'open' : 'done' })}>{done ? '✓' : ''}</button>
          <div className="p0-task-main">
            {editingId === task.id ? <form onSubmit={(event) => { event.preventDefault(); void saveTitle(task); }}><input aria-label={`${task.title} 제목 수정`} value={titleDraft} maxLength={500} onChange={(event) => setTitleDraft(event.target.value)} autoFocus /><button className="mini" type="submit" disabled={busyTaskId === task.id || !titleDraft.trim()}>저장</button><button className="mini" type="button" onClick={() => setEditingId(null)}>취소</button></form> : <><b>{done ? <s>{task.title}</s> : task.title}</b><small>{categoryLabels[task.category]}{task.is_today ? ' · 오늘 집중' : ''}{task.due_date ? ` · 기한 ${task.due_date}` : ''}</small></>}
          </div>
          {editingId !== task.id && <><button className="mini" type="button" aria-pressed={task.is_today} disabled={busyTaskId === task.id} onClick={() => void changeTask(task, { is_today: !task.is_today })}>{task.is_today ? '집중 해제' : '오늘 집중'}</button><button className="mini" type="button" disabled={busyTaskId === task.id} onClick={() => { setEditingId(task.id); setTitleDraft(task.title); }}>수정</button></>}
        </article>;
      })}</div> : loading ? <div className="empty compact-empty">P0 SQLite 할 일을 불러오는 중…</div> : <div className="empty compact-empty">P0에 저장된 할 일이 없어.</div>}
    </>}
    </>}
    {error && <div className="error" role="alert">{error}</div>}
  </section>;
}
