import { readBridgeToken } from './inbox-persistence-client';
import { parsePlannerTasks, type PlannerTask } from './planner-tasks';

type BridgeRequestInit = RequestInit & { targetAddressSpace?: 'loopback' };
const REQUEST_TIMEOUT_MS = 10_000;

function bridgeUrl() {
  return (process.env.NEXT_PUBLIC_LOCAL_BRIDGE_URL || 'http://127.0.0.1:38471').replace(/\/+$/, '');
}

function requestInit(method: 'GET' | 'POST', token: string, tasks?: PlannerTask[], task?: PlannerTask, signal?: AbortSignal): BridgeRequestInit {
  const init: BridgeRequestInit = {
    method,
    headers: method === 'GET'
      ? { 'X-Bridge-Token': token }
      : { 'Content-Type': 'application/json' },
    ...(method === 'POST' ? { body: JSON.stringify({ token, ...(tasks ? { tasks } : {}), ...(task ? { task } : {}) }) } : {}),
    ...(signal ? { signal } : {}),
  };
  if (typeof navigator !== 'undefined' && navigator.userAgent.startsWith('Sucrose')) init.targetAddressSpace = 'loopback';
  return init;
}

async function request(method: 'GET' | 'POST', tasks?: PlannerTask[], task?: PlannerTask, token = readBridgeToken(), fetchImpl: typeof fetch = fetch): Promise<PlannerTask[]> {
  if (!token.trim()) throw new Error('Local Bridge token이 없어 Vault의 Planner 할 일을 읽고 쓸 수 없어.');
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(`${bridgeUrl()}/planner/tasks`, requestInit(method, token, tasks, task, controller.signal));
    const data = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) {
      if (response.status === 404) throw new Error('Planner 작업 API를 찾을 수 없어. Bridge 버전을 확인하거나 Companion을 다시 시작해줘.');
      throw new Error(typeof data.error === 'string' ? data.error : 'Planner 할 일을 저장소에서 읽지 못했어.');
    }
    if (data.ok !== true || data.source !== 'vault' || data.version !== 1 || !Array.isArray(data.tasks)) {
      throw new Error('Planner 할 일 응답 형식을 확인할 수 없어.');
    }
    return parsePlannerTasks(data.tasks);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error('Local Bridge 응답이 늦어 Planner 저장을 확인하지 못했어.');
    if (error instanceof TypeError) throw new Error('Local Bridge에 연결할 수 없어. 브라우저 캐시는 유지돼.');
    throw error instanceof Error ? error : new Error('Planner 할 일을 읽지 못했어.');
  } finally {
    clearTimeout(timeoutId);
  }
}

export function loadPlannerTasks(token = readBridgeToken(), fetchImpl: typeof fetch = fetch): Promise<PlannerTask[]> {
  return request('GET', undefined, undefined, token, fetchImpl);
}

export function savePlannerTasks(tasks: PlannerTask[], token = readBridgeToken(), fetchImpl: typeof fetch = fetch): Promise<PlannerTask[]> {
  return request('POST', tasks, undefined, token, fetchImpl);
}

export function addPlannerTask(task: PlannerTask, token = readBridgeToken(), fetchImpl: typeof fetch = fetch): Promise<PlannerTask[]> {
  return request('POST', undefined, task, token, fetchImpl);
}
