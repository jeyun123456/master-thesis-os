import { hostname } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AiAuthError, AiRateLimitError, createCodexRunner } from './codex.js';
import { nowIso, openAgentDb } from './db.js';
import { createGmailCollector, MailConfigError } from './gmail.js';
import { createJobHandlers, PermanentJobError } from './jobs.js';
import { createQueue } from './queue.js';
import { latestCollectSlot, slotDue, tokyoDate } from './schedule.js';
import { createP0Client } from './p0-client.js';
import { createStore } from './store.js';
import { createYolo } from './yolo.js';

const LEASE_MS = 5 * 60_000;
const AUTH_RECHECK_MS = 10 * 60_000;

/**
 * One worker tick: recover dead leases, enqueue the due mail slot, then run at
 * most one job. Exposed for tests; `startWorker` loops it.
 */
export function createWorker({ db, ai, collectMail, yolo = null, yoloConfig = {}, owner = `${hostname()}:${process.pid}`, concurrency = 1, now = () => Date.now(), log = () => {} }) {
  const store = createStore(db);
  const queue = createQueue(db, { now });
  const handlers = createJobHandlers({ store, queue, ai, collectMail, yolo, now });
  const yoloEveryMs = Math.max(5, Number(yoloConfig.collectMinutes) || 30) * 60_000;
  const reevalHour = Number.isInteger(yoloConfig.reevalHourJst) ? yoloConfig.reevalHourJst : 4;
  let lastAuthCheck = 0;

  function scheduleCollect() {
    const slot = latestCollectSlot(now());
    if (!slotDue(slot, now())) return null;
    return queue.enqueue({ type: 'collect_mail', source: 'scheduled', dedupeKey: `collect_mail:slot:${slot.key}`, maxAttempts: 4 });
  }

  /** YOLO cadence: collect + manage every N minutes, one re-evaluation of existing tasks per JST day. */
  function scheduleYolo() {
    const slot = Math.floor(now() / yoloEveryMs);
    queue.enqueue({ type: 'collect_mail', source: 'scheduled', dedupeKey: `collect_mail:yolo:${slot}`, maxAttempts: 2 });
    queue.enqueue({ type: 'yolo_manage', input: { mode: 'incoming' }, source: 'scheduled', dedupeKey: `yolo:incoming:${slot}`, maxAttempts: 2 });
    const jstHour = new Date(now() + 9 * 3600_000).getUTCHours();
    if (jstHour >= reevalHour) {
      queue.enqueue({ type: 'yolo_manage', input: { mode: 'reevaluate' }, source: 'scheduled', dedupeKey: `yolo:reeval:${tokyoDate(now())}`, maxAttempts: 2 });
    }
  }

  async function maybeResume() {
    const paused = queue.paused();
    if (!paused || now() - lastAuthCheck < AUTH_RECHECK_MS) return;
    lastAuthCheck = now();
    if (await ai.loginOk()) {
      queue.resume();
      store.audit('worker_resumed', 'codex login detected');
      log('resumed after auth pause');
    }
  }

  async function runJob(job) {
    const handler = handlers[job.type];
    const heartbeat = setInterval(() => queue.renewLease(job.id, owner, LEASE_MS), LEASE_MS / 3);
    try {
      const result = await handler(job);
      queue.complete(job.id, owner, { result, runner: result?.model ? 'codex-cli' : 'local', model: result?.model ?? null });
      log(`job ${job.type} ${job.id} done`);
    } catch (error) {
      const model = ai.model ?? null;
      if (error instanceof AiAuthError) {
        queue.pauseForAuth(job.id, owner, error.message);
        store.audit('worker_paused', error.message);
        log('paused: codex auth');
      } else {
        const retryable = !(error instanceof PermanentJobError || error instanceof MailConfigError);
        const after = queue.fail(job.id, owner, { error: error.message, retryable, runner: 'codex-cli', model });
        // A classify job that gave up must not leave its item looking "queued" forever.
        if (after.state === 'failed' && job.type === 'classify_inbox') {
          try { store.inbox.setState(job.input.item_id, 'failed', { error: error.message }); } catch { /* item already final */ }
        }
        log(`job ${job.type} ${job.id} failed: ${error.message}${error instanceof AiRateLimitError ? ' (rate limited)' : ''}`);
      }
    } finally {
      clearInterval(heartbeat);
    }
  }

  async function tick() {
    const recovered = queue.recoverExpired();
    if (recovered) {
      store.audit('jobs_recovered', String(recovered));
      log(`recovered ${recovered} job(s) left running by a stopped worker`);
    }
    if (yolo) scheduleYolo(); else scheduleCollect();
    await maybeResume();
    db.prepare("INSERT INTO meta (key, value) VALUES ('worker_heartbeat', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(JSON.stringify({ at: nowIso(), owner, codex_model: ai.model ?? null }));
    const job = queue.claim({ owner, leaseMs: LEASE_MS, concurrency });
    if (!job) return false;
    await runJob(job);
    return true;
  }

  return { tick, queue, store, scheduleCollect };
}

export async function startWorker(env = process.env) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const db = openAgentDb(env.MTOS_AGENT_DB_PATH ?? join(root, 'data', 'mtos-agent.db'));
  const store = createStore(db);
  const ai = createCodexRunner({ env });
  const collectMail = createGmailCollector({ store, env });
  const concurrency = Math.max(1, Math.min(2, Number(env.MTOS_WORKER_CONCURRENCY ?? 1) || 1));
  // YOLO needs an explicit opt-in and the P0 service token; otherwise the approval-based inbox flow stays as it was.
  const yolo = env.MTOS_YOLO_ENABLED === '1' && env.P0_SERVICE_TOKEN
    ? createYolo({ db, store, ai, p0: createP0Client({ baseUrl: env.MTOS_P0_URL ?? 'http://127.0.0.1:8787', token: env.P0_SERVICE_TOKEN }), labRoot: env.CHOCOMINT_LAB_ROOT ?? 'C:/work/chocomint-lab' })
    : null;
  const yoloConfig = { collectMinutes: env.MTOS_YOLO_COLLECT_MINUTES, reevalHourJst: env.MTOS_YOLO_REEVAL_HOUR_JST === undefined ? undefined : Number(env.MTOS_YOLO_REEVAL_HOUR_JST) };
  const worker = createWorker({ db, ai, collectMail, yolo, yoloConfig, concurrency, log: (m) => console.log(`[mtos-worker] ${new Date().toISOString()} ${m}`) });
  let stopping = false;
  const stop = () => { stopping = true; };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  console.log('[mtos-worker] started');
  while (!stopping) {
    let worked = false;
    try {
      worked = await worker.tick();
    } catch (error) {
      console.error('[mtos-worker] tick failed', error.message);
    }
    await new Promise((resolve) => setTimeout(resolve, worked ? 500 : 15_000));
  }
  db.close();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) startWorker();
