import { describe, expect, it } from 'vitest';
import type { PrioritizedMail } from './mail-priority';
import {
  createMailActionCandidate,
  createMailActionCandidates,
  extractSubjectDueDate,
  filterDismissedMailActions,
  isMailActionOverdue,
  mailActionCandidateId,
  mailActionTypeLabel,
  type MailActionCandidate,
} from './mail-action';

const now = new Date('2026-09-15T12:00:00+09:00');

function mail(overrides: Partial<PrioritizedMail> = {}): PrioritizedMail {
  return {
    id: 'mail-1',
    subject: '일반 안내',
    senderName: '정보 안내',
    senderAddress: 'notice@example.edu',
    receivedAt: '2026-09-15T01:00:00Z',
    isRead: true,
    priority: 'important',
    category: 'other',
    ...overrides,
  };
}

function candidate(overrides: Partial<MailActionCandidate> = {}): MailActionCandidate {
  return {
    id: mailActionCandidateId('mail-1'),
    mailId: 'mail-1',
    title: '확인 필요',
    type: 'review',
    priority: 'important',
    reason: '중요 메일 확인 필요',
    receivedAt: '2026-09-15T01:00:00Z',
    ...overrides,
  };
}

describe('mail action candidates', () => {
  it('maps priority categories to action candidates and skips normal mail', () => {
    expect(createMailActionCandidate(mail({ priority: 'critical', category: 'deadline', subject: '9/18 제출' }), now)).toMatchObject({
      type: 'deadline',
      priority: 'critical',
      dueAt: '2026-09-18',
      reason: '제출·마감 관련 메일',
    });
    expect(createMailActionCandidate(mail({ category: 'meeting', subject: '면담 일정' }), now)?.type).toBe('meeting');
    expect(createMailActionCandidate(mail({ category: 'presentation', subject: '발표 자료' }), now)?.type).toBe('presentation');
    expect(createMailActionCandidate(mail({ category: 'research', subject: '논문 연구' }), now)?.type).toBe('research');
    expect(createMailActionCandidate(mail({ category: 'academic', subject: '履修 확인' }), now)?.type).toBe('academic');
    expect(createMailActionCandidate(mail({ category: 'administrative', subject: '학무 안내' }), now)?.type).toBe('administrative');
    expect(createMailActionCandidate(mail({ category: 'other' }), now)?.type).toBe('review');
    expect(createMailActionCandidate(mail({ priority: 'normal' }), now)).toBeNull();
    expect(createMailActionCandidate(mail({ category: 'research', subject: '논문 검토', messageId: '<research@example.edu>' }), now)).toMatchObject({
      type: 'research',
      messageId: '<research@example.edu>',
    });
    expect(mailActionTypeLabel('deadline')).toBe('마감');
    expect(mailActionTypeLabel('meeting')).toBe('면담·미팅');
  });

  it('extracts supported explicit date formats', () => {
    expect(extractSubjectDueDate('발표 9/18 제출', now)).toBe('2026-09-18');
    expect(extractSubjectDueDate('발표 9월 18일 제출', now)).toBe('2026-09-18');
    expect(extractSubjectDueDate('発表 9月18日 提出', now)).toBe('2026-09-18');
    expect(extractSubjectDueDate('Due Sep 18', now)).toBe('2026-09-18');
    expect(extractSubjectDueDate('Due September 18', now)).toBe('2026-09-18');
    expect(extractSubjectDueDate('2026.09.18 提出', now)).toBe('2026-09-18');
    expect(extractSubjectDueDate('2026-09-18 提出', now)).toBe('2026-09-18');
    expect(extractSubjectDueDate('2026年9月18日 提出', now)).toBe('2026-09-18');
  });

  it('extracts relative dates and rolls yearless dates into the next year', () => {
    expect(extractSubjectDueDate('오늘 제출', now)).toBe('2026-09-15');
    expect(extractSubjectDueDate('today deadline', now)).toBe('2026-09-15');
    expect(extractSubjectDueDate('本日締切', now)).toBe('2026-09-15');
    expect(extractSubjectDueDate('내일 제출', now)).toBe('2026-09-16');
    expect(extractSubjectDueDate('tomorrow due', now)).toBe('2026-09-16');
    expect(extractSubjectDueDate('明日提出', now)).toBe('2026-09-16');
    expect(extractSubjectDueDate('모레 제출', now)).toBe('2026-09-17');
    expect(extractSubjectDueDate('明後日締切', now)).toBe('2026-09-17');
    expect(extractSubjectDueDate('1/15 제출', new Date('2026-12-20T12:00:00+09:00'))).toBe('2027-01-15');
  });

  it('does not invent a due date for invalid or non-deadline subjects', () => {
    expect(extractSubjectDueDate('2026-99-99 제출', now)).toBeUndefined();
    expect(createMailActionCandidate(mail({ category: 'deadline', subject: '제출 일정 확인' }), now)?.dueAt).toBeUndefined();
    expect(createMailActionCandidate(mail({ category: 'meeting', subject: '9/18 면담 일정' }), now)?.dueAt).toBeUndefined();
  });

  it('sorts due critical, due important, then undated candidates by recency', () => {
    const items = [
      mail({ id: 'critical-no-due', priority: 'critical', category: 'other', subject: 'urgent 확인', receivedAt: '2026-09-15T04:00:00Z' }),
      mail({ id: 'important-no-due', priority: 'important', category: 'meeting', subject: '면담 확인', receivedAt: '2026-09-15T05:00:00Z' }),
      mail({ id: 'important-due', priority: 'important', category: 'deadline', subject: '9/17 제출', receivedAt: '2026-09-15T01:00:00Z' }),
      mail({ id: 'critical-due-late', priority: 'critical', category: 'deadline', subject: '9/19 제출', receivedAt: '2026-09-15T02:00:00Z' }),
      mail({ id: 'critical-due-near', priority: 'critical', category: 'deadline', subject: '9/16 제출', receivedAt: '2026-09-15T03:00:00Z' }),
    ];
    expect(createMailActionCandidates(items, { now }).map((item) => item.mailId)).toEqual([
      'critical-due-near',
      'critical-due-late',
      'important-due',
      'critical-no-due',
      'important-no-due',
    ]);
  });

  it('filters dismissed ids and limits the result to five', () => {
    const items = Array.from({ length: 7 }, (_, index) => mail({
      id: `mail-${index}`,
      category: 'meeting',
      subject: `면담 ${index}`,
      receivedAt: new Date(now.getTime() - index * 60_000).toISOString(),
    }));
    const result = createMailActionCandidates(items, {
      now,
      dismissedIds: [mailActionCandidateId('mail-0')],
      limit: 20,
    });
    expect(result).toHaveLength(5);
    expect(result.some((item) => item.mailId === 'mail-0')).toBe(false);
    expect(filterDismissedMailActions([candidate()], ['mail-1'])).toHaveLength(0);
  });

  it('marks past due dates without changing candidate priority', () => {
    const item = candidate({ dueAt: '2026-09-14', priority: 'critical', type: 'deadline' });
    expect(isMailActionOverdue(item, now)).toBe(true);
    expect(isMailActionOverdue(candidate({ dueAt: '2026-09-15' }), now)).toBe(false);
  });
});
