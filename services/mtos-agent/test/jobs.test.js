import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AiAuthError } from '../src/codex.js';
import { latestCollectSlot, slotDue, tokyoDate } from '../src/schedule.js';
import { createStore } from '../src/store.js';
import { createWorker } from '../src/worker.js';
import { clock, fakeAi, freshDb } from './helpers.js';

const classification = (overrides = {}) => ({
  class: 'task', confidence: 0.9, title: '지도교수에게 초고 보내기', summary: '', due_date: null, due_is_explicit: false,
  project_id: null, project_confidence: 0, duplicate_of_task_id: null, reason: '실행 가능', ...overrides,
});

function setup(ai, now = clock()) {
  const db = freshDb();
  const worker = createWorker({ db, ai, now, collectMail: async () => ({ fetched: 0, newItemIds: [] }) });
  worker.store.settings.setContext({
    projects: [{ id: 'thesis', title: '석사논문' }],
    tasks: [{ id: 'task-1', title: '문헌 정리', status: 'open' }, { id: 'task-2', title: '데이터 전처리', status: 'open' }],
  });
  return { db, worker, store: worker.store, now };
}

async function captureAndRun(ctx, text) {
  const { item } = ctx.store.inbox.capture({ text, capture_id: `c-${Math.random().toString(36).slice(2)}` });
  ctx.worker.queue.enqueue({ type: 'classify_inbox', input: { item_id: item.id }, source: 'user' });
  await ctx.worker.tick();
  return ctx.store.inbox.get(item.id);
}

test('Tokyo slots: 06:00 and 18:00 JST, keyed by date', () => {
  // 2026-10-25 08:59 UTC is 17:59 JST -> latest slot is that morning 06:00.
  assert.equal(latestCollectSlot(Date.parse('2026-10-25T08:59:00Z')).key, '2026-10-25T06');
  assert.equal(latestCollectSlot(Date.parse('2026-10-25T09:00:00Z')).key, '2026-10-25T18');
  // 2026-10-25 20:00 UTC is 05:00 JST on the 26th -> previous evening.
  assert.equal(latestCollectSlot(Date.parse('2026-10-25T20:00:00Z')).key, '2026-10-25T18');
  assert.equal(tokyoDate(Date.parse('2026-10-25T20:00:00Z')), '2026-10-26');
  const slot = latestCollectSlot(Date.parse('2026-10-25T09:00:00Z'));
  assert.equal(slotDue(slot, slot.at + 12 * 3600_000), false, 'stale catch-up is skipped');
});

test('worker enqueues each collect slot once', async () => {
  const ctx = setup(fakeAi());
  ctx.now.set(Date.parse('2026-10-25T09:05:00Z'));
  await ctx.worker.tick();
  await ctx.worker.tick();
  const collects = ctx.worker.queue.list().filter((j) => j.type === 'collect_mail');
  assert.equal(collects.length, 1);
  assert.equal(collects[0].dedupe_key, 'collect_mail:slot:2026-10-25T18');
});

test('a clear task is marked for automatic creation', async () => {
  const item = await captureAndRun(setup(fakeAi(classification())), '초고 보내기');
  assert.equal(item.state, 'auto_pending');
  assert.equal(item.classification.model, 'fake-model');
});

test('uncertain dates are never presented as explicit deadlines', async () => {
  const item = await captureAndRun(setup(fakeAi(classification({ due_date: '2026-11-3', due_is_explicit: true }))), '다음주쯤');
  assert.equal(item.classification.due_date, null);
  assert.equal(item.classification.due_is_explicit, false);
});

test('unknown project ids from the AI are dropped', async () => {
  const item = await captureAndRun(setup(fakeAi(classification({ project_id: 'made-up', confidence: 0.5 }))), 'x');
  assert.equal(item.classification.project_id, null);
  assert.equal(item.state, 'classified');
});

test('an obvious duplicate is linked instead of creating a task', async () => {
  const item = await captureAndRun(setup(fakeAi(classification({ title: '문헌  정리!' }))), '문헌 정리');
  assert.equal(item.state, 'duplicate');
  assert.equal(item.duplicate_of_task_id, 'task-1');
  assert.equal(item.raw_text, '문헌 정리', 'original text kept');
});

