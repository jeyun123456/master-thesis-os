import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { proxyToAgent } from './agent-server';

const ORIGIN = 'http://localhost:3000';

function request(path: string, init: { method?: string; body?: unknown; origin?: string | null; cookie?: string | null } = {}) {
  const headers = new Headers();
  if (init.cookie !== null) headers.set('cookie', `mtos_app_session=${init.cookie ?? 'session-token'}`);
  if (init.origin !== null && init.method && init.method !== 'GET') headers.set('origin', init.origin ?? ORIGIN);
  if (init.body !== undefined) headers.set('content-type', 'application/json');
  return new NextRequest(`${ORIGIN}/api/mtos/${path}`, { method: init.method ?? 'GET', headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
}

describe('proxyToAgent', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('MTOS_PUBLIC_ORIGIN', ORIGIN);
    fetchMock.mockResolvedValue(Response.json({ ok: true }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    fetchMock.mockReset();
  });

  it('forwards the session as a bearer to the loopback agent with allowed query keys only', async () => {
    const response = await proxyToAgent(request('memos?project_id=thesis&evil=1'), ['memos']);
    expect(response.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('http://127.0.0.1:8789/agent/api/memos?project_id=thesis');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer session-token');
  });

  it('forwards school mail/notice reads with paging query keys and still needs a session', async () => {
    const ok = await proxyToAgent(request('school/mails?limit=20&offset=0&evil=1'), ['school', 'mails']);
    expect(ok.status).toBe(200);
    expect(String(fetchMock.mock.calls[0][0])).toBe('http://127.0.0.1:8789/agent/api/school/mails?limit=20&offset=0');
    expect((await proxyToAgent(request('school/mails', { cookie: null }), ['school', 'mails'])).status).toBe(401);
  });

  it('adds the server-side ops admin secret only to ops requests and needs a session', async () => {
    vi.stubEnv('MTOS_OPS_ADMIN_SECRET', 'ops-secret-value');
    expect((await proxyToAgent(request('ops/trend?range=24h&evil=1'), ['ops', 'trend'])).status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('http://127.0.0.1:8789/agent/api/ops/trend?range=24h');
    expect(new Headers(init.headers).get('x-ops-admin')).toBe('ops-secret-value');
    await proxyToAgent(request('memos'), ['memos']);
    expect(new Headers(fetchMock.mock.calls[1][1].headers).get('x-ops-admin')).toBeNull();
    expect((await proxyToAgent(request('ops/overview', { cookie: null }), ['ops', 'overview'])).status).toBe(401);
  });

  it('rejects unknown resources and deep paths', async () => {
    expect((await proxyToAgent(request('admin'), ['admin'])).status).toBe(404);
    expect((await proxyToAgent(request('memos/a/b/c'), ['memos', 'a', 'b', 'c'])).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requires a session and a same-origin request for writes', async () => {
    expect((await proxyToAgent(request('memos', { cookie: null }), ['memos'])).status).toBe(401);
    expect((await proxyToAgent(request('memos', { method: 'POST', body: {}, origin: 'https://evil.example' }), ['memos'])).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports a missing production URL as configuration, not as empty data', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const response = await proxyToAgent(request('memos'), ['memos']);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: 'agent_unconfigured' });
  });

  it('reports an unreachable agent distinctly', async () => {
    fetchMock.mockRejectedValue(new TypeError('connect ECONNREFUSED'));
    const response = await proxyToAgent(request('status'), ['status']);
    expect(await response.json()).toMatchObject({ code: 'agent_unreachable' });
  });
});
