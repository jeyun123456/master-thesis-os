import { randomUUID } from 'node:crypto';
import { nowIso, tx } from './db.js';
import { ConflictError, NotFoundError, ValidationError } from './validate.js';

// Lower runs first. A request the user is waiting on always beats scheduled work.
export const PRIORITY = { user: 0, system: 5, scheduled: 10 };
export const JOB_TYPES = ['classify_inbox', 'collect_mail', 'recommend_focus', 'decompose_task', 'unblock_task', 'obsidian_merge'];
const RETRY_BASE_MS = 60_000;
const RETRY_MAX_MS = 30 * 60_000;

const parse = (row) => row && {
  ...row,
  input: JSON.parse(row.input),
  result: row.result ? JSON.parse(row.result) : null,
};

export function retryDelayMs(attempts) {
  return Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.max(0, attempts - 1));
}

export function createQueue(db, { now = () => Date.now() } = {}) {
  const iso = (ms) => new Date(ms).toISOString();
  const get = (jobId) => parse(db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId));
  const getMeta = (key) => db.prepare('SELECT value FROM meta WHERE key = ?').get(key)?.value ?? null;
  const setMeta = (key, value) => {
    if (value === null) db.prepare('DELETE FROM meta WHERE key = ?').run(key);
    else db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
  };

  return {
    get,

    /** Idempotent on dedupe_key: an existing job with the same key is returned unchanged. */
    enqueue({ type, input = {}, source = 'user', dedupeKey, maxAttempts = 3, runAt }) {
      if (!JOB_TYPES.includes(type)) throw new ValidationError('unknown job type');
      if (!(source in PRIORITY)) throw new ValidationError('unknown job source');
      const key = dedupeKey ?? `${type}:${randomUUID()}`;
      return tx(db, () => {
        const existing = db.prepare('SELECT * FROM jobs WHERE dedupe_key = ?').get(key);
        if (existing) return { job: parse(existing), duplicate: true };
        const jobId = randomUUID();
        db.prepare(`INSERT INTO jobs (id, dedupe_key, type, priority, state, max_attempts, next_run_at, source, input, created_at)
          VALUES (?,?,?,?, 'queued', ?,?,?,?,?)`).run(jobId, key, type, PRIORITY[source], maxAttempts, runAt ?? iso(now()), source, JSON.stringify(input), iso(now()));
        return { job: get(jobId), duplicate: false };
      });
    },

    /**
     * Claims the next runnable job, or null. Respects the concurrency limit and
     * the auth pause. The lease is what lets a restarted worker detect a job
     * whose process died mid-run.
     */
    claim({ owner, leaseMs, concurrency = 1 }) {
      return tx(db, () => {
        if (getMeta('worker_paused')) return null;
        const t = now();
        const running = db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE state = 'running' AND lease_until > ?").get(iso(t)).n;
        if (running >= concurrency) return null;
        const row = db.prepare(`SELECT * FROM jobs WHERE state IN ('queued','retry_wait') AND next_run_at <= ?
          ORDER BY priority, next_run_at, created_at LIMIT 1`).get(iso(t));
        if (!row) return null;
        db.prepare(`UPDATE jobs SET state = 'running', attempts = attempts + 1, lease_until = ?, lease_owner = ?,
          started_at = ?, error = NULL WHERE id = ?`).run(iso(t + leaseMs), owner, iso(t), row.id);
        return get(row.id);
      });
    },

    renewLease(jobId, owner, leaseMs) {
      const r = db.prepare("UPDATE jobs SET lease_until = ? WHERE id = ? AND state = 'running' AND lease_owner = ?")
        .run(iso(now() + leaseMs), jobId, owner);
      return r.changes > 0;
    },

    complete(jobId, owner, { result, runner = null, model = null }) {
      const r = db.prepare(`UPDATE jobs SET state = 'done', result = ?, runner = ?, model = ?, finished_at = ?, lease_until = NULL
        WHERE id = ? AND state = 'running' AND lease_owner = ?`).run(JSON.stringify(result ?? null), runner, model, iso(now()), jobId, owner);
      if (!r.changes) throw new ConflictError('job is no longer owned by this worker');
      return get(jobId);
    },

    /** Retryable failures back off exponentially; the last attempt or a permanent failure ends in 'failed'. */
    fail(jobId, owner, { error, retryable = true, runner = null, model = null }) {
      return tx(db, () => {
        const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
        if (!job || job.state !== 'running' || job.lease_owner !== owner) throw new ConflictError('job is no longer owned by this worker');
        const message = String(error).slice(0, 1000);
        if (retryable && job.attempts < job.max_attempts) {
          db.prepare(`UPDATE jobs SET state = 'retry_wait', error = ?, next_run_at = ?, lease_until = NULL, runner = ?, model = ? WHERE id = ?`)
            .run(message, iso(now() + retryDelayMs(job.attempts)), runner, model, jobId);
        } else {
          db.prepare(`UPDATE jobs SET state = 'failed', error = ?, finished_at = ?, lease_until = NULL, runner = ?, model = ? WHERE id = ?`)
            .run(message, iso(now()), runner, model, jobId);
        }
        return get(jobId);
      });
    },

    /**
     * Auth failures are not the job's fault: put it back without spending an
     * attempt and pause the whole queue until the login is fixed.
     */
    pauseForAuth(jobId, owner, reason) {
      return tx(db, () => {
        db.prepare(`UPDATE jobs SET state = 'queued', attempts = MAX(0, attempts - 1), lease_until = NULL, error = ?
          WHERE id = ? AND state = 'running' AND lease_owner = ?`).run(String(reason).slice(0, 500), jobId, owner);
        setMeta('worker_paused', JSON.stringify({ reason: 'auth', message: String(reason).slice(0, 500), at: iso(now()) }));
      });
    },

    paused() {
      const value = getMeta('worker_paused');
      return value ? JSON.parse(value) : null;
    },

    resume() {
      setMeta('worker_paused', null);
    },

    /** Re-queues jobs whose lease expired, i.e. whose worker process died. */
    recoverExpired() {
      return tx(db, () => {
        const t = now();
        const stale = db.prepare("SELECT * FROM jobs WHERE state = 'running' AND (lease_until IS NULL OR lease_until <= ?)").all(iso(t));
        for (const job of stale) {
          if (job.attempts < job.max_attempts) {
            db.prepare("UPDATE jobs SET state = 'retry_wait', error = 'worker stopped during run', next_run_at = ?, lease_until = NULL WHERE id = ?")
              .run(iso(t + retryDelayMs(job.attempts)), job.id);
          } else {
            db.prepare("UPDATE jobs SET state = 'failed', error = 'worker stopped during run', finished_at = ?, lease_until = NULL WHERE id = ?")
              .run(iso(t), job.id);
          }
        }
        return stale.length;
      });
    },

    /** Only waiting jobs can be cancelled; a running job is never interrupted from here. */
    cancel(jobId) {
      const r = db.prepare("UPDATE jobs SET state = 'cancelled', finished_at = ? WHERE id = ? AND state IN ('queued','retry_wait')").run(iso(now()), jobId);
      if (!r.changes) {
        if (!get(jobId)) throw new NotFoundError('job not found');
        throw new ConflictError('only waiting jobs can be cancelled');
      }
      return get(jobId);
    },

    /** Manual retry of a failed job. */
    retry(jobId) {
      const r = db.prepare("UPDATE jobs SET state = 'queued', attempts = 0, next_run_at = ?, error = NULL, finished_at = NULL WHERE id = ? AND state = 'failed'")
        .run(iso(now()), jobId);
      if (!r.changes) throw new ConflictError('only failed jobs can be retried');
      return get(jobId);
    },

    list({ limit = 50, states } = {}) {
      const rows = states?.length
        ? db.prepare(`SELECT * FROM jobs WHERE state IN (${states.map(() => '?').join(',')}) ORDER BY created_at DESC LIMIT ?`).all(...states, limit)
        : db.prepare('SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?').all(limit);
      return rows.map(parse);
    },

    counts() {
      return Object.fromEntries(db.prepare('SELECT state, COUNT(*) AS n FROM jobs GROUP BY state').all().map((r) => [r.state, r.n]));
    },
  };
}
