import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createStore } from '../src/store.js';
import { createYolo } from '../src/yolo.js';
import { fakeAi, freshDb } from './helpers.js';

const op = (o) => ({ op: 'create', task_id: null, source_type: null, source_id: null, title: null, memo: null, due_date: null, priority: null, category: null, project_id: null, duplicate_of: null, evidence: null, reason: 'test', ...o });

/** In-memory stand-in for the P0 task API with per-field user/ai revision actors. */
function fakeP0(initial = []) {
  const tasks = new Map(initial.map((t) => [t.id, { version: 1, status: 'open', deleted: false, priority: 'normal', category: 'unclassified', project_id: null, due_date: null, memo: '', ...t }]));
  const revisions = new Map();
  const ops = new Set();
  const rev = (id, actor, changes) => revisions.set(id, [...(revisions.get(id) ?? []), { version: (revisions.get(id)?.length ?? 0) + 1, actor, changes }]);
  for (const t of tasks.values()) rev(t.id, 'user', {});
  return {
    tasks, revisions,
    async listTasks() { return [...tasks.values()].filter((t) => !t.deleted).map((t) => ({ ...t })); },
    async create(id, fields) {
      if (tasks.has(id)) return { task: tasks.get(id), duplicate: true };
      const t = { id, version: 1, status: 'open', deleted: false, priority: 'normal', category: 'unclassified', project_id: null, due_date: null, memo: '', source_url: null, ...fields };
      tasks.set(id, t); rev(id, 'ai', fields);
      return { task: { ...t }, duplicate: false };
    },
    async update(id, baseVersion, changes, opId) {
      assert.ok(opId);
      const t = tasks.get(id); Object.assign(t, changes); t.version += 1; rev(id, 'ai', changes);
      return { task: { ...t }, conflicts: [] };
    },
    async archive(id) { tasks.get(id).deleted = true; return tasks.get(id); },
    async restore(id) { tasks.get(id).deleted = false; return tasks.get(id); },
    async revisions(id) { return revisions.get(id) ?? []; },
    userEdit(id, changes) { Object.assign(tasks.get(id), changes); tasks.get(id).version += 1; rev(id, 'user', changes); },
    ops,
  };
}

function labRoot() {
  const root = mkdtempSync(join(tmpdir(), 'lab-'));
  mkdirSync(join(root, '02_Projects', 'thesis'), { recursive: true });
  writeFileSync(join(root, '02_Projects', 'thesis', 'project.md'),
    '---\nid: thesis\ntitle: "석사논문"\nstatus: 진행중\n---\n\n# T\n\n## Next / Blocked\n- [ ] 3장 초고 작성\n- [x] 끝난 일\n\n## Other\n- [ ] 무시\n');
  return root;
}

function setup({ ai, p0, seedItem = true }) {
  const db = freshDb();
  const store = createStore(db);
  let item = null;
  if (seedItem) item = store.inbox.capture({ text: '교수님: 10/30까지 3장 초안 보내주세요', capture_id: 'c1' }).item;
  const yolo = createYolo({ db, store, p0, ai, labRoot: labRoot() });
  return { db, store, yolo, item };
}

test('creates one task from new info, applies it, logs before/after, and a retry does not duplicate', async () => {
  const p0 = fakeP0();
  const { yolo, item, db, store } = setup({
    p0, ai: fakeAi(
      { ops: [op({ source_type: 'manual', source_id: 'PLACEHOLDER', title: '3장 초안 보내기', due_date: '2026-10-30', priority: 'high', project_id: 'thesis' })] },
    ),
  });
  // point the op at the real inbox item id
  const ai = fakeAi({ ops: [op({ source_type: 'manual', source_id: item.id, title: '3장 초안 보내기', due_date: '2026-10-30', priority: 'high', project_id: 'thesis' })] },
    { ops: [op({ source_type: 'manual', source_id: item.id, title: '3장 초안 보내기' })] });
  const y = createYolo({ db, store, p0, ai, labRoot: labRoot() });
  const first = await y.run({});
  assert.equal(first.applied, 1);
  const task = [...p0.tasks.values()][0];
  assert.equal(task.priority, 'high');
  assert.equal(task.project_id, 'thesis');
  assert.ok(store.taskMeta.get(task.id).ai_generated);
  assert.equal(store.inbox.get(item.id).state, 'applied');
  const [change] = y.changesOf(first.runId);
  assert.equal(change.status, 'applied');
  assert.deepEqual(change.before, {});
  assert.equal(change.after.title, '3장 초안 보내기');

  // The same item again (e.g. retry after a crash) must not create a second task.
  db.prepare("UPDATE inbox_items SET state = 'new'").run();
  const second = await y.run({});
  assert.equal(p0.tasks.size, 1);
  assert.equal(second.applied, 0);
});

