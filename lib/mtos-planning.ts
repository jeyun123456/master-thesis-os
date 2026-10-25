import type { P0Task } from './p0-tasks-client';

export type Milestone = {
  id: string;
  project_id: string;
  title: string;
  date: string;
  status: 'planned' | 'done' | 'missed' | 'cancelled';
  kind: 'official' | 'internal';
  source: string;
  evidence_url: string | null;
  version: number;
};

export type RecurRule = { mode: 'fixed' | 'after_completion'; every_days: number; anchor_date: string | null };

export type TaskMeta = {
  task_id: string;
  parent_task_id: string | null;
  step_order: number | null;
  ai_generated: boolean;
  source_ref: string | null;
  blocked_reason: string | null;
  snooze_until: string | null;
  recur: RecurRule | null;
  series_id: string | null;
};

const DAY_MS = 86_400_000;
const byDueThenCreated = (a: P0Task, b: P0Task) => (a.due_date || '9999-99-99').localeCompare(b.due_date || '9999-99-99') || a.created_at.localeCompare(b.created_at);

export function addDays(day: string, days: number) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

export type ProjectTaskSummary = {
  remaining: number;
  done: number;
  nextTask: P0Task | null;
  nearestDue: { date: string; label: string; kind: 'task' | 'official' | 'internal' } | null;
};

/**
 * Per-project numbers for a Kanban card, from P0 tasks linked by project_id
 * (never guessed from titles) plus planned milestones.
 */
export function summarizeProject(projectId: string, tasks: P0Task[], milestones: Milestone[] = [], meta: Map<string, TaskMeta> = new Map()): ProjectTaskSummary {
  const linked = tasks.filter((task) => !task.deleted && task.project_id === projectId);
  const open = linked.filter((task) => task.status === 'open');
  const actionable = open.filter((task) => !hasOpenChildren(task.id, open, meta) && !meta.get(task.id)?.blocked_reason);
  const nextTask = [...actionable].sort((a, b) => Number(b.is_today) - Number(a.is_today) || byDueThenCreated(a, b))[0]
    ?? [...open].sort(byDueThenCreated)[0] ?? null;
  const candidates: NonNullable<ProjectTaskSummary['nearestDue']>[] = [
    ...open.filter((task) => task.due_date).map((task) => ({ date: task.due_date as string, label: task.title, kind: 'task' as const })),
    ...milestones.filter((m) => m.project_id === projectId && m.status === 'planned').map((m) => ({ date: m.date, label: m.title, kind: m.kind })),
  ];
  const nearestDue = candidates.sort((a, b) => a.date.localeCompare(b.date) || (a.kind === 'official' ? -1 : 1))[0] ?? null;
  return { remaining: open.length, done: linked.length - open.length, nextTask, nearestDue };
}

function hasOpenChildren(taskId: string, open: P0Task[], meta: Map<string, TaskMeta>) {
  return open.some((task) => meta.get(task.id)?.parent_task_id === taskId);
}

/** Open, due-soon (within `soonDays`, including overdue) and done tasks of one project. */
export function projectTaskBuckets(projectId: string, tasks: P0Task[], today: string, soonDays = 7) {
  const linked = tasks.filter((task) => !task.deleted && task.project_id === projectId);
  const open = linked.filter((task) => task.status === 'open').sort(byDueThenCreated);
  const limit = addDays(today, soonDays);
  return {
    open,
    dueSoon: open.filter((task) => task.due_date && task.due_date <= limit),
    done: linked.filter((task) => task.status === 'done').sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? '')),
  };
}

/** Task project links that point at no known project: shown for review, never re-assigned. */
export function unmatchedProjectLinks(tasks: P0Task[], projectIds: string[]) {
  const known = new Set(projectIds);
  return tasks.filter((task) => !task.deleted && task.project_id && !known.has(task.project_id));
}

export type Interval = { start: number; end: number };

/** Merges overlapping or touching busy intervals. */
export function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = intervals.filter((i) => i.end > i.start).sort((a, b) => a.start - b.start);
  const merged: Interval[] = [];
  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    if (last && interval.start <= last.end) last.end = Math.max(last.end, interval.end);
    else merged.push({ ...interval });
  }
  return merged;
}

export type FreeSlot = { start: string; end: string; minutes: number };

/**
 * 15–60 minute focus windows between merged busy blocks, inside the working
 * window (default 09:00–22:00 Asia/Tokyo) and not in the past. Only times are
 * used, so private event details never leave the calendar view.
 */
