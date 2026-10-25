import { mtosApi } from './mtos-client';
import { nextDueDate, type TaskMeta } from './mtos-planning';
import { createP0Task, deleteP0Task, updateP0Task, type P0Task } from './p0-tasks-client';

const safe = (value: string) => value.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 120);

/**
 * Creates the next occurrence of a recurring task. The id and op_id come from
 * the series and due date, so repeating this (double click, retry) is a no-op.
 */
async function createNextOccurrence(task: P0Task, meta: TaskMeta, fromDue: string | null, today: string) {
  const rule = meta.recur;
  if (!rule) return null;
  const seriesId = meta.series_id ?? task.id;
  const due = nextDueDate(rule, fromDue, today);
  const id = `${safe(seriesId)}-r${due.replace(/-/g, '')}`;
  const { task: next } = await createP0Task({
    id, op_id: `mtos-recur-${id}`,
    fields: { title: task.title, category: task.category, project_id: task.project_id, due_date: due, memo: task.memo, source_url: task.source_url, status: 'open', is_today: false },
  });
  await mtosApi.putTaskMeta(next.id, { recur: rule, series_id: seriesId });
  return next;
}

/** Completing a recurring task records the occurrence and schedules the next one. */
export async function completeTask(task: P0Task, meta: TaskMeta | undefined, today: string) {
  const result = await updateP0Task(task.id, { base_version: task.version, changes: { status: 'done' }, op_id: `mtos-web-status-${crypto.randomUUID()}` });
  if (meta?.recur && !result.conflicts.length) {
    const seriesId = meta.series_id ?? task.id;
    if (!meta.series_id) await mtosApi.putTaskMeta(task.id, { series_id: seriesId });
    await mtosApi.recordOccurrence({ series_id: seriesId, due_date: task.due_date ?? today, state: 'done', task_id: task.id });
    await createNextOccurrence(task, { ...meta, series_id: seriesId }, task.due_date, today);
  }
  return result;
}

/**
 * Skipping a missed occurrence is recorded as "skipped" (not completed). The
 * P0 task is soft-deleted (its revision history stays) and the next one is created.
 */
export async function skipOccurrence(task: P0Task, meta: TaskMeta, today: string) {
  const seriesId = meta.series_id ?? task.id;
  await mtosApi.recordOccurrence({ series_id: seriesId, due_date: task.due_date ?? today, state: 'skipped', task_id: task.id });
  await createNextOccurrence(task, { ...meta, series_id: seriesId }, task.due_date, today);
  await deleteP0Task(task.id);
}

/** Deferring keeps the same task and moves only its due date. */
export async function deferOccurrence(task: P0Task, meta: TaskMeta, to: string) {
  const seriesId = meta.series_id ?? task.id;
  await mtosApi.recordOccurrence({ series_id: seriesId, due_date: task.due_date ?? to, state: 'deferred', task_id: task.id, deferred_to: to });
  return updateP0Task(task.id, { base_version: task.version, changes: { due_date: to }, op_id: `mtos-defer-${task.id}-${to}` });
}

/** Adds steps under a parent task. Ids derive from the parent and order so a retry does not duplicate. */
export async function addSteps(parent: P0Task, titles: string[], startOrder: number, batchId: string) {
  const created: P0Task[] = [];
  for (const [index, title] of titles.entries()) {
    const order = startOrder + index;
    const id = `${safe(parent.id)}-s${safe(batchId).slice(0, 12)}-${order}`;
    const { task } = await createP0Task({
      id, op_id: `mtos-step-${id}`,
      fields: { title: title.trim().slice(0, 500), category: parent.category, project_id: parent.project_id, due_date: null, status: 'open', is_today: false, memo: `상위 작업: ${parent.title}` },
    });
    await mtosApi.putTaskMeta(task.id, { parent_task_id: parent.id, step_order: order });
    created.push(task);
  }
  return created;
}
