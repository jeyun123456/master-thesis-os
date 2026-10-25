import { NextResponse, type NextRequest } from 'next/server';
import { noStore, P0_APP_SESSION_COOKIE, P0ApiError, readRequestBytesLimited, sameOriginMutationError, serviceBaseUrl, serviceFetch } from './p0-server';

const DEFAULT_AGENT_URL = 'http://127.0.0.1:8788';
const MAX_BODY = 512 * 1024;
// First segment must be a known agent resource; deeper segments are ids/actions.
const RESOURCE = /^(status|worker|jobs|memos|milestones|inbox|approvals|task-meta|occurrences|focus|context|settings|search)(\/[A-Za-z0-9_-]{1,200}){0,2}$/;
const FORWARDED_QUERY = ['q', 'state', 'project_id', 'date'];

export type AgentErrorCode = 'agent_unconfigured' | 'agent_unreachable' | 'auth_required' | 'bad_path';

function agentError(status: number, code: AgentErrorCode, message: string) {
  return noStore(NextResponse.json({ error: message, code }, { status }));
}

/** Agent base URL. In production it must be configured explicitly, so a missing setting is reported as such, not as "no data". */
export function agentBaseUrl() {
  const raw = process.env.MTOS_AGENT_URL?.trim();
  if (!raw && process.env.NODE_ENV === 'production') return null;
  return serviceBaseUrl(raw || DEFAULT_AGENT_URL, 'MTOS agent');
}

/** Server-side agent call on behalf of the signed-in user (for routes that also touch the Vault). */
export async function agentServerRequest<T>(token: string, path: string, method: 'GET' | 'POST' = 'GET', body?: unknown): Promise<T> {
  const base = agentBaseUrl();
  if (!base) throw new P0ApiError(503, 'AI·연구 데이터 서버(MTOS_AGENT_URL)가 설정되지 않았어.');
  const headers = new Headers({ accept: 'application/json', authorization: `Bearer ${token}` });
  if (body !== undefined) headers.set('content-type', 'application/json');
  const response = await serviceFetch(new URL(`/agent/api/${path}`, base), { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }, 'AI·연구 데이터 서버에 연결할 수 없어.');
  const data = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new P0ApiError(response.status === 500 ? 502 : response.status, data.error ?? `agent request failed (${response.status})`);
  return data;
}

/** Proxies one browser request to `/agent/api/<path>` with the user's P0 session as bearer. */
export async function proxyToAgent(request: NextRequest, segments: string[]) {
  const path = segments.join('/');
  if (!RESOURCE.test(path)) return agentError(404, 'bad_path', '알 수 없는 요청 경로야.');
  const method = request.method.toUpperCase();
  if (!['GET', 'POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) return agentError(405, 'bad_path', '허용되지 않는 요청이야.');
  if (method !== 'GET') {
    const originError = sameOriginMutationError(request);
    if (originError) return originError;
  }
  const token = request.cookies.get(P0_APP_SESSION_COOKIE)?.value || '';
  if (!token) return agentError(401, 'auth_required', '로그인이 필요해.');

  let base: URL | null;
  try {
    base = agentBaseUrl();
  } catch (error) {
    return agentError(503, 'agent_unconfigured', error instanceof Error ? error.message : 'MTOS agent URL is invalid');
  }
  if (!base) return agentError(503, 'agent_unconfigured', 'AI·연구 데이터 서버(MTOS_AGENT_URL)가 설정되지 않았어.');

  const url = new URL(`/agent/api/${path}`, base);
  for (const key of FORWARDED_QUERY) {
    const value = request.nextUrl.searchParams.get(key);
    if (value !== null) url.searchParams.set(key, value.slice(0, 300));
  }
  const headers = new Headers({ accept: 'application/json', authorization: `Bearer ${token}` });
  let body: Uint8Array | undefined;
  if (method !== 'GET' && method !== 'DELETE') {
    try {
      body = await readRequestBytesLimited(request, MAX_BODY);
    } catch (error) {
      const status = error instanceof P0ApiError ? error.status : 400;
      return noStore(NextResponse.json({ error: error instanceof Error ? error.message : '요청 본문을 읽지 못했어.' }, { status }));
    }
    headers.set('content-type', 'application/json');
  }
  let response: Response;
  try {
    response = await serviceFetch(url, { method, headers, body: body as BodyInit | undefined }, 'AI·연구 데이터 서버에 연결할 수 없어.');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'AI·연구 데이터 서버에 연결할 수 없어.';
    return agentError(503, message.includes('authentication is not configured') ? 'agent_unconfigured' : 'agent_unreachable', message);
  }
  const payload: unknown = await response.json().catch(() => ({ error: '서버 응답을 읽지 못했어.' }));
  return noStore(NextResponse.json(payload, { status: response.status === 500 ? 502 : response.status }));
}
