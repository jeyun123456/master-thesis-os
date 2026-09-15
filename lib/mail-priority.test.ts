import { describe, expect, it } from 'vitest';
import {
  classifyMailPriority,
  mailPriorityLabel,
  prioritizeMails,
  type MailPriorityInput,
} from './mail-priority';

type MailFixture = MailPriorityInput & { id: string };

function mail(overrides: Partial<MailFixture> = {}): MailFixture {
  return {
    id: 'mail',
    subject: '일반 안내',
    senderName: '정보 안내',
    senderAddress: 'notice@example.edu',
    receivedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    isRead: true,
    ...overrides,
  };
}

describe('mail priority rules', () => {
  it('classifies fresh deadline keywords as critical', () => {
    expect(classifyMailPriority(mail({ subject: '내일 제출 deadline 안내', isRead: false }))).toMatchObject({
      priority: 'critical',
      category: 'deadline',
    });
    expect(mailPriorityLabel('critical')).toBe('긴급');
  });

  it('classifies presentation, meeting, and research keywords as important', () => {
    expect(classifyMailPriority(mail({ subject: '中間発表について' })).priority).toBe('important');
    expect(classifyMailPriority(mail({ subject: '세미나 안내' })).priority).toBe('important');
    expect(classifyMailPriority(mail({ subject: '面談日程について' })).priority).toBe('important');
    expect(classifyMailPriority(mail({ subject: 'Research thesis meeting' })).priority).toBe('important');
    expect(mailPriorityLabel('important')).toBe('중요');
  });

  it('supports Korean, Japanese, and English rules', () => {
    expect(classifyMailPriority(mail({ subject: '논문 연구 계획' })).category).toBe('research');
    expect(classifyMailPriority(mail({ subject: '提出期限のお知らせ' })).category).toBe('deadline');
    expect(classifyMailPriority(mail({ subject: 'Professor meeting' })).category).toBe('meeting');
  });

  it('keeps simple notices, newsletters, and school-domain-only senders normal', () => {
    expect(classifyMailPriority(mail({ subject: 'RAINBOW メンテナンスのお知らせ' })).priority).toBe('normal');
    expect(classifyMailPriority(mail({ subject: 'Campus newsletter', senderAddress: 'office@ed.ritsumei.ac.jp' })).priority).toBe('normal');
    expect(classifyMailPriority(mail({ subject: 'Today campus newsletter' })).priority).toBe('normal');
  });

  it('does not change priority solely because a message is unread', () => {
    const read = classifyMailPriority(mail({ subject: '연구 안내', isRead: true }));
    const unread = classifyMailPriority(mail({ subject: '연구 안내', isRead: false }));
    expect(unread.priority).toBe(read.priority);
    expect(unread.category).toBe(read.category);
  });

  it('orders unread and priority combinations before older messages', () => {
    const items = [
      mail({ id: 'normal-unread', isRead: false, receivedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString() }),
      mail({ id: 'critical-read', subject: '오늘 제출 기한', isRead: true, receivedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() }),
      mail({ id: 'important-unread', subject: '面談日程', isRead: false, receivedAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString() }),
      mail({ id: 'critical-unread', subject: '오늘 제출 기한', isRead: false, receivedAt: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString() }),
    ];
    expect(prioritizeMails(items).map((item) => item.id)).toEqual([
      'critical-unread',
      'important-unread',
      'critical-read',
      'normal-unread',
    ]);
  });

  it('sorts older important messages after newer messages of the same grade', () => {
    const items = [
      mail({ id: 'old-research', subject: '연구 계획', receivedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString() }),
      mail({ id: 'recent-meeting', subject: 'Meeting schedule', receivedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() }),
    ];
    expect(prioritizeMails(items).map((item) => item.id)).toEqual(['recent-meeting', 'old-research']);
  });

  it('handles invalid dates and never returns more than five messages', () => {
    expect(() => classifyMailPriority(mail({ subject: 'deadline', receivedAt: 'not-a-date' }))).not.toThrow();
    const items = Array.from({ length: 10 }, (_, index) => mail({ id: `mail-${index}`, receivedAt: new Date(Date.now() - index * 60_000).toISOString() }));
    expect(prioritizeMails(items, 20)).toHaveLength(5);
  });
});
