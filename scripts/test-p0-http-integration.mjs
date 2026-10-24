import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { startServer, idToken } from '../../master-thesis-os-p0/tools/master-thesis-os-p0/test/helpers.js';

const root = new URL('../', import.meta.url);
const production = process.argv.includes('--production');
let p0;
let next;
let output = '';

async function availablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', (error) => error ? reject(error) : resolve()));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not reserve a local Next.js test port');
  await new Promise((resolve) => server.close(resolve));
  return address.port;
}

function recordOutput(chunk) {
  output = `${output}${chunk}`.slice(-5000);
}

async function waitForNext(baseUrl) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (next.exitCode !== null) throw new Error(`Next.js exited early (${next.exitCode}).\n${output}`);
    try {
      const response = await fetch(`${baseUrl}/api/p0/session`);
      if (response.status === 200) return;
    } catch { /* Next.js is still starting. */ }
    await delay(500);
  }
  throw new Error(`Next.js did not become ready.\n${output}`);
}

try {
  p0 = await startServer();
  const port = await availablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  next = spawn(process.execPath, ['node_modules/next/dist/bin/next', production ? 'start' : 'dev', '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd: root,
    env: { ...process.env, P0_API_URL: p0.base, MTOS_PUBLIC_ORIGIN: baseUrl },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  next.stdout.on('data', recordOutput);
  next.stderr.on('data', recordOutput);
  await waitForNext(baseUrl);

  const page = await fetch(baseUrl);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /오늘 집중할 일/);

  const nativeUi = await fetch(`${baseUrl}/api/p0/native/`);
  assert.equal(nativeUi.status, 200);
  assert.equal(nativeUi.headers.get('content-security-policy'), "frame-ancestors 'self'");
  assert.equal(nativeUi.headers.get('x-frame-options'), 'SAMEORIGIN');
  const nativeHtml = await nativeUi.text();
  assert.match(nativeHtml, /<base href="\/api\/p0\/native\/">/);
  assert.match(nativeHtml, /window\.MTOS_API="\/api\/p0\/native"/);
  assert.match(nativeHtml, /localStorage\.removeItem\('mtos\.session'\)/);
  const nativeClient = await fetch(`${baseUrl}/api/p0/native/app.js`);
  assert.equal(nativeClient.status, 200);
  assert.match(await nativeClient.text(), /SyncClient, indexedDbStorage/);
  const nativeSync = await fetch(`${baseUrl}/api/p0/native/sync-client.js`);
  assert.equal(nativeSync.status, 200);
  assert.match(await nativeSync.text(), /export class SyncClient/);
  const nativeWorker = await fetch(`${baseUrl}/api/p0/native/sw.js`);
  assert.equal(nativeWorker.status, 200);
  const serviceWorker = await nativeWorker.text();
  assert.match(serviceWorker, /const CACHE = 'mtos-p0-native-v1'/);
  assert.match(serviceWorker, /k\.startsWith\('mtos-p0-native-'\) && k !== CACHE/);
  assert.doesNotMatch(serviceWorker, /ks\.filter\(\(k\) => k !== CACHE\)/);
  assert.match(serviceWorker, /url\.pathname\.startsWith\(new URL\('\.\/api\/', self\.registration\.scope\)\.pathname\)/);
  assert.doesNotMatch(serviceWorker, /url\.pathname\.startsWith\('\/api\/'\)/);
  assert.match(serviceWorker, /caches\.open\(CACHE\)/);
  assert.doesNotMatch(serviceWorker, /caches\.match\(/);
  assert.equal((await fetch(`${baseUrl}/api/p0/native/api/tasks`)).status, 401);
  const blockedProxyPath = await fetch(`${baseUrl}/api/p0/native/api/env`);
  assert.equal(blockedProxyPath.status, 404);

  const status = await fetch(`${baseUrl}/api/p0/session`);
  assert.deepEqual(await status.json(), { configured: true, googleClientId: 'test-client.apps.googleusercontent.com', authenticated: false });

  const login = await fetch(`${baseUrl}/api/p0/session`, {
    method: 'POST', headers: { origin: baseUrl, 'content-type': 'application/json' }, body: JSON.stringify({ id_token: idToken() }),
  });
  assert.equal(login.status, 200, await login.clone().text());
  assert.deepEqual(await login.json(), { authenticated: true });
  const setCookie = login.headers.get('set-cookie') || '';
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=strict/i);
  if (production) assert.match(setCookie, /Secure/i);
  const cookie = setCookie.split(';', 1)[0];
  const headers = { cookie, origin: baseUrl, 'content-type': 'application/json' };
  const endpoint = `${baseUrl}/api/p0/tasks`;

  const payload = {
    id: 'http-e2e-task-1',
    op_id: 'http-e2e-create-1',
    fields: { title: 'HTTP 통합 할 일', status: 'open', category: 'research', due_date: '2026-10-25', is_today: true },
  };
  const crossOriginCreate = await fetch(endpoint, {
    method: 'POST', headers: { ...headers, origin: 'https://attacker.example' }, body: JSON.stringify(payload),
  });
  assert.equal(crossOriginCreate.status, 403);
  assert.equal(p0.tasks.list().length, 0);
  const created = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(payload) });
  assert.equal(created.status, 201);
  const createdData = await created.json();
  assert.equal(createdData.task.title, 'HTTP 통합 할 일');

  const duplicate = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify({ ...payload, id: 'http-e2e-task-duplicate' }) });
  assert.equal((await duplicate.json()).duplicate, true);
  assert.equal(p0.tasks.list().length, 1);

  const crossOriginNativeLogin = await fetch(`${baseUrl}/api/p0/native/api/auth/google`, {
    method: 'POST', headers: { origin: 'https://attacker.example', 'content-type': 'application/json' }, body: JSON.stringify({ id_token: idToken() }),
  });
  assert.equal(crossOriginNativeLogin.status, 403);
  const nativeLogin = await fetch(`${baseUrl}/api/p0/native/api/auth/google`, {
    method: 'POST', headers: { origin: baseUrl, 'content-type': 'application/json' }, body: JSON.stringify({ id_token: idToken() }),
  });
  assert.equal(nativeLogin.status, 200);
  const nativeSession = await nativeLogin.json();
  assert.equal(nativeSession.token, 'mtos-native-cookie-v1');
  const nativeSetCookie = nativeLogin.headers.get('set-cookie') || '';
  assert.match(nativeSetCookie, /^mtos_p0_native_session=/i);
  assert.match(nativeSetCookie, /Path=\/api\/p0\/native/i);
  assert.match(nativeSetCookie, /HttpOnly/i);
  assert.match(nativeSetCookie, /SameSite=strict/i);
  if (production) assert.match(nativeSetCookie, /Secure/i);
  const nativeCookie = nativeSetCookie.split(';', 1)[0];
  const nativeHeaders = { authorization: `Bearer ${nativeSession.token}`, cookie: nativeCookie, origin: baseUrl, 'content-type': 'application/json' };
  const nativeCreate = await fetch(`${baseUrl}/api/p0/native/api/tasks`, {
    method: 'POST', headers: nativeHeaders,
    body: JSON.stringify({ id: 'native-proxy-task', op_id: 'native-proxy-create', fields: { title: 'P0 네이티브 화면', status: 'open', category: 'personal' } }),
  });
  assert.equal(nativeCreate.status, 201);
  const nativeList = await fetch(`${baseUrl}/api/p0/native/api/tasks`, { headers: { authorization: nativeHeaders.authorization, cookie: nativeCookie, origin: baseUrl } });
  assert.ok((await nativeList.json()).tasks.some((task) => task.id === 'native-proxy-task'));
  const nativeLogout = await fetch(`${baseUrl}/api/p0/native/api/auth/logout`, {
    method: 'POST', headers: nativeHeaders, body: JSON.stringify({}),
  });
  assert.equal(nativeLogout.status, 200);
  assert.match(nativeLogout.headers.get('set-cookie') || '', /Max-Age=0/i);
  const nativeAfterLogout = await fetch(`${baseUrl}/api/p0/native/api/tasks`, { headers: { cookie: nativeCookie } });
  assert.equal(nativeAfterLogout.status, 401);
  assert.match(nativeAfterLogout.headers.get('set-cookie') || '', /Max-Age=0/i);

  const renamed = await fetch(`${endpoint}/${createdData.task.id}`, {
    method: 'PATCH', headers,
    body: JSON.stringify({ base_version: 1, changes: { title: 'HTTP 수정된 할 일' }, op_id: 'http-e2e-title-1' }),
  });
  assert.equal((await renamed.json()).task.title, 'HTTP 수정된 할 일');
  const completed = await fetch(`${endpoint}/${createdData.task.id}`, {
    method: 'PATCH', headers,
    body: JSON.stringify({ base_version: 2, changes: { status: 'done' }, op_id: 'http-e2e-done-1' }),
  });
  assert.equal((await completed.json()).task.status, 'done');

  const afterReload = await fetch(endpoint, { headers: { cookie } });
  const persisted = await afterReload.json();
  assert.equal(afterReload.status, 200);
  assert.equal(persisted.tasks[0].title, 'HTTP 수정된 할 일');
  assert.equal(persisted.tasks[0].status, 'done');
  const sqliteTask = p0.db.prepare('SELECT title, status FROM tasks WHERE id = ?').get(createdData.task.id);
  assert.equal(sqliteTask.title, 'HTTP 수정된 할 일');
  assert.equal(sqliteTask.status, 'done');

  console.log('PASS Next.js HTTP page renders the P0 home panel');
  console.log('PASS same-origin proxy fences framing, scopes P0 caches, and keeps the native session HttpOnly');
  console.log('PASS native P0 logout revokes and clears its isolated session cookie');
  console.log('PASS same-origin writes succeed and cross-origin writes are rejected');
  console.log(`PASS test Google token becomes an HttpOnly, SameSite=Strict${production ? ', Secure' : ''} cookie`);
  console.log('PASS Next.js API -> P0 HTTP server -> SQLite create/read/title-edit/complete/refresh');
  console.log('PASS idempotency key prevents a duplicate SQLite task');
} catch (error) {
  console.error(error);
  if (output) console.error(output);
  process.exitCode = 1;
} finally {
  if (next && next.exitCode === null) {
    next.kill('SIGTERM');
    await Promise.race([new Promise((resolve) => next.once('exit', resolve)), delay(5000)]);
    if (next.exitCode === null) next.kill('SIGKILL');
  }
  if (p0) await p0.close();
}
