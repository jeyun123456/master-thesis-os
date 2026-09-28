import { readBridgeToken } from './inbox-persistence-client';
import { parsePlannerTasks, type PlannerTask } from './planner-tasks';

type BridgeRequestInit = RequestInit & { targetAddressSpace?: 'loopback' };
const REQUEST_TIMEOUT_MS = 10_000;

export type PlannerTaskStore = { tasks: PlannerTask[]; deletedTaskIds: string[] };

function bridgeUrl() {
  return (process.env.NEXT_PUBLIC_LOCAL_BRIDGE_URL || 'http://127.0.0.1:38471').replace(/\/+$/, '');
}

async function request<T>(path: string, method: 'GET' | 'POST', body: Record<string, unknown> = {}, token = readBridgeToken(), fetchImpl: typeof fetch = fetch): Promise<T> {
  if (!token.trim()) throw new Error('Local Bridge token이 없어 Vault의 Planner 할 일을 읽고 쓸 수 없어.');
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const init: BridgeRequestInit = {
    method,
    headers: method === 'GET' ? { 'X-Bridge-Token': token } : { 'Content-Type': 'application/json' },
    ...(method === 'POST' ? { body: JSON.stringify({ token, ...body }) } : {}),
    signal: controller.signal,
  };
  if (typeof navigator !== 'undefined' && navigator.userAgent.startsWith('Sucrose')) init.targetAddressSpace = 'loopback';
  try {
    const response = await fetchImpl(`${bridgeUrl()}${path}`, init);
    const data = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok || data.ok !== true || data.source !== 'vault' || data.version !== 1) {
      if (response.status === 404) throw new Error('Planner 작업 API를 찾을 수 없어. Bridge 버전을 확인하거나 Companion을 다시 시작해줘.');
      throw new Error(typeof data.error === 'string' ? data.error : 'Planner 할 일을 저장소에서 읽지 못했어.');
    }
    return data as T;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error('Local Bridge 응답이 늦어 Planner 저장을 확인하지 못했어.');
    if (error instanceof TypeError) throw new Error('Local Bridge에 연결할 수 없어. 브라우저 캐시는 유지돼.');
    throw error instanceof Error ? error : new Error('Planner 할 일을 읽지 못했어.');
  } finally {
    clearTimeout(timeoutId);
  }
}

function parseStore(data: Record<string, unknown>): PlannerTaskStore {
  if (!Array.isArray(data.tasks) || (data.deletedTaskIds !== undefined && (!Array.isArray(data.deletedTaskIds) || data.deletedTaskIds.some((id) => typeof id !== 'string')))) {
    throw new Error('Planner 할 일 응답 형식을 확인할 수 없어.');
  }
  return {
    tasks: parsePlannerTasks(data.tasks),
    deletedTaskIds: Array.isArray(data.deletedTaskIds) ? data.deletedTaskIds as string[] : [],
  };
}

export async function loadPlannerTaskStore(token = readBridgeToken(), fetchImpl: typeof fetch = fetch): Promise<PlannerTaskStore> {
  const data = await request<Record<string, unknown>>('/planner/tasks', 'GET', {}, token, fetchImpl);
  return parseStore(data);
}

export async function loadPlannerTasks(token = readBridgeToken(), fetchImpl: typeof fetch = fetch): Promise<PlannerTask[]> {
  return (await loadPlannerTaskStore(token, fetchImpl)).tasks;
}

export async function savePlannerTasks(tasks: PlannerTask[], token = readBridgeToken(), fetchImpl: typeof fetch = fetch): Promise<PlannerTask[]> {
  const data = await request<Record<string, unknown>>('/planner/tasks', 'POST', { tasks }, token, fetchImpl);
  return parseStore(data).tasks;
}

export async function addPlannerTask(task: PlannerTask, token = readBridgeToken(), fetchImpl: typeof fetch = fetch): Promise<PlannerTask[]> {
  const data = await request<Record<string, unknown>>('/planner/tasks', 'POST', { task }, token, fetchImpl);
  return parseStore(data).tasks;
}

export async function syncInboxPlannerTasks(token = readBridgeToken(), fetchImpl: typeof fetch = fetch): Promise<PlannerTaskStore> {
  const data = await request<Record<string, unknown>>('/planner/tasks/sync-inbox', 'POST', {}, token, fetchImpl);
  return parseStore(data);
}

export async function updatePlannerTaskProject(taskId: string, projectId: string, token = readBridgeToken(), fetchImpl: typeof fetch = fetch): Promise<PlannerTaskStore> {
  const data = await request<Record<string, unknown>>('/planner/tasks/update', 'POST', { taskId, projectId }, token, fetchImpl);
  return parseStore(data);
}

export async function deletePlannerTask(taskId: string, token = readBridgeToken(), fetchImpl: typeof fetch = fetch): Promise<PlannerTaskStore> {
  const data = await request<Record<string, unknown>>('/planner/tasks/delete', 'POST', { taskId }, token, fetchImpl);
  return parseStore(data);
}
