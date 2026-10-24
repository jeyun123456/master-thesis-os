import type { P0TaskCategory } from './p0-tasks-client';

export type P0PendingCreate = {
  id: string;
  op_id: string;
  fields: {
    title: string;
    due_date: string | null;
    category: P0TaskCategory;
    status: 'open';
    is_today: false;
  };
};

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const STORAGE_KEY = 'mtos-p0-pending-create';
const safeId = /^[A-Za-z0-9_-]{1,200}$/;
const categories = new Set<P0TaskCategory>(['research', 'school', 'personal']);

function parsePendingCreate(value: unknown): P0PendingCreate | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.id !== 'string' || !safeId.test(candidate.id)
    || typeof candidate.op_id !== 'string' || !candidate.op_id.trim() || candidate.op_id.length > 200
    || typeof candidate.fields !== 'object' || candidate.fields === null || Array.isArray(candidate.fields)) return null;
  const fields = candidate.fields as Record<string, unknown>;
  if (typeof fields.title !== 'string' || !fields.title.trim() || fields.title.length > 500
    || (fields.due_date !== null && (typeof fields.due_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(fields.due_date)))
    || typeof fields.category !== 'string' || !categories.has(fields.category as P0TaskCategory)
    || fields.status !== 'open' || fields.is_today !== false) return null;
  return {
    id: candidate.id,
    op_id: candidate.op_id,
    fields: {
      title: fields.title,
      due_date: fields.due_date as string | null,
      category: fields.category as P0TaskCategory,
      status: 'open',
      is_today: false,
    },
  };
}

export function readP0PendingCreate(storage: StorageLike | null): P0PendingCreate | null {
  if (!storage) return null;
  try {
    const serialized = storage.getItem(STORAGE_KEY);
    if (!serialized) return null;
    const pending = parsePendingCreate(JSON.parse(serialized) as unknown);
    if (!pending) storage.removeItem(STORAGE_KEY);
    return pending;
  } catch {
    return null;
  }
}

export function saveP0PendingCreate(storage: StorageLike | null, pending: P0PendingCreate): boolean {
  if (!storage) return false;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(pending));
    return true;
  } catch {
    return false;
  }
}

export function clearP0PendingCreate(storage: StorageLike | null): void {
  if (!storage) return;
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    // The saved idempotency key remains safe to retry on the next load.
  }
}
