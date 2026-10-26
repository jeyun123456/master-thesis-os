import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CalendarEvent } from '@/lib/calendar';
import type { CalendarApiResponse } from '@/lib/client-api';
import { CalendarAgenda } from './calendar-agenda';

const now = new Date('2026-10-27T01:00:00Z');

function event(patch: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: 'e', title: '세미나', start: '2026-10-27T10:00:00+09:00', end: '2026-10-27T11:00:00+09:00', allDay: false,
    description: '', location: '', calendarId: 'c', htmlLink: 'https://calendar.example/e', status: 'confirmed', category: 'Meeting', ...patch,
  };
}

function calendar(patch: Partial<CalendarApiResponse>): CalendarApiResponse {
  return { configured: true, state: 'ready', calendarId: 'c', timezone: 'Asia/Seoul', range: { days: 14, timeMin: '', timeMax: '' }, items: [], ...patch };
}

describe('CalendarAgenda', () => {
  it('puts today first, flags overlaps and says candidates are not shown', () => {
    const html = renderToStaticMarkup(<CalendarAgenda now={now} stateText="" calendar={calendar({ items: [
      event({ id: 'later', start: '2026-10-29T09:00:00+09:00', end: '2026-10-29T10:00:00+09:00', title: '나중' }),
      event({ id: 'a' }),
      event({ id: 'b', title: '겹치는 회의', start: '2026-10-27T10:30:00+09:00', end: '2026-10-27T12:00:00+09:00' }),
    ] })} />);
    expect(html.indexOf('오늘 · 10월 27일')).toBeLessThan(html.indexOf('나중'));
    expect(html).toContain('다른 일정과 시간이 겹쳐요');
    expect(html).toContain('Google Calendar에서 열기');
    expect(html).toContain('확정된 일정만');
  });
  it('separates a failed lookup from a real zero', () => {
    const failed = renderToStaticMarkup(<CalendarAgenda now={now} stateText="Calendar 네트워크 연결을 확인해줘." calendar={calendar({ state: 'error' })} />);
    expect(failed).toContain('조회에 실패한 상태');
    expect(failed).toContain('진단 정보');
    const empty = renderToStaticMarkup(<CalendarAgenda now={now} stateText="오늘부터 14일 안에 일정이 없어." calendar={calendar({ state: 'empty' })} />);
    expect(empty).toContain('14일 안에 일정이 없어');
    expect(empty).not.toContain('조회에 실패');
  });
});