export function focusSlots(busy: Array<{ start: string; end: string; allDay?: boolean }>, day: string, now: number, { from = 9, to = 22, minMinutes = 15, maxMinutes = 60, limit = 6 } = {}): FreeSlot[] {
  const dayStart = Date.parse(`${day}T${String(from).padStart(2, '0')}:00:00+09:00`);
  const dayEnd = Date.parse(`${day}T${String(to).padStart(2, '0')}:00:00+09:00`);
  const blocks = mergeIntervals(busy.filter((e) => !e.allDay).map((e) => ({ start: Date.parse(e.start), end: Date.parse(e.end) }))
    .filter((i) => Number.isFinite(i.start) && Number.isFinite(i.end)));
  const slots: FreeSlot[] = [];
  let cursor = Math.max(dayStart, Math.ceil(now / (5 * 60_000)) * 5 * 60_000);
  for (const block of [...blocks, { start: dayEnd, end: dayEnd }]) {
    const gapEnd = Math.min(block.start, dayEnd);
    while (gapEnd - cursor >= minMinutes * 60_000 && slots.length < limit) {
      const end = Math.min(gapEnd, cursor + maxMinutes * 60_000);
      slots.push({ start: tokyoTime(cursor), end: tokyoTime(end), minutes: Math.round((end - cursor) / 60_000) });
      cursor = end;
    }
    cursor = Math.max(cursor, block.end);
    if (cursor >= dayEnd) break;
  }
  return slots;
}

function tokyoTime(ms: number) {
  return new Date(ms + 9 * 3600_000).toISOString().slice(11, 16);
}

/** Next due date of a recurring task. Fixed: next anchor step after the previous due date. After-completion: counted from the completion day. */
export function nextDueDate(rule: RecurRule, previousDue: string | null, completedOn: string) {
  if (rule.mode === 'after_completion') return addDays(completedOn, rule.every_days);
  const anchor = rule.anchor_date ?? previousDue ?? completedOn;
  const base = previousDue ?? anchor;
  const steps = Math.floor((Date.parse(`${base}T00:00:00Z`) - Date.parse(`${anchor}T00:00:00Z`)) / DAY_MS / rule.every_days) + 1;
  return addDays(anchor, Math.max(1, steps) * rule.every_days);
}

/** A fixed-schedule occurrence whose due date passed while still open needs a done/skip/defer decision. */
export function isMissedOccurrence(task: P0Task, meta: TaskMeta | undefined, today: string) {
  return Boolean(meta?.recur?.mode === 'fixed' && task.status === 'open' && task.due_date && task.due_date < today);
}

/** Tasks hidden from the home list today: snoozed until later, or shown in the focus/recommendation area. */
export function homeHiddenIds(tasks: P0Task[], meta: Map<string, TaskMeta>, today: string, shownAbove: Iterable<string>) {
  const hidden = new Set(shownAbove);
  for (const task of tasks) {
    const snooze = meta.get(task.id)?.snooze_until;
    if (snooze && snooze > today) hidden.add(task.id);
  }
  return hidden;
}

/** The next open step of a decomposed task, by step order. */
export function nextStep(parentId: string, tasks: P0Task[], meta: Map<string, TaskMeta>) {
  const steps = tasks.filter((task) => !task.deleted && meta.get(task.id)?.parent_task_id === parentId);
  const open = steps.filter((task) => task.status === 'open')
    .sort((a, b) => (meta.get(a.id)?.step_order ?? 999) - (meta.get(b.id)?.step_order ?? 999) || a.created_at.localeCompare(b.created_at));
  return { next: open[0] ?? null, total: steps.length, done: steps.length - open.length, allDone: steps.length > 0 && open.length === 0 };
}

export type DiffBlock = { kind: 'same' | 'added' | 'removed'; text: string };

/** Paragraph-level diff (LCS over blank-line separated blocks) for reviewing an Obsidian change. */
export function blockDiff(before: string, after: string): DiffBlock[] {
  const split = (value: string) => value.replace(/\r\n/g, '\n').split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  const a = split(before);
  const b = split(after);
  const table = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  }
  const out: DiffBlock[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { out.push({ kind: 'same', text: a[i] }); i += 1; j += 1; }
    else if (j < b.length && (i === a.length || table[i][j + 1] >= table[i + 1][j])) { out.push({ kind: 'added', text: b[j] }); j += 1; }
    else { out.push({ kind: 'removed', text: a[i] }); i += 1; }
  }
  return out;
}

/** Case-insensitive keyword match over P0 tasks and projects (agent data is searched server-side). */
export function localSearch(query: string, tasks: P0Task[], projects: Array<{ id: string; title: string; summary?: string; questions?: string[] }>) {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return { tasks: [], projects: [] };
  const has = (...values: Array<string | null | undefined>) => values.some((v) => v?.toLocaleLowerCase().includes(q));
  return {
    tasks: tasks.filter((t) => !t.deleted && has(t.title, t.memo, t.source_url)).slice(0, 30),
    projects: projects.filter((p) => has(p.id, p.title, p.summary, ...(p.questions ?? []))).slice(0, 20),
  };
}
