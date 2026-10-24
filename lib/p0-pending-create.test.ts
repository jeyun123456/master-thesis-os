import { describe, expect, it } from 'vitest';
import { clearP0PendingCreate, readP0PendingCreate, saveP0PendingCreate, type P0PendingCreate } from './p0-pending-create';

function createStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

const pending: P0PendingCreate = {
  id: 'task-1',
  op_id: 'mtos-web-request-1',
  fields: { title: '응답 불명 생성 재시도', due_date: null, category: 'research', status: 'open', is_today: false },
};

describe('P0 pending create persistence', () => {
  it('retains the same idempotency key across reloads and clears it after success', () => {
    const storage = createStorage();
    expect(saveP0PendingCreate(storage, pending)).toBe(true);
    expect(readP0PendingCreate(storage)).toEqual(pending);
    expect(readP0PendingCreate(storage)?.op_id).toBe(pending.op_id);
    clearP0PendingCreate(storage);
    expect(readP0PendingCreate(storage)).toBeNull();
  });

  it('drops malformed or unsafe pending data without returning it', () => {
    const storage = createStorage();
    storage.setItem('mtos-p0-pending-create', JSON.stringify({ ...pending, id: '../other-task' }));
    expect(readP0PendingCreate(storage)).toBeNull();
    expect(storage.values.has('mtos-p0-pending-create')).toBe(false);
  });

  it('handles unavailable browser storage without throwing', () => {
    expect(readP0PendingCreate(null)).toBeNull();
    expect(saveP0PendingCreate(null, pending)).toBe(false);
    expect(() => clearP0PendingCreate(null)).not.toThrow();
  });
});