test('an ambiguous duplicate waits for approval', async () => {
  const ctx = setup(fakeAi(classification({ title: '전처리 마무리', duplicate_of_task_id: 'task-2' })));
  const item = await captureAndRun(ctx, '전처리 마저 하기');
  assert.equal(item.state, 'classified');
  const [approval] = ctx.store.approvals.list({ states: ['pending'] });
  assert.equal(approval.kind, 'duplicate_merge');
  assert.equal(approval.payload.existing_task_id, 'task-2');
});

test('invalid AI output fails the job but keeps the captured text', async () => {
  const ctx = setup(fakeAi({ class: 'task' }, { class: 'task' }, { class: 'task' }));
  const item = await captureAndRun(ctx, '원문 보존');
  const [job] = ctx.worker.queue.list().filter((j) => j.type === 'classify_inbox');
  assert.equal(job.state, 'retry_wait');
  assert.match(job.error, /schema/);
  assert.equal(ctx.store.inbox.get(item.id).raw_text, '원문 보존');
});

test('auth failure pauses the queue and resumes when login works again', async () => {
  const ai = fakeAi(new AiAuthError('Not logged in'), classification());
  ai.loginOkValue = false;
  const ctx = setup(ai);
  const item = await captureAndRun(ctx, 'x');
  assert.equal(ctx.worker.queue.paused().reason, 'auth');
  assert.equal(ctx.store.inbox.get(item.id).state, 'new');
  ai.loginOkValue = true;
  ctx.now.advance(11 * 60_000);
  await ctx.worker.tick();
  assert.equal(ctx.worker.queue.paused(), null);
  assert.equal(ctx.store.inbox.get(item.id).state, 'auto_pending');
});

test('focus recommendations keep only valid, unpinned, open tasks and cap at five', async () => {
  const ai = fakeAi({ items: [
    { task_id: 'a', reason: '마감 임박' }, { task_id: 'pinned', reason: 'x' }, { task_id: 'ghost', reason: 'x' }, { task_id: 'a', reason: 'dup' },
  ], note: '' });
  const ctx = setup(ai);
  ctx.worker.queue.enqueue({ type: 'recommend_focus', source: 'user', input: {
    date: '2026-10-25', pinned_ids: ['pinned'], free_slots: [{ start: '10:00', end: '10:45', minutes: 45 }],
    tasks: [{ id: 'a', title: 'A', status: 'open' }, { id: 'pinned', title: 'P', status: 'open' }, { id: 'done', title: 'D', status: 'done' }],
  } });
  await ctx.worker.tick();
  const latest = ctx.store.focus.latest('2026-10-25');
  assert.deepEqual(latest.items.map((i) => i.task_id), ['a']);
  assert.equal(latest.free_slots[0].minutes, 45);
  assert.ok(!ai.calls[0].prompt.includes('"pinned"'), 'pinned tasks are not sent as candidates');
});

test('obsidian merge produces an approval tied to the read SHA, never a write', async () => {
  const ctx = setup(fakeAi());
  const { memo } = ctx.store.memos.create({ body: '새 아이디어', project_id: 'thesis' });
  ctx.worker.queue.enqueue({ type: 'obsidian_merge', source: 'user', input: {
    path: 'projects/thesis/notes.md', base_sha: 'sha-1', current_text: '# 노트\n기존', memo_id: memo.id, memo_text: '새 아이디어', mode: 'append',
  } });
  await ctx.worker.tick();
  const [approval] = ctx.store.approvals.list({ states: ['pending'] });
  assert.equal(approval.kind, 'obsidian_write');
  assert.equal(approval.target_version, 'sha-1');
  assert.match(approval.payload.after_text, /# 노트\n기존\n\n## \d{4}-\d{2}-\d{2} 메모\n\n새 아이디어/);
  assert.equal(ctx.store.memos.get(memo.id).obsidian_state, 'proposed');
});

test('store is shared between worker and API', () => {
  const db = freshDb();
  createStore(db).memos.create({ id: 'shared', body: 'x' });
  assert.equal(createStore(db).memos.get('shared').body, 'x');
});
