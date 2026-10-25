import { describe, expect, it } from 'vitest';
import { buildP0HomeView, p0TodayInTokyo } from './p0-home';
import type { P0Task } from './p0-tasks-client';

const task = (id: string, values: Partial<P0Task> = {}): P0Task => ({
  id,
  title: id,
  status: 'open',
  due_date: null,
  is_today: false,
  category: 'unclassified',
  project_id: null,
  memo: '',
  source_url: null,
  version: 1,
  created_at: `2026-10-20T0${id.length}:00:00.000Z`,
  updated_at: '2026-10-20T00:00:00.000Z',
  completed_at: null,
  deleted: false,
  ...values,
});

describe('P0 home view', () => {
  const today = '2026-10-23';

  it('pins today-focus tasks, groups due work in order, and avoids duplicating focus items', () => {
    const tasks = [
      task('none'),
      task('later', { due_date: '2026-11-01' }),
      task('due-today', { due_date: today }),
      task('late', { due_date: '2026-10-20' }),
      task('focus', { is_today: true, due_date: '2026-10-20' }),
    ];
    const view = buildP0HomeView(tasks, today);
    expect(view.focus.map(({ id }) => id)).toEqual(['focus']);
    expect(view.groups.map(({ id, tasks: group }) => [id, group.map(({ id: taskId }) => taskId)])).toEqual([
      ['overdue', ['late']],
      ['today', ['due-today']],
      ['upcoming', ['later']],
      ['unscheduled', ['none']],
    ]);
  });

  it('filters categories, tracks server-side new markers, and folds completions by Tokyo day', () => {
    const tasks = [
      task('new-unclassified', { is_new: true }),
      task('research', { category: 'research' }),
      task('done-today', { status: 'done', completed_at: '2026-10-22T15:15:00.000Z' }),
      task('done-yesterday', { status: 'done', completed_at: '2026-10-22T14:55:00.000Z' }),
    ];
    const view = buildP0HomeView(tasks, today, 'unclassified');
    expect(view.newTasks.map(({ id }) => id)).toEqual(['new-unclassified']);
    expect(view.doneToday.map(({ id }) => id)).toEqual(['done-today']);
    expect(view.openCount).toBe(1);
  });

  it('uses the Asia/Tokyo calendar date at UTC midnight boundaries', () => {
    expect(p0TodayInTokyo(new Date('2026-10-22T15:15:00.000Z'))).toBe('2026-10-23');
    expect(p0TodayInTokyo(new Date('2026-10-22T14:55:00.000Z'))).toBe('2026-10-22');
  });
});
