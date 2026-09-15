import { describe, expect, it } from 'vitest';
import {
  schoolMailIndicator,
  schoolMailRowKey,
  schoolMailRowClass,
  schoolMailStateMessage,
  schoolMailStatusLabel,
} from './school-mail-panel';

describe('School mail panel states', () => {
  it('labels ready, empty, offline, and sync-required states', () => {
    expect(schoolMailStatusLabel('ready', null)).toBe('Thunderbird ● 로컬');
    expect(schoolMailStatusLabel('empty', null)).toBe('Thunderbird ● 로컬');
    expect(schoolMailStatusLabel('bridge_offline', 'bridge_offline')).toBe('브리지 오프라인');
    expect(schoolMailStatusLabel('sync_required', 'local_sync_required')).toBe('동기화 필요');
    expect(schoolMailStateMessage('local_sync_required')).toContain('이 컴퓨터에 보관');
  });

  it('keeps unread and read rendering distinct', () => {
    expect(schoolMailRowClass(false)).toBe('microsoft-mail-row unread');
    expect(schoolMailRowClass(true)).toBe('microsoft-mail-row');
    expect(schoolMailIndicator(false)).toBe('●');
    expect(schoolMailIndicator(true)).toBe('○');
  });

  it('keeps row keys unique when a provider repeats an id', () => {
    const item = {
      id: 'duplicate-id',
      subject: 'Test',
      senderName: 'Sender',
      senderAddress: 'sender@example.edu',
      receivedAt: '2026-09-15T01:10:00Z',
      isRead: false,
    };
    expect(schoolMailRowKey(item, 0)).not.toBe(schoolMailRowKey(item, 1));
  });
});
