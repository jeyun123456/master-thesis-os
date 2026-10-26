#!/usr/bin/env node
// One-time (and after expiry) manual sign-in to the Ritsumei Student Portal on the server.
//   node scripts/portal-login.js           opens a browser window; sign in yourself (MFA included)
//   node scripts/portal-login.js status    shows whether a saved session exists
// The browser profile (cookies) stays in MTOS_PORTAL_PROFILE_DIR; no password is read or stored here.
// After a successful sign-in the paused portal collector is switched back on.
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openAgentDb } from '../src/db.js';
import { resumePortal, runPortalCli } from '../src/school-notices.js';
import { createStore } from '../src/store.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = process.env;

if (process.argv[2] === 'status') {
  console.log(JSON.stringify(await runPortalCli(['status'], { env })));
} else {
  console.log('학교 포털 로그인 창이 열려. 직접 로그인해줘 (최대 5분).');
  const result = await runPortalCli(['login'], { env, timeoutMs: 6 * 60_000 });
  if (!result.ok) {
    console.error(`로그인 실패: ${result.code} ${result.message ?? ''}`);
    process.exit(1);
  }
  const db = openAgentDb(env.MTOS_AGENT_DB_PATH ?? join(root, 'data', 'mtos-agent.db'));
  resumePortal(createStore(db));
  db.close();
  console.log('로그인 확인됨. 공지 수집이 다시 활성화됐어.');
}
