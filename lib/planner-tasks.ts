export const PLANNER_TASKS_STORAGE_KEY = 'chocomintLab.plannerTasks.v1';
export const PLANNER_TASKS_VERSION = 1;

import type { InboxEntry } from './inbox';

export type PlannerTaskStatus = 'pending' | 'done';
export type PlannerTaskSource = 'inbox' | 'manual';
export type PlannerTask = {
  id: string;
  title: string;
  description: string;
  dueDate: string | null;
  source: PlannerTaskSource;
  inboxItemId: string | null;
  projectId: string | null;
  status: PlannerTaskStatus;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

export function parsePlannerTasks(value: unknown): PlannerTask[] {
  const tasksValue = Array.isArray(value) ? value
    : isRecord(value) && value.version === PLANNER_TASKS_VERSION && Array.isArray(value.tasks) ? value.tasks
      : [];
  const seen = new Set<string>();
  return tasksValue.flatMap((raw): PlannerTask[] => {
    if (!isRecord(raw) || typeof raw.id !== 'string' || !raw.id.trim() || raw.id.length > 256
      || typeof raw.title !== 'string' || !raw.title.trim() || raw.title.length > 1200
      || (raw.status !== 'pending' && raw.status !== 'done')) return [];
    const id = raw.id.trim();
    if (seen.has(id)) return [];
    seen.add(id);
    const createdAt = typeof raw.createdAt === 'string' && !Number.isNaN(Date.parse(raw.createdAt)) ? raw.createdAt : new Date(0).toISOString();
    const updatedAt = typeof raw.updatedAt === 'string' && !Number.isNaN(Date.parse(raw.updatedAt)) ? raw.updatedAt : createdAt;
    const rawInboxItemId = typeof raw.inboxItemId === 'string' ? raw.inboxItemId : raw.sourceInboxId;
    const inboxItemId = typeof rawInboxItemId === 'string' && rawInboxItemId ? rawInboxItemId.slice(0, 256) : null;
    const projectId = typeof raw.projectId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(raw.projectId) ? raw.projectId : null;
    return [{
      id,
      title: raw.title.trim(),
      description: typeof raw.description === 'string' ? raw.description.slice(0, 1200) : '',
      dueDate: validDate(raw.dueDate) ? raw.dueDate : null,
      source: inboxItemId ? 'inbox' : 'manual',
      inboxItemId,
      projectId,
      status: raw.status,
      createdAt,
      updatedAt,
      completedAt: typeof raw.completedAt === 'string' && !Number.isNaN(Date.parse(raw.completedAt)) ? raw.completedAt : null,
    }];
  }).sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
}

export function plannerTaskFromInboxEntry(entry: InboxEntry): PlannerTask | null {
  if (entry.ai?.category !== 'todo') return null;
  const title = (entry.ai.nextAction || entry.ai.title || entry.rawText).trim().slice(0, 1200);
  if (!title) return null;
  const createdAt = Number.isNaN(Date.parse(entry.createdAt)) ? new Date(0).toISOString() : entry.createdAt;
  const updatedAt = entry.ai.processedAt && !Number.isNaN(Date.parse(entry.ai.processedAt)) ? entry.ai.processedAt : createdAt;
  return {
    id: `inbox:${entry.id}`,
    title,
    description: (entry.ai.summary || entry.rawText).slice(0, 1200),
    dueDate: validDate(entry.ai.dueDate) ? entry.ai.dueDate : null,
    source: 'inbox',
    inboxItemId: entry.id,
    projectId: null,
    status: 'pending',
    createdAt,
    updatedAt,
    completedAt: null,
  };
}

export function ensureInboxPlannerTasks(entries: InboxEntry[], tasks: PlannerTask[]): { tasks: PlannerTask[]; added: PlannerTask[] } {
  const existingIds = new Set(tasks.map((task) => task.id));
  const added: PlannerTask[] = [];
  for (const entry of entries) {
    const candidate = plannerTaskFromInboxEntry(entry);
    if (candidate && !existingIds.has(candidate.id)) {
      added.push(candidate);
      existingIds.add(candidate.id);
    }
  }
  return { tasks: mergePlannerTasks(tasks, added), added };
}

export function mergePlannerTasks(persisted: PlannerTask[], cached: PlannerTask[]): PlannerTask[] {
  const merged = new Map(persisted.map((task) => [task.id, task]));
  for (const cachedTask of cached) {
    const stored = merged.get(cachedTask.id);
    if (!stored || Date.parse(cachedTask.updatedAt) > Date.parse(stored.updatedAt)) merged.set(cachedTask.id, cachedTask);
  }
  return [...merged.values()].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
}

export function filterDeletedPlannerTasks(tasks: PlannerTask[], deletedTaskIds: string[]): PlannerTask[] {
  const deleted = new Set(deletedTaskIds);
  return tasks.filter((task) => !deleted.has(task.id));
}

export function loadCachedPlannerTasks(storage?: StorageLike): PlannerTask[] {
  const target = resolveStorage(storage);
  if (!target) return [];
  try {
    const raw = target.getItem(PLANNER_TASKS_STORAGE_KEY);
    return raw ? parsePlannerTasks(JSON.parse(raw) as unknown) : [];
  } catch {
    return [];
  }
}

export function saveCachedPlannerTasks(tasks: PlannerTask[], storage?: StorageLike): boolean {
  const target = resolveStorage(storage);
  if (!target) return false;
  try {
    target.setItem(PLANNER_TASKS_STORAGE_KEY, JSON.stringify({ version: PLANNER_TASKS_VERSION, tasks }));
    return true;
  } catch {
    return false;
  }
}

function resolveStorage(storage?: StorageLike): StorageLike | null {
  if (storage) return storage;
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}
