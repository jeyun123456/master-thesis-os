import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CalendarEvent } from '@/lib/calendar';
import { DeadlineStrip } from './planner-panel';

function ev(patch: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: 'e', title: '제출', start: '2026-10-30', end: '2026-10-31', allDay: true, description: '', location: '',
    calendarId: 'c', htmlLink: '', status: 'confirmed', category: 'Deadline', ...patch,
  };
}

describe('Planner DeadlineStrip', () => {
  it('lists only upcoming Deadline events, nearest first, capped at three', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-27T01:00:00Z'));
    const html = renderToStaticMarkup(<DeadlineStrip loading={false} failed={false} events={[
      ev({ id: 'late', title: '늦은 마감', start: '2026-11-20' }),
      ev({ id: 'soon', title: '가까운 마감', start: '2026-10-29' }),
      ev({ id: 'past', title: '지난 마감', start: '2026-10-01' }),
      ev({ id: 'meeting', title: '회의', category: 'Meeting', start: '2026-10-28' }),
    ]} />);
    vi.useRealTimers();
    expect(html.indexOf('가까운 마감')).toBeGreaterThan(-1);
    expect(html.indexOf('가까운 마감')).toBeLessThan(html.indexOf('늦은 마감'));
    expect(html).not.toContain('지난 마감');
    expect(html).not.toContain('회의');
    expect(html).toContain('D-2');
  });
  it('renders nothing while loading, after a failure, or without deadlines', () => {
    expect(renderToStaticMarkup(<DeadlineStrip loading failed={false} events={[ev({})]} />)).toBe('');
    expect(renderToStaticMarkup(<DeadlineStrip loading={false} failed events={[ev({})]} />)).toBe('');
    expect(renderToStaticMarkup(<DeadlineStrip loading={false} failed={false} events={[]} />)).toBe('');
  });
});
