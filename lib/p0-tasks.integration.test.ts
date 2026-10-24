import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { DELETE as sessionDelete, GET as sessionGet, POST as sessionPost } from '../app/api/p0/session/route';
import { GET as tasksGet, POST as tasksPost } from '../app/api/p0/tasks/route';
import { PATCH as taskPatch } from '../app/api/p0/tasks/[id]/route';
import { GET as nativeProxyGet, POST as nativeProxyPost } from '../app/api/p0/native/[[...path]]/route';
import { P0_SESSION_COOKIE } from './p0-server';
// @ts-expect-error The sibling P0 repository's JS harness is intentionally used only for local integration tests.
import { idToken, startServer } from '../../master-thesis-os-p0/tools/master-thesis-os-p0/test/helpers.js';

const appUrl = 'http://localhost';
let p0: Awaited<ReturnType<typeof startServer>> | undefined;
let previousP0Url: string | undefined;

function request(path: string, cookie?: string, init: { method?: string; headers?: HeadersInit; body?: string } = {}) {
  const headers = new Headers(init.headers);
  const method = init.method?.toUpperCase() ?? 'GET';
  if (!['GET', 'HEAD'].includes(method) && !headers.has('origin') && !headers.has('sec-fetch-site')) headers.set('origin', appUrl);
  if (cookie) headers.set('cookie', cookie);
  return new NextRequest(new URL(path, appUrl), { ...init, headers });
}

function cookieFrom(response: Response) {
  const value = response.headers.get('set-cookie')?.split(';', 1)[0];
  if (!value) throw new Error('P0 session cookie was not set');
  return value;
}

beforeEach(async () => {
  previousP0Url = process.env.P0_API_URL;
  p0 = await startServer();
  process.env.P0_API_URL = p0.base;
});

afterEach(async () => {
  if (p0) await p0.close();
  p0 = undefined;
  if (previousP0Url === undefined) delete process.env.P0_API_URL;
  else process.env.P0_API_URL = previousP0Url;
});

