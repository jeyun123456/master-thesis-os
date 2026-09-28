import { readBridgeToken } from './inbox-persistence-client';

export type ProjectWorkspaceItem = {
  path: string;
  type: 'blob';
  size?: number;
  modifiedAt?: string;
};

export type RecentProjectFile = ProjectWorkspaceItem & {
  name: string;
  extension: string;
};

export type ProjectWorkspace = {
  projectId: string;
  rootPath: string;
  items: ProjectWorkspaceItem[];
  folders: string[];
  recentFiles: RecentProjectFile[];
};

type BridgeInit = RequestInit & { targetAddressSpace?: 'loopback' };

function init(token: string, body: Record<string, unknown>): BridgeInit {
  const request: BridgeInit = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, ...body }),
  };
  if (typeof navigator !== 'undefined' && navigator.userAgent.startsWith('Sucrose')) request.targetAddressSpace = 'loopback';
  return request;
}

async function post<T>(path: string, body: Record<string, unknown>, token = readBridgeToken(), fetchImpl: typeof fetch = fetch): Promise<T> {
  if (!token.trim()) throw new Error('Local Bridge token이 없어.');
  const base = (process.env.NEXT_PUBLIC_LOCAL_BRIDGE_URL || 'http://127.0.0.1:38471').replace(/\/+$/, '');
  let response: Response;
  try {
    response = await fetchImpl(`${base}${path}`, init(token, body));
  } catch {
    throw new Error('Local Bridge에 연결할 수 없어.');
  }
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok || data.ok !== true) throw new Error(typeof data.error === 'string' ? data.error : 'Local Bridge 요청에 실패했어.');
  return data as T;
}

export async function getProjectWorkspace(projectId: string): Promise<ProjectWorkspace> {
  const response = await post<ProjectWorkspace & { ok: true; source: 'vault' }>('/projects/workspace', { projectId });
  if (response.projectId !== projectId || !Array.isArray(response.items) || !Array.isArray(response.folders) || !Array.isArray(response.recentFiles)) {
    throw new Error('프로젝트 작업 폴더 응답 형식이 올바르지 않아.');
  }
  return response;
}
