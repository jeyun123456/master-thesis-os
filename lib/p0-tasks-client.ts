export type P0TaskCategory = 'research' | 'school' | 'personal';
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
};

export type P0Session = { configured: boolean; googleClientId: string | null; authenticated: boolean };
export type P0TaskList = { tasks: P0Task[]; conflicts: unknown[] };
export type P0TaskMutation = { task: P0Task; conflicts: unknown[]; duplicate?: boolean };
export const P0_SESSION_INVALID_EVENT = 'mtos:p0-session-invalid';

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
export const listP0Tasks = () => request<P0TaskList>('/api/p0/tasks');
export const createP0Task = (body: { id: string; op_id: string; fields: Record<string, unknown> }) => request<P0TaskMutation>('/api/p0/tasks', json('POST', body));
export const updateP0Task = (id: string, body: { base_version: number; changes: Record<string, unknown>; op_id: string }) => request<P0TaskMutation>(`/api/p0/tasks/${encodeURIComponent(id)}`, json('PATCH', body));
