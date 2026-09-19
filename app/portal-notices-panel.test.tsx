import { describe, expect, it } from 'vitest';
import {
  filterPortalNotices,
  formatPortalNoticeDate,
  formatPortalSyncDate,
  portalNoticeErrorMessage,
  portalNoticeStatusLabel,
} from './portal-notices-panel';
import { PortalNoticesClientError, type PortalNoticeSummary } from '../lib/portal-notices-client';

function notice(overrides: Partial<PortalNoticeSummary>): PortalNoticeSummary {
  return {
    noticeId: 'notice-1',
    type: 'ALL',
    title: '공지',
    department: '教学推進課',
    publishedAt: '2026-09-18T09:00:00Z',
    expiresAt: '',
    deadline: '',
    importance: '',
    category: '',
    sourceUrl: '',
    syncedAt: '2026-09-18T09:00:00Z',
    lastChangedAt: null,
    changeCount: 0,
    isRead: false,
    isImportant: false,
    isArchived: false,
    firstSeenAt: '2026-09-18T09:00:00Z',
    readAt: null,
    stateUpdatedAt: '2026-09-18T09:00:00Z',
    attachments: [],
    ...overrides,
  };
}

describe('학교 공지 panel helpers', () => {
  it('formats persisted timestamps for the Korean local timezone', () => {
    expect(formatPortalSyncDate('2026-09-18T14:00:00Z')).toBe('2026-09-18 23:00');
    expect(formatPortalNoticeDate('2026-09-18T14:00:00Z')).toBe('2026-09-18 23:00');
    expect(formatPortalNoticeDate('2026/09/18 18:00')).toContain('2026-09-18');
    expect(formatPortalSyncDate(null)).toBe('아직 동기화하지 않음');
  });

  it('labels session and sync states', () => {
    expect(portalNoticeStatusLabel('completed', 'saved')).toBe('세션 유지됨');
    expect(portalNoticeStatusLabel('running', 'saved')).toBe('동기화 중');
    expect(portalNoticeStatusLabel('idle', 'login_required')).toBe('로그인 필요');
    expect(portalNoticeStatusLabel('idle', 'session_expired')).toBe('세션 만료');
  });

  it('maps stable bridge error codes to actionable Korean messages', () => {
    expect(portalNoticeErrorMessage(new PortalNoticesClientError('session_expired', 'raw'))).toContain('세션이 만료');
    expect(portalNoticeErrorMessage(new PortalNoticesClientError('parsing_failed', 'raw'))).toContain('portal-debug.log');
  });

  it('filters notices by type, read state, user importance, archive state, and department', () => {
    const items = [
      notice({ noticeId: 'all-unread', department: '教学推進課' }),
      notice({ noticeId: 'all-important', isRead: true, isImportant: true, department: '経済学部事務室' }),
      notice({ noticeId: 'dm-archived', type: 'DM', isRead: true, isArchived: true, department: '' }),
    ];
    expect(filterPortalNotices(items, 'ALL', 'unread').map((item) => item.noticeId)).toEqual(['all-unread']);
    expect(filterPortalNotices(items, 'ALL', 'important').map((item) => item.noticeId)).toEqual(['all-important']);
    expect(filterPortalNotices(items, 'DM', 'archived').map((item) => item.noticeId)).toEqual(['dm-archived']);
    expect(filterPortalNotices(items, 'ALL', 'all', '経済学部事務室').map((item) => item.noticeId)).toEqual(['all-important']);
    expect(filterPortalNotices(items, 'DM', 'all', '__unknown__').map((item) => item.noticeId)).toEqual(['dm-archived']);
  });
});
