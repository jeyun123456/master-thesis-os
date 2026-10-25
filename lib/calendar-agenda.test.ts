import { describe, expect, it } from 'vitest';
import type { CalendarEvent } from './calendar';
import { agendaDayLabel, overlappingEventIds } from './calendar-agenda';

function event(patch: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: 'e', title: 't', start: '2026-10-27T10:00:00+09:00', end: '2026-10-27T11:00:00+09:00', allDay: false,
    description: '', location: '', calendarId: 'c', htmlLink: '', status: 'confirmed', category: 'Other', ...patch,
  };
}

describe('overlappingEventIds', () => {
  it('marks only timed events whose ranges intersect on the same day', () => {
    const ids = overlappingEventIds([
      event({ id: 'a' }),
      event({ id: 'b', start: '2026-10-27T10:30:00+09:00', end: '2026-10-27T12:00:00+09:00' }),
      event({ id: 'c', start: '2026-10-27T11:00:00+09:00', end: '2026-10-27T12:00:00+09:00' }),
      event({ id: 'd', start: '2026-10-28T10:00:00+09:00', end: '2026-10-28T11:00:00+09:00' }),
      event({ id: 'all', start: '2026-10-27', end: '2026-10-28', allDay: true }),
    ]);
    expect([...ids].sort()).toEqual(['a', 'b', 'c']);
  });
});

describe('agendaDayLabel', () => {
  it('names today and tomorrow and counts later days', () => {
    expect(agendaDayLabel('2026-10-25', '2026-10-25')).toBe('오늘 · 10월 25일 (일)');
    expect(agendaDayLabel('2026-10-26', '2026-10-25')).toBe('내일 · 10월 26일 (월)');
    expect(agendaDayLabel('2026-10-28', '2026-10-25')).toBe('10월 28일 (수) · D-3');
  });
});
