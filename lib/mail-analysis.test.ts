import { describe, expect, it } from 'vitest';
import {
  mailCalendarCandidateId,
  normalizeMailAnalysis,
  normalizeMailCalendarCandidate,
  type MailCalendarCandidate,
} from './mail-analysis';

const now = new Date('2026-09-18T12:00:00+09:00');

describe('mail analysis shape helpers', () => {
  it('keeps valid future candidates and removes past or invalid dates', () => {
    const result = normalizeMailAnalysis({
      summary: '발표 일정을 안내한다. 참석 준비가 필요하다.',
      action: '발표 자료를 준비한다.',
      calendarCandidates: [
        { title: '지난 일정', start: '2026-09-16', end: null, allDay: true, type: 'event', reason: '과거' },
        { title: '발표', start: '2026-09-20T14:00:00+09:00', end: '2026-09-20T15:00:00+09:00', allDay: false, type: 'event', reason: '참석 일정' },
        { title: '잘못된 날짜', start: '2026-99-99', end: null, allDay: true, type: 'deadline', reason: '오류' },
      ],
    }, now);
    expect(result).toEqual({
      summary: '발표 일정을 안내한다. 참석 준비가 필요하다.',
      action: '발표 자료를 준비한다.',
      calendarCandidates: [{
        title: '발표',
        start: '2026-09-20T14:00:00+09:00',
        end: '2026-09-20T15:00:00+09:00',
        allDay: false,
        type: 'event',
        reason: '참석 일정',
      }],
    });
  });

  it('interprets timezone-less timed values as Asia/Seoul', () => {
    expect(normalizeMailCalendarCandidate({
      title: '과거 일정',
      start: '2026-09-18T03:30',
      end: null,
      allDay: false,
      type: 'event',
      reason: '시간',
    }, now)).toBeNull();
  });

  it('does not invent values when the structured response is malformed', () => {
    expect(normalizeMailAnalysis({ action: null }, now)).toEqual({ summary: '', action: null, calendarCandidates: [] });
  });

  it('uses deterministic IDs from mail ID, candidate index, and shape', () => {
    const candidate: MailCalendarCandidate = {
      title: '발표',
      start: '2026-09-20',
      end: null,
      allDay: true,
      type: 'event',
      reason: '참석 일정',
    };
    expect(mailCalendarCandidateId('mail-1', candidate, 0)).toBe(mailCalendarCandidateId('mail-1', candidate, 0));
    expect(mailCalendarCandidateId('mail-1', candidate, 0)).not.toBe(mailCalendarCandidateId('mail-2', candidate, 0));
  });
});
