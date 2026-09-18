import { describe, expect, it } from 'vitest';
import {
  defaultMailFolders,
  mailFolderTabLabel,
  mailPanelStateMessage,
  mailPanelStatusLabel,
  MAIL_FOLDER_TAB_IDS,
} from './mail-panel';

describe('SQLite mail analysis panel', () => {
  it('limits analysis tabs to the two configured Thunderbird folders', () => {
    expect(MAIL_FOLDER_TAB_IDS).toEqual(['school-work', 'international-office']);
    expect(defaultMailFolders()).toEqual([
      { id: 'school-work', label: '학교 업무', available: true },
      { id: 'international-office', label: '국제과', available: true },
    ]);
    expect(mailFolderTabLabel('school-work')).toBe('학교 업무');
    expect(mailFolderTabLabel('international-office')).toBe('국제과');
  });

  it('labels local SQLite states and bridge errors', () => {
    expect(mailPanelStatusLabel('ready', null)).toBe('SQLite ● 로컬');
    expect(mailPanelStatusLabel('empty', null)).toBe('SQLite ● 로컬');
    expect(mailPanelStatusLabel('bridge_offline', 'bridge_offline')).toBe('브리지 오프라인');
    expect(mailPanelStateMessage('folder_not_found')).toContain('선택한 Thunderbird 메일 폴더');
  });
});
