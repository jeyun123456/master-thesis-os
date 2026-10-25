import { describe, expect, it } from 'vitest';
import type { P0Task } from './p0-tasks-client';
import { blockDiff, focusSlots, homeHiddenIds, isMissedOccurrence, localSearch, mergeIntervals, nextDueDate, nextStep, projectTaskBuckets, summarizeProject, unmatchedProjectLinks, type Milestone, type TaskMeta } from './mtos-planning';

const task = (id: string, extra: Partial<P0Task> = {}): P0Task => ({
  id, title: id, status: 'open', due_date: null, is_today: false, category: 'research', project_id: 'thesis', memo: '', source_url: null,
  version: 1, created_at: `2026-10-01T00:00:0${id.length % 10}Z`, updated_at: '', completed_at: null, deleted: false, ...extra,
});
const meta = (task_id: string, extra: Partial<TaskMeta> = {}): TaskMeta => ({
  task_id, parent_task_id: null, step_order: null, ai_generated: false, source_ref: null, blocked_reason: null, snooze_until: null, recur: null, series_id: null, ...extra,
});
const milestone = (extra: Partial<Milestone>): Milestone => ({ id: 'm', project_id: 'thesis', title: 'm', date: '2026-12-01', status: 'planned', kind: 'internal', source: '', evidence_url: null, version: 1, ...extra });

describe('summarizeProject', () => {
  it('counts only P0 tasks linked by project_id and picks the next actionable one', () => {
    const tasks = [
      task('a', { due_date: '2026-11-10' }),
      task('b', { due_date: '2026-11-01' }),
      task('blocked', { due_date: '2026-10-26' }),
      task('done', { status: 'done' }),
      task('other', { project_id: 'other' }),
      task('deleted', { deleted: true }),
    ];
    const summary = summarizeProject('thesis', tasks, [], new Map([['blocked', meta('blocked', { blocked_reason: '자료 대기' })]]));
    expect(summary.remaining).toBe(3);
    expect(summary.done).toBe(1);
    expect(summary.nextTask?.id).toBe('b');
    expect(summary.nearestDue).toEqual({ date: '2026-10-26', label: 'blocked', kind: 'task' });
  });

  it('prefers a step over its parent and includes planned milestones in the nearest date', () => {
    const tasks = [task('parent', { due_date: '2026-12-01' }), task('step', {})];
    const m = new Map([['step', meta('step', { parent_task_id: 'parent' })]]);
    const summary = summarizeProject('thesis', tasks, [milestone({ date: '2026-11-05', kind: 'official', title: '중간발표' })], m);
    expect(summary.nextTask?.id).toBe('step');
    expect(summary.nearestDue).toEqual({ date: '2026-11-05', label: '중간발표', kind: 'official' });
  });

  it('reports a real zero when nothing is linked', () => {
    expect(summarizeProject('empty', [task('x')])).toEqual({ remaining: 0, done: 0, nextTask: null, nearestDue: null });
  });
});

it('projectTaskBuckets marks overdue and near tasks as due soon', () => {
  const buckets = projectTaskBuckets('thesis', [task('late', { due_date: '2026-10-20' }), task('soon', { due_date: '2026-10-30' }), task('later', { due_date: '2026-12-01' })], '2026-10-25');
  expect(buckets.dueSoon.map((t) => t.id)).toEqual(['late', 'soon']);
});

it('unmatched project links are reported, not reassigned', () => {
  expect(unmatchedProjectLinks([task('a', { project_id: 'ghost' }), task('b')], ['thesis']).map((t) => t.id)).toEqual(['a']);
});

