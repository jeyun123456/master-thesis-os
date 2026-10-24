import { NextResponse, type NextRequest } from 'next/server';
import { p0ErrorResponse, p0Fetch, readRequestBytesLimited, sameOriginMutationError } from '../../../../../lib/p0-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NATIVE_SESSION_COOKIE = 'mtos_p0_native_session';
const NATIVE_SESSION_MAX_AGE = 30 * 24 * 60 * 60;
const NATIVE_SESSION_SENTINEL = 'mtos-native-cookie-v1';

type RouteContext = { params: Promise<{ path?: string[] }> };

const STATIC_FILES = new Set(['index.html', 'app.js', 'home.js', 'sync-client.js', 'sw.js', 'manifest.webmanifest']);
const TASK_ID = '[\\w-]+';
const API_ROUTES: Array<{ method: string; pattern: RegExp }> = [
  { method: 'GET', pattern: /^\/api\/(?:health|config|tasks|conflicts|sessions)$/ },
  { method: 'POST', pattern: /^\/api\/(?:auth\/google|auth\/logout|tasks)$/ },
  { method: 'PATCH', pattern: new RegExp(`^/api/tasks/${TASK_ID}$`) },
  { method: 'DELETE', pattern: new RegExp(`^/api/(?:tasks|sessions)/${TASK_ID}$`) },
  { method: 'GET', pattern: new RegExp(`^/api/tasks/${TASK_ID}/revisions$`) },
  { method: 'POST', pattern: /^\/api\/conflicts\/\d+\/resolve$/ },
];

function jsonError(status: number, message: string) {
  return NextResponse.json({ error: message }, { status, headers: { 'cache-control': 'no-store' } });
}

function setNativeSessionCookie(response: NextResponse, token: string) {
  response.cookies.set(NATIVE_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/api/p0/native',
    maxAge: NATIVE_SESSION_MAX_AGE,
  });
  response.headers.set('cache-control', 'no-store');
  return response;
}

function clearNativeSessionCookie(response: NextResponse) {
  response.cookies.set(NATIVE_SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/api/p0/native',
    maxAge: 0,
  });
  response.headers.set('cache-control', 'no-store');
  return response;
}

