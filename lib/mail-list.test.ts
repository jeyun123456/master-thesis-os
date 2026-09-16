import { describe, expect, it } from 'vitest';
import type { PrioritizedMail } from './mail-priority';
import {
  clampMailVisibleCount,
  filterAndSortMailItems,
  filterMailItems,
  INITIAL_MAIL_VISIBLE_COUNT,
  nextMailVisibleCount,
  readMailListPreferences,
  sortMailItems,
} from './mail-list';

function mail(overrides: Partial<PrioritizedMail> = {}): PrioritizedMail {
  return {
    id: 'mail',
    subject: '일반 안내',
    senderName: '정보 안내',
    senderAddress: 'notice@example.edu',
    receivedAt: '2026-09-15T01:00:00Z',
    isRead: true,
    priority: 'normal',
    category: 'other',
    ...overrides,
  };
}

describe('mail list search, filters, sorting, and visibility', () => {
  const items = [
    mail({ id: 'critical-old', subject: '제출 기한', senderName: '松尾先生', senderAddress: 'matsuo@example.edu', receivedAt: '2026-09-15T01:00:00Z', priority: 'critical', category: 'deadline', isRead: true }),
    mail({ id: 'important-new', subject: 'Meeting schedule', senderName: 'Research Office', senderAddress: 'office@example.edu', receivedAt: '2026-09-15T03:00:00Z', priority: 'important', category: 'meeting', isRead: false }),
    mail({ id: 'normal-new', subject: 'Campus notice', senderName: 'Information Desk', senderAddress: 'NOTICE@EXAMPLE.EDU', receivedAt: '2026-09-15T04:00:00Z', isRead: false }),
  ];

  it('searches subject, sender name, and sender address case-insensitively after trimming', () => {
    expect(filterMailItems(items, 'all', '  MEETING ')).toHaveLength(1);
    expect(filterMailItems(items, 'all', '松尾')).toHaveLength(1);
    expect(filterMailItems(items, 'all', 'notice@example.edu')).toHaveLength(1);
    expect(filterMailItems(items, 'all', '   ')).toHaveLength(3);
  });

  it('applies all, unread, important, and critical filters', () => {
    expect(filterMailItems(items, 'all').map((item) => item.id)).toEqual(['critical-old', 'important-new', 'normal-new']);
    expect(filterMailItems(items, 'unread').map((item) => item.id)).toEqual(['important-new', 'normal-new']);
    expect(filterMailItems(items, 'important').map((item) => item.id)).toEqual(['critical-old', 'important-new']);
    expect(filterMailItems(items, 'critical').map((item) => item.id)).toEqual(['critical-old']);
  });

  it('sorts by newest by default and by priority with received-time ties', () => {
    expect(sortMailItems(items, 'newest').map((item) => item.id)).toEqual(['normal-new', 'important-new', 'critical-old']);
    expect(sortMailItems(items, 'priority').map((item) => item.id)).toEqual(['critical-old', 'important-new', 'normal-new']);
    const tied = [
      mail({ id: 'important-older', priority: 'important', receivedAt: '2026-09-15T01:00:00Z' }),
      mail({ id: 'important-newer', priority: 'important', receivedAt: '2026-09-15T02:00:00Z' }),
    ];
    expect(sortMailItems(tied, 'priority').map((item) => item.id)).toEqual(['important-newer', 'important-older']);
  });

  it('combines query, filter, and sort without mutating the source array', () => {
    const result = filterAndSortMailItems(items, { filter: 'important', query: '  meeting ', sort: 'priority' });
    expect(result.map((item) => item.id)).toEqual(['important-new']);
    expect(items.map((item) => item.id)).toEqual(['critical-old', 'important-new', 'normal-new']);
  });

  it('reveals messages in twenty-item increments and caps visibility at one hundred', () => {
    expect(INITIAL_MAIL_VISIBLE_COUNT).toBe(20);
    expect(nextMailVisibleCount(20)).toBe(40);
    expect(nextMailVisibleCount(80)).toBe(100);
    expect(nextMailVisibleCount(100)).toBe(100);
    expect(clampMailVisibleCount(0)).toBe(20);
    expect(clampMailVisibleCount(150)).toBe(100);
    expect(clampMailVisibleCount('40')).toBe(20);
  });

  it('restores only non-sensitive list preferences from storage data', () => {
    expect(readMailListPreferences(JSON.stringify({ query: 'paper', filter: 'critical', sort: 'priority', visibleCount: 60 }))).toEqual({
      query: 'paper',
      filter: 'critical',
      sort: 'priority',
      visibleCount: 60,
    });
    expect(readMailListPreferences(JSON.stringify({ subject: 'must not persist', filter: 'unknown', visibleCount: 999 }))).toEqual({
      query: '',
      filter: 'all',
      sort: 'newest',
      visibleCount: 100,
    });
    expect(readMailListPreferences('{')).toEqual({
      query: '',
      filter: 'all',
      sort: 'newest',
      visibleCount: 20,
    });
  });
});
