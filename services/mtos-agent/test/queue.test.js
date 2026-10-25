import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createQueue, retryDelayMs } from '../src/queue.js';
import { clock, freshDb } from './helpers.js';

const LEASE = 60_000;

test('enqueue is idempotent on dedupe key', () => {
  const q = createQueue(freshDb());
  const a = q.enqueue({ type: 'collect_mail', source: 'scheduled', dedupeKey: 'slot-1' });
  const b = q.enqueue({ type: 'collect_mail', source: 'scheduled', dedupeKey: 'slot-1' });
  assert.equal(b.duplicate, true);
  assert.equal(a.job.id, b.job.id);
});

test('user requests run before scheduled work queued earlier', () => {
  const now = clock();
  const q = createQueue(freshDb(), { now });
  q.enqueue({ type: 'collect_mail', source: 'scheduled' });
  now.advance(1000);
  const user = q.enqueue({ type: 'decompose_task', source: 'user', input: {} }).job;
  assert.equal(q.claim({ owner: 'w', leaseMs: LEASE }).id, user.id);
});

test('concurrency limit blocks a second claim while a lease is live', () => {
  const q = createQueue(freshDb());
  q.enqueue({ type: 'collect_mail', source: 'user' });
  q.enqueue({ type: 'collect_mail', source: 'user' });
  assert.ok(q.claim({ owner: 'w1', leaseMs: LEASE, concurrency: 1 }));
  assert.equal(q.claim({ owner: 'w2', leaseMs: LEASE, concurrency: 1 }), null);
});

test('failures back off and end as failed after max attempts', () => {
  const now = clock();
  const q = createQueue(freshDb(), { now });
  const { job } = q.enqueue({ type: 'collect_mail', source: 'user', maxAttempts: 2 });
  q.claim({ owner: 'w', leaseMs: LEASE });
  let after = q.fail(job.id, 'w', { error: 'boom' });
  assert.equal(after.state, 'retry_wait');
  assert.equal(Date.parse(after.next_run_at) - now(), retryDelayMs(1));
  assert.equal(q.claim({ owner: 'w', leaseMs: LEASE }), null, 'not before backoff');
  now.advance(retryDelayMs(1));
  q.claim({ owner: 'w', leaseMs: LEASE });
  after = q.fail(job.id, 'w', { error: 'boom again' });
  assert.equal(after.state, 'failed');
  assert.equal(after.attempts, 2);
});

test('permanent failures do not retry', () => {
  const q = createQueue(freshDb());
  const { job } = q.enqueue({ type: 'collect_mail', source: 'user' });
  q.claim({ owner: 'w', leaseMs: LEASE });
  assert.equal(q.fail(job.id, 'w', { error: 'no config', retryable: false }).state, 'failed');
});

test('expired leases from a dead worker are recovered', () => {
  const now = clock();
  const q = createQueue(freshDb(), { now });
  const { job } = q.enqueue({ type: 'collect_mail', source: 'user' });
  q.claim({ owner: 'dead', leaseMs: LEASE });
  now.advance(LEASE + 1);
  assert.equal(q.recoverExpired(), 1);
  assert.equal(q.get(job.id).state, 'retry_wait');
  assert.throws(() => q.complete(job.id, 'dead', { result: {} }), /no longer owned/);
});

test('a live lease is not recovered and a running job cannot be cancelled', () => {
  const q = createQueue(freshDb());
  const { job } = q.enqueue({ type: 'collect_mail', source: 'user' });
  q.claim({ owner: 'w', leaseMs: LEASE });
  assert.equal(q.recoverExpired(), 0);
  assert.throws(() => q.cancel(job.id), /only waiting jobs/);
});

test('auth pause returns the job without spending an attempt and stops claims until resume', () => {
  const q = createQueue(freshDb());
  const { job } = q.enqueue({ type: 'collect_mail', source: 'user' });
  q.claim({ owner: 'w', leaseMs: LEASE });
  q.pauseForAuth(job.id, 'w', 'Not logged in');
  assert.equal(q.get(job.id).state, 'queued');
  assert.equal(q.get(job.id).attempts, 0);
  assert.equal(q.paused().reason, 'auth');
  assert.equal(q.claim({ owner: 'w', leaseMs: LEASE }), null);
  q.resume();
  assert.equal(q.claim({ owner: 'w', leaseMs: LEASE }).id, job.id);
});

test('failed jobs can be retried manually', () => {
  const q = createQueue(freshDb());
  const { job } = q.enqueue({ type: 'collect_mail', source: 'user', maxAttempts: 1 });
  q.claim({ owner: 'w', leaseMs: LEASE });
  q.fail(job.id, 'w', { error: 'x' });
  assert.equal(q.retry(job.id).state, 'queued');
});