async function proxy(request: NextRequest, context: RouteContext) {
  const segments = (await context.params).path ?? [];
  if (segments.some((segment) => !segment || segment === '.' || segment === '..' || segment.includes('\\'))) {
    return jsonError(404, 'not found');
  }
  const path = segments.length ? `/${segments.join('/')}` : '/';
  const method = request.method;
  const isStatic = method === 'GET' && (path === '/' || STATIC_FILES.has(path.slice(1)));
  const isApi = API_ROUTES.some((route) => route.method === method && route.pattern.test(path));
  if (!isStatic && !isApi) return jsonError(404, 'not found');
  if (isApi && method !== 'GET') {
    const originError = sameOriginMutationError(request);
    if (originError) return originError;
  }
  const nativeToken = request.cookies.get(NATIVE_SESSION_COOKIE)?.value ?? '';

  let body: ArrayBuffer | undefined;
  if (!['GET', 'HEAD'].includes(method)) {
    try {
      const bytes = await readRequestBytesLimited(request, 256 * 1024);
      body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    } catch (error) {
      return p0ErrorResponse(error, '요청 본문을 읽지 못했어.');
    }
  }

  const headers = new Headers({ accept: isStatic ? '*/*' : 'application/json' });
  for (const name of ['content-type', 'idempotency-key']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  if (isApi && nativeToken && !['/api/health', '/api/config', '/api/auth/google'].includes(path)) {
    headers.set('authorization', `Bearer ${nativeToken}`);
  }
  const upstreamPath = `${path === '/' ? '/' : path}${request.nextUrl.search}`;
  let upstream: Response;
  try {
    upstream = await p0Fetch(upstreamPath, {
      method,
      headers,
      body,
    });
  } catch (error) {
    const response = p0ErrorResponse(error, 'P0 서버에 연결할 수 없어. P0 서버 상태와 접근 인증 설정을 확인해줘.');
    return path === '/api/auth/logout' && method === 'POST' ? clearNativeSessionCookie(response) : response;
  }

  if (path === '/api/auth/google' && method === 'POST') {
    const payload: unknown = await upstream.json().catch(() => null);
    if (!upstream.ok) {
      const message = typeof payload === 'object' && payload !== null && 'error' in payload && typeof payload.error === 'string'
        ? payload.error
        : 'P0 로그인에 실패했어.';
      return jsonError(upstream.status, message);
    }
    if (typeof payload !== 'object' || payload === null || !('token' in payload) || typeof payload.token !== 'string' || !payload.token) {
      return jsonError(502, 'P0 로그인 응답에 세션이 없어.');
    }
    const response = NextResponse.json({
      token: NATIVE_SESSION_SENTINEL,
      session_id: 'session_id' in payload && typeof payload.session_id === 'string' ? payload.session_id : null,
    }, { status: upstream.status, headers: { 'cache-control': 'no-store' } });
    return setNativeSessionCookie(response, payload.token);
  }

  let responseBody: string | ArrayBuffer;
  if ((path === '/' || path === '/index.html') && isStatic && upstream.ok) {
    const html = await upstream.text();
    const rewritten = html.replace(
      '<meta name="viewport"',
      `<base href="/api/p0/native/"><script>window.MTOS_API="/api/p0/native";try{if(localStorage.getItem('mtos.session')!=='${NATIVE_SESSION_SENTINEL}')localStorage.removeItem('mtos.session')}catch{}</script>\n<meta name="viewport"`,
    );
    if (rewritten === html) return jsonError(502, 'P0 UI shell could not be safely mounted.');
    responseBody = rewritten;
  } else if (path === '/sw.js' && isStatic && upstream.ok) {
    const worker = await upstream.text();
    const cacheScoped = worker.replace("const CACHE = 'mtos-p0-v1';", "const CACHE = 'mtos-p0-native-v1';")
      .replace("ks.filter((k) => k !== CACHE)", "ks.filter((k) => k.startsWith('mtos-p0-native-') && k !== CACHE)")
      .replace("url.pathname.startsWith('/api/')", "url.pathname.startsWith(new URL('./api/', self.registration.scope).pathname)")
      .replace("caches.match(e.request).then((r) => r ?? caches.match('index.html'))", "caches.open(CACHE).then((c) => c.match(e.request).then((r) => r ?? c.match(new URL('./index.html', self.registration.scope).href)))");
    if (cacheScoped === worker
      || !cacheScoped.includes("k.startsWith('mtos-p0-native-')")
      || !cacheScoped.includes("url.pathname.startsWith(new URL('./api/', self.registration.scope).pathname)")
      || cacheScoped.includes("url.pathname.startsWith('/api/')")
      || !cacheScoped.includes('caches.open(CACHE)')
      || cacheScoped.includes('caches.match(')) {
      return jsonError(502, 'P0 service worker could not be safely scoped.');
    }
    responseBody = cacheScoped;
  } else {
    responseBody = await upstream.arrayBuffer();
  }
  const isHtml = path === '/' || path === '/index.html';
  const response = new NextResponse(responseBody, {
    status: upstream.status,
    headers: {
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      ...(isHtml ? {
        'content-security-policy': "frame-ancestors 'self'",
        'x-frame-options': 'SAMEORIGIN',
      } : {}),
      ...(upstream.headers.get('content-type') ? { 'content-type': upstream.headers.get('content-type')! } : {}),
    },
  });
  if ((path === '/api/auth/logout' && method === 'POST') || (nativeToken && upstream.status === 401)) {
    return clearNativeSessionCookie(response);
  }
  return response;
}

export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
