import { describe, expect, it } from 'vitest';
import {
  defaultMailFolders,
  mailFolderTabLabel,
  mailPanelStateMessage,
  mailPanelStatusLabel,
  MAIL_FOLDER_TAB_IDS,
} from './mail-panel';

describe('Thunderbird folder mail panel', () => {
  it('keeps the three folder tabs in logical-id order', () => {
    expect(MAIL_FOLDER_TAB_IDS).toEqual(['school-work', 'international-office', 'inbox']);
    expect(defaultMailFolders()).toEqual([
      { id: 'school-work', label: '학교 업무', available: true },
      { id: 'international-office', label: '국제과', available: true },
      { id: 'inbox', label: '받은 편지함', available: true },
    ]);
    expect(mailFolderTabLabel('school-work')).toBe('학교 업무');
    expect(mailFolderTabLabel('international-office')).toBe('국제과');
    expect(mailFolderTabLabel('inbox')).toBe('받은 편지함');
  });

  it('labels ready, empty, offline, and folder errors', () => {
    expect(mailPanelStatusLabel('ready', null)).toBe('Thunderbird ● 로컬');
    expect(mailPanelStatusLabel('empty', null)).toBe('Thunderbird ● 로컬');
    expect(mailPanelStatusLabel('bridge_offline', 'bridge_offline')).toBe('브리지 오프라인');
    expect(mailPanelStatusLabel('folder_not_found', 'folder_not_found')).toBe('폴더 확인 필요');
    expect(mailPanelStateMessage('folder_not_found')).toContain('선택한 Thunderbird 메일 폴더');
  });
});
