import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createP0Task,
  deleteP0Task,
  listP0Tasks,
  updateP0Task,
  type P0SyncBridge,
  type P0SyncSnapshot,
  type P0Task,
} from './p0-tasks-client';

const task: P0Task = {
  id: 'task-1',
  title: '오프라인 항목',
  status: 'open',
  due_date: null,
  is_today: false,
  category: 'unclassified',
  project_id: null,
  memo: '',
  source_url: null,
  version: 1,
  created_at: '2026-10-25T00:00:00.000Z',
  updated_at: '2026-10-25T00:00:00.000Z',
  completed_at: null,
  deleted: false,
};
const status = { pending: 1, online: false, authRequired: false, conflicts: 0, rejected: 0 };
const snapshot: P0SyncSnapshot = { tasks: [task], status, conflicts: [], rejected: [] };

afterEach(() => vi.unstubAllGlobals());

describe('P0 home uses the existing native IndexedDB sync bridge', () => {
  it('routes task reads, create, update, and delete through the same queue', async () => {
    const updatedTask = { ...task, status: 'done' as const, version: 2 };
    const bridge: P0SyncBridge = {
      snapshot: vi.fn(async () => snapshot),
      sync: vi.fn(async () => snapshot),
      createTask: vi.fn(async () => snapshot),
      updateTask: vi.fn(async () => ({ ...snapshot, tasks: [updatedTask] })),
      deleteTask: vi.fn(async () => ({ ...snapshot, tasks: [] })),
    };
    vi.stubGlobal('window', { __mtosP0SyncBridge: bridge });

    const listed = await listP0Tasks();
    expect(bridge.sync).toHaveBeenCalledOnce();
    expect(listed.tasks).toEqual([task]);
    expect(listed.syncStatus).toEqual(status);

    const created = await createP0Task({ id: task.id, op_id: 'create-op', fields: { title: task.title } });
    expect(bridge.createTask).toHaveBeenCalledWith({ id: task.id, op_id: 'create-op', fields: { title: task.title } });
    expect(created.task.id).toBe(task.id);

    const updated = await updateP0Task(task.id, { base_version: 1, op_id: 'update-op', changes: { status: 'done' } });
    expect(bridge.updateTask).toHaveBeenCalledWith(task.id, { status: 'done' });
    expect(updated.task.status).toBe('done');

    const deleted = await deleteP0Task(task.id);
    expect(bridge.deleteTask).toHaveBeenCalledWith(task.id);
    expect(deleted.task).toMatchObject({ id: task.id, deleted: true });
  });
});
