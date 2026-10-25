export type P0TaskCategory = 'research' | 'school' | 'personal' | 'unclassified';
export type P0TaskStatus = 'open' | 'done';

export type P0Task = {
  id: string;
  title: string;
  status: P0TaskStatus;
  due_date: string | null;
  is_today: boolean;
  category: P0TaskCategory;
  project_id: string | null;
  memo: string;
  source_url: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  deleted: boolean;
  is_new?: boolean;
  _pending?: boolean;
};

export type P0Session = { configured: boolean; googleClientId: string | null; authenticated: boolean };
export type P0SyncStatus = { pending: number; online: boolean; authRequired: boolean; conflicts: number; rejected: number; lastPull?: string };
export type P0SyncSnapshot = { tasks: P0Task[]; status: P0SyncStatus; conflicts: unknown[]; rejected: unknown[] };
export type P0SyncBridge = {
  snapshot: () => Promise<P0SyncSnapshot>;
  sync: () => Promise<P0SyncSnapshot>;
  createTask: (body: { id: string; op_id: string; fields: Record<string, unknown> }) => Promise<P0SyncSnapshot>;
  updateTask: (id: string, changes: Record<string, unknown>) => Promise<P0SyncSnapshot>;
  deleteTask: (id: string) => Promise<P0SyncSnapshot>;
};
export type P0TaskList = { tasks: P0Task[]; conflicts: unknown[]; rejected?: unknown[]; syncStatus?: P0SyncStatus };
export type P0TaskMutation = { task: P0Task; conflicts: unknown[]; duplicate?: boolean; syncStatus?: P0SyncStatus };
export const P0_SESSION_INVALID_EVENT = 'mtos:p0-session-invalid';

declare global {
  interface Window { __mtosP0SyncBridge?: P0SyncBridge }
}

export function setP0SyncBridge(bridge: P0SyncBridge | null) {
  if (typeof window !== 'undefined') {
    if (bridge) window.__mtosP0SyncBridge = bridge;
    else delete window.__mtosP0SyncBridge;
  }
}

function currentP0SyncBridge() {
  return typeof window === 'undefined' ? null : window.__mtosP0SyncBridge ?? null;
}

export function notifyP0SessionInvalid(response: Response) {
  if (response.status === 401 && typeof window !== 'undefined') {
    window.dispatchEvent(new Event(P0_SESSION_INVALID_EVENT));
  }
}

export function p0InboxTaskId(entryId: string) {
  return `inbox-${entryId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 180)}`;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { cache: 'no-store', ...init });
  } catch {
    throw new Error('Master Thesis OS 서버에 연결할 수 없어.');
  }
  if (url !== '/api/p0/session') notifyP0SessionInvalid(response);
  const data: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof data === 'object' && data !== null && 'error' in data && typeof data.error === 'string'
      ? data.error
      : `요청에 실패했어 (${response.status})`;
    throw new Error(message);
  }
  return data as T;
}

function json(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
}

export const getP0Session = () => request<P0Session>('/api/p0/session');
export const loginToP0 = (idToken: string) => request<{ authenticated: true }>('/api/p0/session', json('POST', {
  id_token: idToken,
  device_label: typeof navigator === 'undefined' ? 'Master Thesis OS' : `Chocomint Lab · ${navigator.userAgent.slice(0, 70)}`,
}));
export const logoutFromP0 = () => request<{ authenticated: false; serverRevoked: boolean }>('/api/p0/session', json('DELETE'));
export async function listP0Tasks(): Promise<P0TaskList> {
  const bridge = getP0SyncBridge();
  if (!bridge) return request<P0TaskList>('/api/p0/tasks');
  const snapshot = await bridge.sync();
  return { tasks: snapshot.tasks, conflicts: snapshot.conflicts, rejected: snapshot.rejected, syncStatus: snapshot.status };
}

export async function createP0Task(body: { id: string; op_id: string; fields: Record<string, unknown> }): Promise<P0TaskMutation> {
  const bridge = getP0SyncBridge();
  if (!bridge) return request<P0TaskMutation>('/api/p0/tasks', json('POST', body));
  const snapshot = await bridge.createTask(body);
  const task = snapshot.tasks.find((item) => item.id === body.id);
  if (!task) throw new Error('오프라인 작업 큐에 저장된 항목을 찾을 수 없어.');
  return { task, conflicts: snapshot.conflicts, syncStatus: snapshot.status };
}

export async function updateP0Task(id: string, body: { base_version: number; changes: Record<string, unknown>; op_id: string }): Promise<P0TaskMutation> {
  const bridge = getP0SyncBridge();
  if (!bridge) return request<P0TaskMutation>(`/api/p0/tasks/${encodeURIComponent(id)}`, json('PATCH', body));
  const snapshot = await bridge.updateTask(id, body.changes);
  const task = snapshot.tasks.find((item) => item.id === id);
  if (!task) throw new Error('작업을 찾을 수 없어.');
  return { task, conflicts: snapshot.conflicts, syncStatus: snapshot.status };
}

export async function deleteP0Task(id: string): Promise<{ task: P0Task; syncStatus?: P0SyncStatus }> {
  const bridge = getP0SyncBridge();
  if (!bridge) return request<{ task: P0Task }>(`/api/p0/tasks/${encodeURIComponent(id)}`, json('DELETE'));
  const before = await bridge.snapshot();
  const task = before.tasks.find((item) => item.id === id);
  if (!task) throw new Error('작업을 찾을 수 없어.');
  const snapshot = await bridge.deleteTask(id);
  return { task: { ...task, deleted: true, _pending: snapshot.status.pending > 0 }, syncStatus: snapshot.status };
}
export const markP0TasksSeen = (body: { ids?: string[]; all?: true }) => request<{ marked: number }>('/api/p0/tasks/seen', json('POST', body));

export function getP0SyncBridge() {
  return currentP0SyncBridge();
}
