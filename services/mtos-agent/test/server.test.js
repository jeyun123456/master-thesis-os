import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, test } from 'node:test';
import { AuthError, createSessionVerifier } from '../src/auth.js';
import { createAgentApp } from '../src/server.js';
import { freshDb } from './helpers.js';

const TOKEN = 'valid-session-token-0123456789';
let server;
let base;

before(async () => {
  const verifySession = async (token) => { if (token !== TOKEN) throw new AuthError('invalid session'); };
  server = createServer(createAgentApp({ db: freshDb(), verifySession, codexInfo: () => null }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}/agent/api`;
});
after(() => server.close());

const call = async (path, { method = 'GET', body, token = TOKEN } = {}) => {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, data: await response.json() };
};

test('health is public; everything else requires a P0 session', async () => {
  assert.equal((await call('/health', { token: null })).status, 200);
  assert.equal((await call('/memos', { token: null })).status, 401);
  assert.equal((await call('/memos', { token: 'wrong-token-wrong-token-wrong' })).status, 401);
});

test('capture saves the raw text and queues a classify job', async () => {
  const { status, data } = await call('/inbox', { method: 'POST', body: { text: '세미나 자료 준비', capture_id: 'cap-1' } });
  assert.equal(status, 201);
  assert.equal(data.item.state, 'new');
  const jobs = (await call('/jobs')).data.jobs;
  assert.ok(jobs.some((j) => j.type === 'classify_inbox' && j.input.item_id === data.item.id && j.priority === 0));
});

test('validation and conflicts map to 400 and 409', async () => {
  assert.equal((await call('/milestones', { method: 'POST', body: { project_id: 'thesis', title: 'x', date: '2026/11/01', kind: 'internal' } })).status, 400);
  const created = await call('/milestones', { method: 'POST', body: { project_id: 'thesis', title: '심사', date: '2027-01-20', kind: 'official', source: '학사 공지' } });
  const patch = await call(`/milestones/${created.data.milestone.id}`, { method: 'PATCH', body: { base_version: 1, changes: { date: '2027-01-21' } } });
  assert.equal(patch.status, 409);
});

test('only allowed job types and well-formed inputs can be requested', async () => {
  assert.equal((await call('/jobs', { method: 'POST', body: { type: 'shell', input: {} } })).status, 400);
  assert.equal((await call('/jobs', { method: 'POST', body: { type: 'obsidian_merge', input: { path: '../secret.md', memo_id: 'm', memo_text: 'x', mode: 'append' } } })).status, 400);
  const ok = await call('/jobs', { method: 'POST', body: { type: 'decompose_task', input: { task: { id: 't1', title: '큰 일' } }, dedupe_key: 'decompose:t1:1' } });
  assert.equal(ok.status, 201);
});

test('status reports the worker and queue state', async () => {
  const { data } = await call('/status');
  assert.equal(data.worker.codex_found, false);
  assert.equal(typeof data.queue, 'object');
});

test('session verifier only talks to loopback P0 and caches successes', async () => {
  assert.throws(() => createSessionVerifier({ p0Url: 'https://p0.example.com' }), /loopback/);
  let calls = 0;
  const verify = createSessionVerifier({ fetchImpl: async () => { calls += 1; return { ok: calls === 1 }; } });
  await verify(TOKEN);
  await verify(TOKEN);
  assert.equal(calls, 1);
  await assert.rejects(verify('another-token-another-token-x'), /invalid session/);
});