describe('Next.js P0 proxy integration', () => {
  it('authenticates through the test harness and persists create, edit, complete, and reload in SQLite', async () => {
    const status = await sessionGet(request('/api/p0/session'));
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({ configured: true, authenticated: false, googleClientId: 'test-client.apps.googleusercontent.com' });

    const loggedIn = await sessionPost(request('/api/p0/session', undefined, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id_token: idToken() }),
    }));
    expect(loggedIn.status).toBe(200);
    expect(await loggedIn.json()).toEqual({ authenticated: true });
    const cookie = cookieFrom(loggedIn);
    expect(cookie.startsWith(`${P0_SESSION_COOKIE}=`)).toBe(true);
    expect(loggedIn.headers.get('set-cookie')).toContain('HttpOnly');
    expect(loggedIn.headers.get('set-cookie')).toContain('SameSite=strict');

    const payload = {
      id: 'p0-web-task-1',
      op_id: 'p0-web-create-1',
      fields: { title: 'P0 연결 테스트', category: 'school', due_date: '2026-10-25', status: 'open', is_today: false },
    };
    const created = await tasksPost(request('/api/p0/tasks', cookie, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
    }));
    expect(created.status).toBe(201);
    const createdData = await created.json();
    expect(createdData.task.title).toBe('P0 연결 테스트');
    expect(createdData.task.version).toBe(1);

    const duplicate = await tasksPost(request('/api/p0/tasks', cookie, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...payload, id: 'p0-web-task-duplicate' }),
    }));
    expect((await duplicate.json()).duplicate).toBe(true);
    expect(p0!.tasks.list()).toHaveLength(1);

    const firstRead = await tasksGet(request('/api/p0/tasks', cookie));
    expect((await firstRead.json()).tasks).toHaveLength(1);

    const renamed = await taskPatch(request(`/api/p0/tasks/${createdData.task.id}`, cookie, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ base_version: 1, op_id: 'p0-web-title-1', changes: { title: '수정된 P0 할 일' } }),
    }), { params: Promise.resolve({ id: createdData.task.id }) });
    expect(renamed.status).toBe(200);
    const renamedData = await renamed.json();
    expect(renamedData.task.title).toBe('수정된 P0 할 일');
    expect(renamedData.task.version).toBe(2);

    const completed = await taskPatch(request(`/api/p0/tasks/${createdData.task.id}`, cookie, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ base_version: 2, op_id: 'p0-web-done-1', changes: { status: 'done' } }),
    }), { params: Promise.resolve({ id: createdData.task.id }) });
    expect((await completed.json()).task.status).toBe('done');

    // A fresh API request stands in for a browser refresh; SQLite remains authoritative.
    const afterReload = await tasksGet(request('/api/p0/tasks', cookie));
    const data = await afterReload.json();
    expect(data.tasks[0]).toMatchObject({ id: createdData.task.id, title: '수정된 P0 할 일', status: 'done', due_date: '2026-10-25', category: 'school' });
    expect(p0!.db.prepare('SELECT title, status FROM tasks WHERE id = ?').get(createdData.task.id)).toEqual({ title: '수정된 P0 할 일', status: 'done' });

    const crossOriginLogout = await sessionDelete(request('/api/p0/session', cookie, {
      method: 'DELETE', headers: { origin: 'https://attacker.example' },
    }));
    expect(crossOriginLogout.status).toBe(403);
    expect((await tasksGet(request('/api/p0/tasks', cookie))).status).toBe(200);

    const loggedOut = await sessionDelete(request('/api/p0/session', cookie, { method: 'DELETE' }));
    expect(await loggedOut.json()).toEqual({ authenticated: false, serverRevoked: true });
    expect(loggedOut.headers.get('set-cookie')).toContain('Max-Age=0');
    expect((await tasksGet(request('/api/p0/tasks', cookie))).status).toBe(401);
  });

  it('keeps the embedded P0 UI same-origin and scopes its service-worker cache cleanup', async () => {
    const shell = await nativeProxyGet(request('/api/p0/native/'), { params: Promise.resolve({}) });
    expect(shell.status).toBe(200);
    expect(shell.headers.get('content-security-policy')).toBe("frame-ancestors 'self'");
    expect(shell.headers.get('x-frame-options')).toBe('SAMEORIGIN');
    expect(await shell.text()).toContain('<base href="/api/p0/native/">');

    const worker = await nativeProxyGet(request('/api/p0/native/sw.js'), { params: Promise.resolve({ path: ['sw.js'] }) });
    const script = await worker.text();
    expect(worker.status).toBe(200);
    expect(script).toContain("const CACHE = 'mtos-p0-native-v1';");
    expect(script).toContain("ks.filter((k) => k.startsWith('mtos-p0-native-') && k !== CACHE)");
    expect(script).toContain("url.pathname.startsWith(new URL('./api/', self.registration.scope).pathname)");
    expect(script).not.toContain("url.pathname.startsWith('/api/')");
    expect(script).toContain('caches.open(CACHE)');
    expect(script).not.toContain('caches.match(');
    expect(script).not.toContain('ks.filter((k) => k !== CACHE)');
  });

  it('clears a stale session cookie after revocation or expiry', async () => {
    const staleCookie = `${P0_SESSION_COOKIE}=invalid-token`;
    const session = await sessionGet(request('/api/p0/session', staleCookie));
    expect(await session.json()).toMatchObject({ authenticated: false });
    expect(session.headers.get('set-cookie')).toContain('Max-Age=0');

    const tasks = await tasksGet(request('/api/p0/tasks', staleCookie));
    expect(tasks.status).toBe(401);
    expect(tasks.headers.get('set-cookie')).toContain('Max-Age=0');
  });

  it('rejects cross-origin writes and oversized bodies before they reach P0', async () => {
    const foreignLogin = await sessionPost(request('/api/p0/session', undefined, {
      method: 'POST', headers: { origin: 'https://attacker.example', 'content-type': 'application/json' },
      body: JSON.stringify({ id_token: idToken() }),
    }));
    expect(foreignLogin.status).toBe(403);

    const missingMetadataLogin = await sessionPost(new NextRequest(new URL('/api/p0/session', appUrl), {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id_token: idToken() }),
    }));
    expect(missingMetadataLogin.status).toBe(403);

    const spoofedForwardedOrigin = await sessionPost(new NextRequest(new URL('/api/p0/session', appUrl), {
      method: 'POST', headers: {
        origin: 'https://attacker.example',
        'x-forwarded-host': 'attacker.example',
        'x-forwarded-proto': 'https',
        'content-type': 'application/json',
      }, body: JSON.stringify({ id_token: idToken() }),
    }));
    expect(spoofedForwardedOrigin.status).toBe(403);

    const crossSiteLogin = await sessionPost(request('/api/p0/session', undefined, {
      method: 'POST', headers: { 'sec-fetch-site': 'cross-site', 'content-type': 'application/json' },
      body: JSON.stringify({ id_token: idToken() }),
    }));
    expect(crossSiteLogin.status).toBe(403);

    const oversizedLogin = await sessionPost(request('/api/p0/session', undefined, {
      method: 'POST', headers: { origin: appUrl, 'content-type': 'application/json' }, body: `"${'x'.repeat(16 * 1024)}"`,
    }));
    expect(oversizedLogin.status).toBe(413);

    const nativePath = { params: Promise.resolve({ path: ['api', 'auth', 'google'] }) };
    const foreignNativeLogin = await nativeProxyPost(request('/api/p0/native/api/auth/google', undefined, {
      method: 'POST', headers: { origin: 'https://attacker.example', 'content-type': 'application/json' },
      body: JSON.stringify({ id_token: idToken() }),
    }), nativePath);
    expect(foreignNativeLogin.status).toBe(403);

    const oversizedNativeBody = await nativeProxyPost(request('/api/p0/native/api/auth/google', undefined, {
      method: 'POST', headers: { origin: appUrl, 'content-type': 'application/json' }, body: 'x'.repeat(256 * 1024 + 1),
    }), nativePath);
    expect(oversizedNativeBody.status).toBe(413);
    expect(p0!.tasks.list()).toHaveLength(0);
  });

  it('clears the browser cookie and returns unconfirmed server revocation when upstream is down', async () => {
    const loggedIn = await sessionPost(request('/api/p0/session', undefined, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id_token: idToken() }),
    }));
    const cookie = cookieFrom(loggedIn);
    process.env.P0_API_URL = 'http://127.0.0.1:1';
    const response = await sessionDelete(request('/api/p0/session', cookie, { method: 'DELETE' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ authenticated: false, serverRevoked: false });
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
  });

  it('returns a safe unavailable response when the P0 server is down', async () => {
    const loggedIn = await sessionPost(request('/api/p0/session', undefined, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id_token: idToken() }),
    }));
    const cookie = cookieFrom(loggedIn);
    process.env.P0_API_URL = 'http://127.0.0.1:1';
    const response = await tasksGet(request('/api/p0/tasks', cookie));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'P0 서버에 연결할 수 없어. 로컬 P0 서버 상태를 확인해줘.' });
  });
});
