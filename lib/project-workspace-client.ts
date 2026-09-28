import { readBridgeToken } from './inbox-persistence-client';
import { bridgeApiVersionMismatchMessage, checkLocalBridgeApiVersion } from './bridge-status';

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
  manifestText: string | null;
  manifestSha: string | null;
};

export type ProjectMetadataOperation = 'stage' | 'status' | 'favorite_add' | 'favorite_remove' | 'next_task_add';
export type ProjectMetadataUpdate = {
  projectId: string;
  manifestText: string;
  manifestSha: string;
  added?: boolean;
};

export class ProjectWorkspaceError extends Error {
  constructor(public readonly state: 'offline' | 'unknown' | 'outdated' | 'auth' | 'error', message: string) {
    super(message);
    this.name = 'ProjectWorkspaceError';
  }
}

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
  if (!token.trim()) throw new ProjectWorkspaceError('auth', 'Local Bridge token이 없어.');
  const base = (process.env.NEXT_PUBLIC_LOCAL_BRIDGE_URL || 'http://127.0.0.1:38471').replace(/\/+$/, '');
  let response: Response;
  try {
    response = await fetchImpl(`${base}${path}`, init(token, body));
  } catch {
    throw new ProjectWorkspaceError('offline', 'Local Bridge에 연결할 수 없어.');
  }
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok || data.ok !== true) {
    const message = typeof data.error === 'string' ? data.error : 'Local Bridge 요청에 실패했어.';
    if (response.status === 404) {
      const version = await checkLocalBridgeApiVersion(fetchImpl);
      if (version.state === 'outdated') throw new ProjectWorkspaceError('outdated', bridgeApiVersionMismatchMessage(version.apiVersion));
      throw new ProjectWorkspaceError('unknown', '프로젝트 작업 폴더 API 또는 Bridge 버전을 확인할 수 없어.');
    }
    const state = response.status === 403 ? 'auth' : response.status === 404 ? 'unknown' : 'error';
    throw new ProjectWorkspaceError(state, message);
  }
  return data as T;
}

export async function getProjectWorkspace(projectId: string): Promise<ProjectWorkspace> {
  const response = await post<ProjectWorkspace & { ok: true; source: 'vault' }>('/projects/workspace', { projectId });
  if (response.projectId !== projectId || !Array.isArray(response.items) || !Array.isArray(response.folders) || !Array.isArray(response.recentFiles)) {
    throw new Error('프로젝트 작업 폴더 응답 형식이 올바르지 않아.');
  }
  return response;
}

export async function updateProjectMetadata(
  projectId: string,
  operation: ProjectMetadataOperation,
  value: string,
  expectedSha: string,
): Promise<ProjectMetadataUpdate> {
  const response = await post<ProjectMetadataUpdate & { ok: true; source: 'vault' }>('/projects/update', {
    projectId,
    operation,
    value,
    expectedSha,
  });
  if (response.projectId !== projectId || typeof response.manifestText !== 'string' || typeof response.manifestSha !== 'string') {
    throw new Error('프로젝트 저장 응답 형식을 확인할 수 없어.');
  }
  return response;
}
