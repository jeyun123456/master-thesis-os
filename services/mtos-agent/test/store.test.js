import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createStore } from '../src/store.js';
import { freshDb } from './helpers.js';

test('memos are idempotent on client id and soft-deleted', () => {
  const s = createStore(freshDb());
  const first = s.memos.create({ id: 'm1', kind: 'note', body: '아이디어', project_id: 'thesis' });
  assert.equal(s.memos.create({ id: 'm1', kind: 'note', body: 'changed' }).duplicate, true);
  assert.equal(first.memo.body, '아이디어');
  s.memos.remove('m1');
  assert.equal(s.memos.list().length, 0);
  assert.equal(s.memos.list({ includeDeleted: true }).length, 1);
});

test('memo kind is validated and never coerced into a task', () => {
  const s = createStore(freshDb());
  assert.throws(() => s.memos.create({ kind: 'todo', body: 'x' }), /kind/);
  assert.equal(s.memos.create({ body: 'x' }).memo.kind, 'note');
});

test('official deadlines need a source and explicit user confirmation to move', () => {
  const s = createStore(freshDb());
  assert.throws(() => s.milestones.create({ project_id: 'thesis', title: '논문 제출', date: '2027-01-10', kind: 'official' }), /source/);
  const { milestone } = s.milestones.create({ project_id: 'thesis', title: '논문 제출', date: '2027-01-10', kind: 'official', source: '대학원 공지' });
  assert.throws(() => s.milestones.update(milestone.id, { base_version: 1, changes: { date: '2027-01-12' } }), /explicit user confirmation/);
  assert.throws(() => s.milestones.update(milestone.id, { base_version: 1, changes: { date: '2027-01-12' }, confirm_official: true }, 'ai'), /explicit user confirmation/);
  assert.throws(() => s.milestones.remove(milestone.id), /kept/);
  const moved = s.milestones.update(milestone.id, { base_version: 1, changes: { date: '2027-01-12' }, confirm_official: true });
  assert.equal(moved.date, '2027-01-12');
  const history = s.milestones.history(milestone.id);
  assert.deepEqual(history.at(-1).before, { date: '2027-01-10' });
});

test('internal milestones change freely but reject stale versions', () => {
  const s = createStore(freshDb());
  const { milestone } = s.milestones.create({ project_id: 'thesis', title: '초고', date: '2026-11-30', kind: 'internal' });
  s.milestones.update(milestone.id, { base_version: 1, changes: { date: '2026-12-05' } });
  assert.throws(() => s.milestones.update(milestone.id, { base_version: 1, changes: { title: 'x' } }), /reload/);
});

test('inbox capture stores raw text first and dedupes retries', () => {
  const s = createStore(freshDb());
  const a = s.inbox.capture({ text: '지도교수께 메일', capture_id: 'c1' });
  const b = s.inbox.capture({ text: '지도교수께 메일', capture_id: 'c1' });
  assert.equal(a.item.state, 'new');
  assert.equal(b.duplicate, true);
  assert.equal(s.inbox.list().length, 1);
});

test('final inbox states cannot be silently rewritten, but undo is allowed', () => {
  const s = createStore(freshDb());
  const { item } = s.inbox.capture({ text: 'x', capture_id: 'c2' });
  s.inbox.setState(item.id, 'applied', { created_task_id: 't1' });
  assert.throws(() => s.inbox.setState(item.id, 'dismissed'), /already applied/);
  assert.equal(s.inbox.setState(item.id, 'undone').state, 'undone');
  assert.equal(s.inbox.get(item.id).created_task_id, 't1', 'link to the created task is kept');
});

test('approvals: newer proposal supersedes, decide records edits, apply only after approval', () => {
  const s = createStore(freshDb());
  const old = s.approvals.create({ kind: 'deadline_change', title: 'a', target_ref: 'task:1', payload: { due_date: '2026-11-01' } });
  const fresh = s.approvals.create({ kind: 'deadline_change', title: 'b', target_ref: 'task:1', payload: { due_date: '2026-11-02' } });
  assert.equal(s.approvals.get(old.id).state, 'stale');
  assert.throws(() => s.approvals.finish(fresh.id, 'applied'), /cannot mark pending/);
  s.approvals.decide(fresh.id, { decision: 'approved', payload: { due_date: '2026-11-03' } });
  assert.equal(s.approvals.get(fresh.id).payload.due_date, '2026-11-03');
  s.approvals.finish(fresh.id, 'applied');
  assert.deepEqual(s.approvals.events(fresh.id).map((e) => e.event), ['created', 'edited', 'approved', 'applied']);
});

test('only urgent approvals reach the home screen', () => {
  const s = createStore(freshDb());
  s.approvals.create({ kind: 'stage_change', title: 'normal', payload: {} });
  s.approvals.create({ kind: 'deadline_change', title: 'near', payload: {}, official_deadline: '2026-10-27' });
  s.approvals.create({ kind: 'deadline_change', title: 'far', payload: {}, official_deadline: '2026-11-20' });
  s.approvals.create({ kind: 'sync_conflict', title: 'blocking', payload: {}, blocks_today: true });
  s.approvals.create({ kind: 'obsidian_write', title: 'loss', payload: {}, data_loss_risk: true });
  assert.deepEqual(s.approvals.urgent('2026-10-25').map((a) => a.title).sort(), ['blocking', 'loss', 'near']);
});

test('block history is append-only', () => {
  const s = createStore(freshDb());
  s.taskMeta.block('t1', { event: 'blocked', reason: '데이터 대기' });
  s.taskMeta.block('t1', { event: 'snoozed', until: '2026-10-30' });
  const { meta, events } = s.taskMeta.block('t1', { event: 'unblocked' });
  assert.equal(meta.blocked_reason, null);
  assert.deepEqual(events.map((e) => e.event), ['blocked', 'snoozed', 'unblocked']);
  assert.equal(events[0].reason, '데이터 대기');
});

test('skipped occurrences are tracked but not counted as done', () => {
  const s = createStore(freshDb());
  s.taskMeta.recordOccurrence({ series_id: 'weekly', due_date: '2026-10-18', state: 'done' });
  const result = s.taskMeta.recordOccurrence({ series_id: 'weekly', due_date: '2026-10-25', state: 'skipped' });
  assert.equal(result.done, 1);
  assert.equal(result.skipped, 1);
  assert.throws(() => s.taskMeta.recordOccurrence({ series_id: 'weekly', due_date: '2026-11-01', state: 'deferred' }), /deferred_to/);
});

test('recurrence rules are validated', () => {
  const s = createStore(freshDb());
  assert.throws(() => s.taskMeta.upsert('t1', { recur: { mode: 'fixed', every_days: 7 } }), /anchor_date/);
  assert.equal(s.taskMeta.upsert('t1', { recur: { mode: 'after_completion', every_days: 7 } }).recur.mode, 'after_completion');
});

test('mail senders must be explicit addresses or domains', () => {
  const s = createStore(freshDb());
  assert.deepEqual(s.settings.setMailSenders(['Prof@Univ.ac.jp', 'univ.ac.jp']), ['prof@univ.ac.jp', 'univ.ac.jp']);
  assert.throws(() => s.settings.setMailSenders(['not an address']), /invalid sender/);
});

test('search escapes LIKE wildcards', () => {
  const s = createStore(freshDb());
  s.memos.create({ body: '100% 완료' });
  s.memos.create({ body: '다른 메모' });
  assert.equal(s.search('100%').memos.length, 1);
  assert.equal(s.search('%').memos.length, 1);
});
