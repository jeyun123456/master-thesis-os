import { NextResponse, type NextRequest } from 'next/server';

export const P0_SESSION_COOKIE = 'mtos_p0_session';
export const P0_APP_SESSION_COOKIE = 'mtos_app_session';
export const P0_SESSION_MAX_AGE = 30 * 24 * 60 * 60;
const DEFAULT_P0_URL = 'http://127.0.0.1:8787';

type P0RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  token?: string;
  body?: unknown;
};

type P0FetchOptions = Pick<RequestInit, 'method' | 'headers' | 'body'>;

export class P0ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'P0ApiError';
  }
}

function expectedP0MutationOrigin(request: NextRequest): string | null {
  const configuredOrigin = process.env.MTOS_PUBLIC_ORIGIN?.trim();
  if (configuredOrigin) {
    try {
      const url = new URL(configuredOrigin);
      const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
      const loopback = hostname === 'localhost' || hostname === '::1' || /^127(?:\.\d{1,3}){3}$/.test(hostname);
      if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))
        || url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) return null;
      return url.origin;
    } catch {
      return null;
    }
  }
  if (process.env.NODE_ENV === 'production') return null;
  const host = request.headers.get('host') || request.nextUrl.host;
  try {
    return new URL(`${request.nextUrl.protocol}//${host}`).origin;
  } catch {
    return null;
  }
}

export function sameOriginMutationError(request: NextRequest) {
  const origin = request.headers.get('origin');
  const fetchSite = request.headers.get('sec-fetch-site')?.toLowerCase();
  const expectedOrigin = expectedP0MutationOrigin(request);
  if (!expectedOrigin
    || (origin !== null && origin !== expectedOrigin)
    || (origin === null && fetchSite !== 'same-origin')
    || (fetchSite && fetchSite !== 'same-origin')) {
    return noStore(NextResponse.json({ error: '다른 출처의 변경 요청은 허용하지 않아.' }, { status: 403 }));
  }
  return null;
}

export async function readRequestBytesLimited(request: Request, maxBytes: number) {
  const contentLength = request.headers.get('content-length');
  if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > maxBytes) {
    throw new P0ApiError(413, '요청 본문이 너무 커.');
  }
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new P0ApiError(413, '요청 본문이 너무 커.');
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof P0ApiError) throw error;
    throw new P0ApiError(400, '요청 본문을 읽지 못했어.');
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function readJsonLimited(request: Request, maxBytes: number) {
  const bytes = await readRequestBytesLimited(request, maxBytes);
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  } catch (error) {
    if (error instanceof P0ApiError) throw error;
    throw new P0ApiError(400, '요청 본문은 유효한 JSON이어야 해.');
  }
}

function p0BaseUrl() {
  const raw = process.env.P0_API_URL?.trim() || DEFAULT_P0_URL;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new P0ApiError(503, 'P0 API URL is invalid');
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const loopback = isLoopbackHost(host);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) || url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
    throw new P0ApiError(503, 'P0 API must use HTTPS or a loopback HTTP URL');
  }
  return url;
}

function isLoopbackHost(hostname: string) {
  return hostname === 'localhost' || hostname === '::1' || /^127(?:\.\d{1,3}){3}$/.test(hostname);
}

export function p0UpstreamUrl(path: string) {
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\') || path.split('/').includes('..')) {
    throw new P0ApiError(500, 'Invalid internal P0 path');
  }
  return new URL(path, p0BaseUrl());
}

export async function p0Fetch(path: string, options: P0FetchOptions = {}) {
  const url = p0UpstreamUrl(path);
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const loopback = isLoopbackHost(hostname);
  const accessClientId = process.env.P0_ACCESS_CLIENT_ID?.trim() || '';
  const accessClientSecret = process.env.P0_ACCESS_CLIENT_SECRET?.trim() || '';
  if (Boolean(accessClientId) !== Boolean(accessClientSecret)) {
    throw new P0ApiError(503, 'P0 Access service credentials are incomplete');
  }
  const headers = new Headers(options.headers);
  headers.delete('CF-Access-Client-Id');
  headers.delete('CF-Access-Client-Secret');
  if (!loopback) {
    if (url.protocol !== 'https:' || !accessClientId || !accessClientSecret) {
      throw new P0ApiError(503, 'P0 server access authentication is not configured');
    }
    headers.set('CF-Access-Client-Id', accessClientId);
    headers.set('CF-Access-Client-Secret', accessClientSecret);
  }
  try {
    return await fetch(url, {
      ...options,
      headers,
      cache: 'no-store',
      redirect: 'error',
    });
  } catch {
    throw new P0ApiError(503, 'P0 서버에 연결할 수 없어. P0 서버 상태와 접근 인증 설정을 확인해줘.');
  }
}

export async function p0Request<T>(path: string, options: P0RequestOptions = {}): Promise<T> {
  if (!path.startsWith('/api/') || path.startsWith('//')) throw new P0ApiError(500, 'Invalid internal P0 path');
  const headers = new Headers({ accept: 'application/json' });
  if (options.body !== undefined) headers.set('content-type', 'application/json');
  if (options.token) headers.set('authorization', `Bearer ${options.token}`);
  const response = await p0Fetch(path, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const payload: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = isRecord(payload) && typeof payload.error === 'string' ? payload.error : `P0 request failed (${response.status})`;
    throw new P0ApiError(response.status === 500 ? 502 : response.status, message);
  }
  return payload as T;
}

export function p0SessionToken(request: NextRequest) {
  return request.cookies.get(P0_SESSION_COOKIE)?.value || '';
}

export async function requireP0Session(request: NextRequest) {
  const token = request.cookies.get(P0_APP_SESSION_COOKIE)?.value || '';
  if (!token) return noStore(NextResponse.json({ error: 'P0 로그인이 필요해.' }, { status: 401 }));
  try {
    await p0Request('/api/tasks', { token });
    return null;
  } catch (error) {
    return p0AuthenticatedErrorResponse(error, 'P0 세션을 확인하지 못했어.');
  }
}

export function p0ErrorResponse(error: unknown, fallback = 'P0 요청을 처리하지 못했어.') {
  const status = error instanceof P0ApiError ? error.status : 503;
  const message = error instanceof P0ApiError ? error.message : fallback;
  return noStore(NextResponse.json({ error: message }, { status }));
}

export function p0AuthenticatedErrorResponse(error: unknown, fallback = 'P0 요청을 처리하지 못했어.') {
  const response = p0ErrorResponse(error, fallback);
  return error instanceof P0ApiError && error.status === 401 ? clearP0SessionCookie(response) : response;
}

export function noStore<T extends NextResponse>(response: T): T {
  response.headers.set('cache-control', 'no-store');
  return response;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function setP0AppSessionCookie(response: NextResponse, token: string) {
  response.cookies.set(P0_APP_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: P0_SESSION_MAX_AGE,
  });
  return noStore(response);
}

export function setP0SessionCookie(response: NextResponse, token: string) {
  response.cookies.set(P0_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/api/p0',
    maxAge: P0_SESSION_MAX_AGE,
  });
  return setP0AppSessionCookie(response, token);
}

export function clearP0SessionCookie(response: NextResponse) {
  for (const [name, path] of [[P0_SESSION_COOKIE, '/api/p0'], [P0_APP_SESSION_COOKIE, '/']] as const) {
    response.cookies.set(name, '', {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      path,
      maxAge: 0,
    });
  }
  return noStore(response);
}
