'use client';

import { useEffect, useMemo, useState } from 'react';
import { addPlannerTask, savePlannerTasks, syncInboxPlannerTasks } from '@/lib/planner-tasks-client';
import { filterDeletedPlannerTasks, loadCachedPlannerTasks, mergePlannerTasks, saveCachedPlannerTasks, type PlannerTask } from '@/lib/planner-tasks';
import type { ResearchProject } from '@/lib/projects';
import styles from './home-todo-panel.module.css';

const localDate = () => {
  const date = new Date();
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
};

export function HomeTodoPanel({ projects = [], onOpenPlanner }: { projects?: ResearchProject[]; onOpenPlanner: () => void }) {
  const [tasks, setTasks] = useState<PlannerTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [vaultReady, setVaultReady] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [showDone, setShowDone] = useState(false);

  useEffect(() => {
    let active = true;
    const cached = loadCachedPlannerTasks();
    setTasks(cached);
    void syncInboxPlannerTasks().then(async (store) => {
      const stored = filterDeletedPlannerTasks(store.tasks, store.deletedTaskIds);
      const combined = mergePlannerTasks(stored, filterDeletedPlannerTasks(cached, store.deletedTaskIds));
      const storedById = new Map(stored.map((task) => [task.id, task]));
      const needsSave = combined.some((task) => {
        const persisted = storedById.get(task.id);
        return !persisted || Date.parse(task.updatedAt) > Date.parse(persisted.updatedAt);
      });
      const finalTasks = needsSave ? await savePlannerTasks(combined) : combined;
      if (!active) return;
      setTasks(finalTasks);
      saveCachedPlannerTasks(finalTasks);
      setVaultReady(true);
      setNotice('');
    }).catch((error) => {
      if (active) setNotice(error instanceof Error ? `Vault 연결 실패, 캐시를 표시 중: ${error.message}` : 'Vault 연결 실패, 브라우저 캐시를 표시 중');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const today = localDate();
  const pending = useMemo(() => tasks.filter((task) => task.status === 'pending').sort((a, b) =>
    (a.dueDate || '9999-12-31').localeCompare(b.dueDate || '9999-12-31') || Date.parse(a.createdAt) - Date.parse(b.createdAt)), [tasks]);
  const overdue = pending.filter((task) => Boolean(task.dueDate && task.dueDate < today));
  const dueToday = pending.filter((task) => task.dueDate === today);
  const other = pending.filter((task) => !task.dueDate || task.dueDate > today);
  const completed = tasks.filter((task) => task.status === 'done');

  async function toggle(task: PlannerTask) {
    if (savingId) return;
    const now = new Date().toISOString();
    const status = task.status === 'pending' ? 'done' : 'pending';
    const updated: PlannerTask = { ...task, status, updatedAt: now, completedAt: status === 'done' ? now : null };
    const next = tasks.map((item) => item.id === task.id ? updated : item);
    setTasks(next);
    saveCachedPlannerTasks(next);
    setSavingId(task.id);
    try {
      const saved = await savePlannerTasks(next);
      setTasks(saved);
      saveCachedPlannerTasks(saved);
      setVaultReady(true);
      setNotice('');
    } catch (error) {
      setVaultReady(false);
      setNotice(error instanceof Error ? `Vault 저장 실패, 변경 내용은 캐시에 남아 있어: ${error.message}` : 'Vault 저장 실패, 변경 내용은 캐시에 남아 있어');
    } finally { setSavingId(null); }
  }

  async function createTask(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim() || savingId) return;
    const now = new Date().toISOString();
    const task: PlannerTask = {
      id: `task:${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`,
      title: title.trim(), description: '', dueDate: null, source: 'manual',
      inboxItemId: null, projectId: null, status: 'pending', createdAt: now, updatedAt: now, completedAt: null,
    };
    setTitle('');
    setTasks((current) => [task, ...current]);
    saveCachedPlannerTasks([task, ...tasks]);
    setSavingId(task.id);
    try {
      const saved = await addPlannerTask(task);
      setTasks(saved);
      saveCachedPlannerTasks(saved);
      setVaultReady(true);
      setNotice('');
    } catch (error) {
      setVaultReady(false);
      setNotice(error instanceof Error ? `Vault 저장 실패, 새 할 일은 캐시에 남아 있어: ${error.message}` : 'Vault 저장 실패, 새 할 일은 캐시에 남아 있어');
    } finally { setSavingId(null); }
  }

  const renderTask = (task: PlannerTask) => {
    const project = projects.find((item) => item.id === task.projectId);
    return <article className={styles.item} key={task.id}>
      <button type="button" className={styles.check} aria-label={task.status === 'done' ? `${task.title} 다시 열기` : `${task.title} 완료`} disabled={Boolean(savingId)} onClick={() => void toggle(task)}>{task.status === 'done' ? '✓' : ''}</button>
      <div className={styles.taskText}>
        <strong className={task.status === 'done' ? styles.done : ''}>{task.title}</strong>
        <div className={styles.meta}>{task.dueDate && <span>기한 {task.dueDate}</span>}{project && <span>{project.title}</span>}{!project && <span>{task.source === 'inbox' ? '인박스' : '개인'}</span>}</div>
      </div>
    </article>;
  };

  return <div className={styles.root}>
    <header className={styles.header}>
      <div><p className={styles.eyebrow}>TODAY · {today}</p><h2>해야 할 일 <span>{pending.length}</span></h2></div>
      <button type="button" className={styles.plannerLink} onClick={onOpenPlanner}>일정 및 할 일 열기 ↗</button>
    </header>
    <form className={styles.add} onSubmit={(event) => void createTask(event)}>
      <input aria-label="새 할 일" placeholder="+ 새 할 일 추가" value={title} maxLength={1200} onChange={(event) => setTitle(event.target.value)} />
      <button type="submit" disabled={!title.trim() || Boolean(savingId)}>추가</button>
    </form>
    {notice && <p role="status" className={styles.warning}>{notice}</p>}
    {loading && <p className={styles.helper}>할 일을 동기화하는 중…</p>}
    {!vaultReady && !loading && !notice && <p className={styles.helper}>Vault 연결을 확인할 수 없어. 브라우저 캐시의 할 일이 표시될 수 있어.</p>}
    {pending.length === 0 && !loading ? <p className={styles.empty}>미완료 할 일이 없어. 위에서 바로 추가할 수 있어.</p> : <>
      {overdue.length > 0 && <section className={styles.section}><h3>기한 지남 <span>{overdue.length}</span></h3>{overdue.map(renderTask)}</section>}
      {dueToday.length > 0 && <section className={styles.section}><h3>오늘 마감 <span>{dueToday.length}</span></h3>{dueToday.map(renderTask)}</section>}
      {other.length > 0 && <section className={styles.section}><h3>해야 할 일 <span>{other.length}</span></h3>{other.map(renderTask)}</section>}
    </>}
    {completed.length > 0 && <section className={styles.completed}><button type="button" onClick={() => setShowDone((current) => !current)} aria-expanded={showDone}>완료한 일 {completed.length}개 {showDone ? '접기 ↑' : '보기 ↓'}</button>{showDone && completed.map(renderTask)}</section>}
  </div>;
}
