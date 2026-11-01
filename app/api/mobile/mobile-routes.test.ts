import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const p0Request = vi.fn();

vi.mock('../../../lib/p0-server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/p0-server')>()),
  p0Request: (...args: unknown[]) => p0Request(...args),
}));
vi.mock('../../../lib/calendar', () => ({ calendarConfigured: () => false, getCalendarEvents: vi.fn() }));

import { P0ApiError } from '../../../lib/p0-server';
import { POST as login } from './auth/google/route';
import { POST as logout } from './auth/logout/route';
import { GET as widget } from './widget/route';
import { PATCH, POST as taskPost } from './tasks/[id]/route';

const TOKEN = 'session-token-123';
const idToken = 'x'.repeat(40);

function req(url: string, init: { method?: string; token?: string | null; body?: unknown; raw?: string; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json', ...init.headers };
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  return new NextRequest(`https://app.test${url}`, {
    method: init.method ?? 'POST',
    headers,
    body: init.raw ?? (init.body === undefined ? undefined : JSON.stringify(init.body)),
  });
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const done = { base_version: 3, op_id: 'android-complete-abc', changes: { status: 'done' } };

beforeEach(() => p0Request.mockReset());

describe('POST /api/mobile/auth/google', () => {
  it('rejects missing, short and oversized id tokens without calling P0', async () => {
    for (const body of [{}, { id_token: 'short' }, { id_token: 'x'.repeat(12001) }, { id_token: 5 }]) {
      expect((await login(req('/api/mobile/auth/google', { body }))).status).toBe(400);
    }
    expect((await login(req('/api/mobile/auth/google', { raw: '{not json' }))).status).toBe(400);
    expect((await login(req('/api/mobile/auth/google', { raw: JSON.stringify({ id_token: 'x'.repeat(20000) }) }))).status).toBe(413);
    expect(p0Request).not.toHaveBeenCalled();
  });

  it('returns the P0 session token with no-store and sanitises the device label', async () => {
    p0Request.mockResolvedValue({ token: 'tok-abcdefgh', session_id: 's1' });
    const res = await login(req('/api/mobile/auth/google', { body: { id_token: idToken, device_label: 'a\nb' } }));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ authenticated: true, token: 'tok-abcdefgh', sessionId: 's1' });
    expect(p0Request.mock.calls[0][1].body.device_label).toBe('a b');
  });

  it('fails when P0 rejects the account or returns no token', async () => {
    p0Request.mockRejectedValueOnce(new P0ApiError(403, '허용되지 않은 계정'));
    expect((await login(req('/api/mobile/auth/google', { body: { id_token: idToken } }))).status).toBe(403);
    p0Request.mockResolvedValueOnce({});
    expect((await login(req('/api/mobile/auth/google', { body: { id_token: idToken } }))).status).toBe(502);
  });
});

describe('GET /api/mobile/widget', () => {
  it('returns 401 without a Bearer token and never contacts P0', async () => {
    const res = await widget(req('/api/mobile/widget', { method: 'GET' }));
    expect(res.status).toBe(401);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(p0Request).not.toHaveBeenCalled();
  });

  it('ignores web cookies as credentials', async () => {
    const res = await widget(req('/api/mobile/widget', { method: 'GET', headers: { cookie: 'mtos_p0_session=abc12345678' } }));
    expect(res.status).toBe(401);
  });

  it('passes an expired session through as 401', async () => {
    p0Request.mockRejectedValueOnce(new P0ApiError(401, 'expired'));
    expect((await widget(req('/api/mobile/widget', { method: 'GET', token: TOKEN }))).status).toBe(401);
  });

  it('reports an unconfigured calendar separately from tasks', async () => {
    p0Request.mockResolvedValue({ tasks: [] });
    const body = await (await widget(req('/api/mobile/widget', { method: 'GET', token: TOKEN }))).json();
    expect(body.calendar.state).toBe('unconfigured');
    expect(body.tasks.state).toBe('empty');
  });
});

describe('PATCH /api/mobile/tasks/[id]', () => {
  const call = (id: string, init: Parameters<typeof req>[1]) => PATCH(req(`/api/mobile/tasks/${id}`, { method: 'PATCH', ...init }), ctx(id));

  it('requires a Bearer token', async () => {
    expect((await call('t1', { body: done })).status).toBe(401);
    expect(p0Request).not.toHaveBeenCalled();
  });

  it('rejects unsafe ids and bad bodies', async () => {
    expect((await call('a..b/c', { token: TOKEN, body: done })).status).toBe(400);
    const bad = [
      { ...done, base_version: 1.5 },
      { ...done, base_version: '3' },
      { ...done, op_id: 'bad id!' },
      { ...done, op_id: undefined },
      { ...done, changes: { status: 'open' } },
      { ...done, changes: { status: 'done', title: 'x' } },
      { ...done, changes: {} },
      [],
    ];
    for (const body of bad) expect((await call('t1', { token: TOKEN, body })).status).toBe(400);
    expect((await call('t1', { token: TOKEN, raw: 'nope' })).status).toBe(400);
    expect(p0Request).not.toHaveBeenCalled();
  });

  it('forwards only the whitelisted completion fields with the caller token', async () => {
    p0Request.mockResolvedValue({ task: { id: 't1', version: 4, status: 'done' } });
    const res = await call('t1', { token: TOKEN, body: { ...done, extra: 'drop' } });
    expect(res.status).toBe(200);
    expect(p0Request).toHaveBeenCalledWith('/api/tasks/t1', {
      method: 'PATCH', token: TOKEN, body: { base_version: 3, op_id: 'android-complete-abc', changes: { status: 'done' } },
    });
  });

  it('standardises a version conflict as 409', async () => {
    p0Request.mockRejectedValueOnce(new P0ApiError(409, 'version mismatch'));
    const res = await call('t1', { token: TOKEN, body: done });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ conflict: true, error: '다른 기기에서 변경됨' });
  });

  it('passes an expired session through as 401', async () => {
    p0Request.mockRejectedValueOnce(new P0ApiError(401, 'expired'));
    expect((await call('t1', { token: TOKEN, body: done })).status).toBe(401);
  });

  it('POST is only accepted with the PATCH override header', async () => {
    const plain = await taskPost(req('/api/mobile/tasks/t1', { token: TOKEN, body: done }), ctx('t1'));
    expect(plain.status).toBe(405);
    p0Request.mockResolvedValue({ task: {} });
    const ok = await taskPost(req('/api/mobile/tasks/t1', { token: TOKEN, body: done, headers: { 'x-http-method-override': 'PATCH' } }), ctx('t1'));
    expect(ok.status).toBe(200);
  });
});

describe('POST /api/mobile/auth/logout', () => {
  it('requires a Bearer token', async () => {
    expect((await logout(req('/api/mobile/auth/logout'))).status).toBe(401);
  });

  it('reports server revocation, and a failed revoke as 502 with serverRevoked=false', async () => {
    p0Request.mockResolvedValueOnce({});
    expect(await (await logout(req('/api/mobile/auth/logout', { token: TOKEN }))).json()).toEqual({ authenticated: false, serverRevoked: true });
    p0Request.mockRejectedValueOnce(new Error('down'));
    const res = await logout(req('/api/mobile/auth/logout', { token: TOKEN }));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ authenticated: false, serverRevoked: false });
  });
});