test('rejects ops that violate the rules: unknown source, user-owned field, unprotected archive, complete without evidence', async () => {
  const p0 = fakeP0([{ id: 'u1', title: '사용자 작업', priority: 'low' }, { id: 'u2', title: '다른 작업' }]);
  p0.userEdit('u1', { priority: 'low' });
  const { db, store, item } = setup({ p0, ai: fakeAi() });
  const ai = fakeAi({
    ops: [
      op({ source_type: 'manual', source_id: 'does-not-exist', title: '환각 작업' }),
      op({ op: 'update', task_id: 'u1', priority: 'high' }),
      op({ op: 'archive', task_id: 'u2' }),
      op({ op: 'complete', task_id: 'u2', source_type: 'manual', source_id: item.id, evidence: null }),
    ],
  });
  const y = createYolo({ db, store, p0, ai, labRoot: labRoot() });
  const result = await y.run({});
  assert.equal(result.applied, 0);
  assert.equal(result.skipped, 4);
  assert.equal(p0.tasks.get('u1').priority, 'low');
  assert.equal(p0.tasks.get('u2').deleted, false);
  assert.equal(p0.tasks.size, 2);
});

test('rollback restores updates, archives and creates', async () => {
  const p0 = fakeP0([{ id: 'a', title: '오래된 중복' }, { id: 'b', title: '오래된 중복' }, { id: 'c', title: '마감 없음' }]);
  const { db, store, item } = setup({ p0, ai: fakeAi() });
  const ai = fakeAi({
    ops: [
      op({ source_type: 'manual', source_id: item.id, title: '새 작업' }),
      op({ op: 'update', task_id: 'c', due_date: '2026-11-05' }),
      op({ op: 'archive', task_id: 'b', duplicate_of: 'a' }),
    ],
  });
  const y = createYolo({ db, store, p0, ai, labRoot: labRoot() });
  const { runId, applied } = await y.run({});
  assert.equal(applied, 3);
  assert.equal(p0.tasks.get('b').deleted, true);
  assert.equal(p0.tasks.get('c').due_date, '2026-11-05');
  const out = await y.rollback(runId);
  assert.equal(out.rolled_back, 3);
  assert.equal(p0.tasks.get('b').deleted, false);
  assert.equal(p0.tasks.get('c').due_date, null);
  assert.ok([...p0.tasks.values()].filter((t) => t.title === '새 작업').every((t) => t.deleted));
  assert.equal(db.prepare('SELECT status FROM yolo_runs WHERE id = ?').get(runId).status, 'rolled_back');
});

test('does not call the AI when nothing is new; reads Chocomint-Lab projects once per change', async () => {
  const p0 = fakeP0();
  const ai = fakeAi({ ops: [] });
  const { yolo } = setup({ p0, ai, seedItem: false });
  assert.equal((await yolo.run({})).status, 'ok'); // first run sees the project file
  assert.match(ai.calls[0].prompt, /3장 초고 작성/);
  assert.equal((await yolo.run({})).status, 'skipped'); // unchanged -> no AI call
  assert.equal(ai.calls.length, 1);
});

test('invalid AI output fails the run without touching tasks', async () => {
  const p0 = fakeP0();
  const { yolo, db } = setup({ p0, ai: fakeAi({ ops: [{ op: 'delete_everything' }] }) });
  await assert.rejects(() => yolo.run({}), /schema/);
  assert.equal(p0.tasks.size, 0);
  assert.equal(db.prepare('SELECT status FROM yolo_runs').get().status, 'failed');
});

test('worker schedules and runs yolo_manage through the real queue, once per slot', async () => {
  const { createWorker } = await import('../src/worker.js');
  const { clock } = await import('./helpers.js');
  const db = freshDb();
  const p0 = fakeP0();
  const ai = fakeAi({ ops: [] }, { ops: [] });
  const now = clock(Date.parse('2026-10-26T02:30:00Z'));
  const store = createStore(db);
  const yolo = createYolo({ db, store, p0, ai, labRoot: labRoot(), now });
  const worker = createWorker({ db, ai, now, yolo, collectMail: async () => ({ fetched: 0, newItemIds: [] }) });
  for (let i = 0; i < 6; i += 1) await worker.tick();
  const types = db.prepare('SELECT type, state FROM jobs ORDER BY created_at').all();
  assert.ok(types.some((j) => j.type === 'yolo_manage' && j.state === 'done'), JSON.stringify(types));
  const before = db.prepare('SELECT COUNT(*) n FROM jobs').get().n;
  for (let i = 0; i < 3; i += 1) await worker.tick(); // same 30-minute slot: no new jobs
  assert.equal(db.prepare('SELECT COUNT(*) n FROM jobs').get().n, before);
});
