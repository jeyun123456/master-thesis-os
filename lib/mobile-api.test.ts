import { describe, expect, it } from 'vitest';
import { mobileBearerToken, toMobileEvents, toMobileTasks } from './mobile-api';
import type { CalendarEvent } from './calendar';
import type { P0Task } from './p0-tasks-client';

function task(id: string, patch: Partial<P0Task> = {}): P0Task {
  return {
    id, title: id, status: 'open', due_date: null, is_today: false, category: 'personal', project_id: null, memo: 'secret memo',
    source_url: null, version: 2, created_at: `2026-10-${id.length + 10}T00:00:00Z`, updated_at: '', completed_at: null, deleted: false, ...patch,
  };
}

function event(id: string, patch: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id, title: id, start: '2026-11-01T10:00:00+09:00', end: '2026-11-01T11:00:00+09:00', allDay: false, description: 'private', location: '',
    calendarId: 'c', htmlLink: 'x', status: 'confirmed', category: 'Other', ...patch,
  };
}

describe('mobile api helpers', () => {
  it('accepts only a well-formed Bearer header', () => {
    const req = (value?: string) => new Request('https://x.test', { headers: value ? { authorization: value } : {} });
    expect(mobileBearerToken(req('Bearer abcdefgh12345'))).toBe('abcdefgh12345');
    expect(mobileBearerToken(req())).toBe('');
    expect(mobileBearerToken(req('Basic abcdefgh12345'))).toBe('');
    expect(mobileBearerToken(req('Bearer short'))).toBe('');
  });

  it('picks focus, then overdue, then due-today tasks without duplicates and without memo', () => {
    const result = toMobileTasks([
      task('a', { due_date: '2026-11-01' }),
      task('b', { is_today: true, due_date: '2026-11-01' }),
      task('c', { due_date: '2026-10-28' }),
      task('d', { due_date: '2026-12-01' }),
      task('e', { status: 'done', completed_at: '2026-11-01T01:00:00Z' }),
    ], '2026-11-01');
    expect(result.items.map((item) => item.id)).toEqual(['b', 'c', 'a']);
    expect(result).toMatchObject({ openCount: 4, overdueCount: 1, doneTodayCount: 1 });
    expect(JSON.stringify(result)).not.toContain('secret memo');
  });

  it('puts all-day events first, drops cancelled ones and private fields', () => {
    const result = toMobileEvents([
      event('late', { start: '2026-11-01T15:00:00+09:00' }),
      event('gone', { status: 'cancelled' }),
      event('all', { allDay: true, start: '2026-11-01' }),
      event('early'),
    ]);
    expect(result.map((item) => item.id)).toEqual(['all', 'early', 'late']);
    expect(JSON.stringify(result)).not.toContain('private');
  });
});