describe('calendar focus slots', () => {
  it('merges overlapping busy time', () => {
    expect(mergeIntervals([{ start: 0, end: 10 }, { start: 5, end: 20 }, { start: 20, end: 25 }, { start: 30, end: 40 }])).toEqual([{ start: 0, end: 25 }, { start: 30, end: 40 }]);
  });

  it('finds 15–60 minute windows between busy blocks in Tokyo time', () => {
    const busy = [
      { start: '2026-10-26T09:30:00+09:00', end: '2026-10-26T10:30:00+09:00' },
      { start: '2026-10-26T10:00:00+09:00', end: '2026-10-26T12:00:00+09:00' },
      { start: '2026-10-26T12:10:00+09:00', end: '2026-10-26T21:00:00+09:00' },
      { start: '2026-10-26T00:00:00+09:00', end: '2026-10-27T00:00:00+09:00', allDay: true },
    ];
    const slots = focusSlots(busy, '2026-10-26', Date.parse('2026-10-26T08:00:00+09:00'));
    expect(slots).toEqual([
      { start: '09:00', end: '09:30', minutes: 30 },
      { start: '21:00', end: '22:00', minutes: 60 },
    ]);
  });

  it('never suggests time in the past', () => {
    const slots = focusSlots([], '2026-10-26', Date.parse('2026-10-26T21:40:00+09:00'));
    expect(slots).toEqual([{ start: '21:40', end: '22:00', minutes: 20 }]);
  });
});

describe('recurrence', () => {
  it('fixed schedules step from the anchor, not from completion', () => {
    expect(nextDueDate({ mode: 'fixed', every_days: 7, anchor_date: '2026-10-05' }, '2026-10-19', '2026-10-25')).toBe('2026-10-26');
  });
  it('after-completion schedules count from the completion day', () => {
    expect(nextDueDate({ mode: 'after_completion', every_days: 3, anchor_date: null }, '2026-10-19', '2026-10-25')).toBe('2026-10-28');
  });
  it('only open fixed occurrences past due are missed', () => {
    const rule = meta('t', { recur: { mode: 'fixed', every_days: 7, anchor_date: '2026-10-01' } });
    expect(isMissedOccurrence(task('t', { due_date: '2026-10-20' }), rule, '2026-10-25')).toBe(true);
    expect(isMissedOccurrence(task('t', { due_date: '2026-10-20', status: 'done' }), rule, '2026-10-25')).toBe(false);
  });
});

it('home hides snoozed tasks and anything already shown in focus', () => {
  const hidden = homeHiddenIds([task('a'), task('b'), task('c')], new Map([['a', meta('a', { snooze_until: '2026-10-28' })], ['b', meta('b', { snooze_until: '2026-10-25' })]]), '2026-10-25', ['c']);
  expect([...hidden].sort()).toEqual(['a', 'c']);
});

it('nextStep follows step order and never completes the parent by itself', () => {
  const tasks = [task('s2'), task('s1', { status: 'done' }), task('s3')];
  const m = new Map([['s1', meta('s1', { parent_task_id: 'p', step_order: 1 })], ['s2', meta('s2', { parent_task_id: 'p', step_order: 2 })], ['s3', meta('s3', { parent_task_id: 'p', step_order: 3 })]]);
  expect(nextStep('p', tasks, m)).toMatchObject({ next: { id: 's2' }, total: 3, done: 1, allDone: false });
  expect(nextStep('p', tasks.map((t) => ({ ...t, status: 'done' as const })), m).allDone).toBe(true);
});

it('blockDiff shows paragraph additions and removals', () => {
  expect(blockDiff('# 노트\n\n기존 문단\n\n지울 문단', '# 노트\n\n기존 문단\n\n새 문단')).toEqual([
    { kind: 'same', text: '# 노트' }, { kind: 'same', text: '기존 문단' }, { kind: 'added', text: '새 문단' }, { kind: 'removed', text: '지울 문단' },
  ]);
});

it('localSearch matches task text and project fields', () => {
  const result = localSearch('투입산출', [task('a', { title: '투입산출표 정리' }), task('b')], [{ id: 'thesis', title: '석사', questions: ['투입산출 분석'] }]);
  expect(result.tasks.map((t) => t.id)).toEqual(['a']);
  expect(result.projects.map((p) => p.id)).toEqual(['thesis']);
});
