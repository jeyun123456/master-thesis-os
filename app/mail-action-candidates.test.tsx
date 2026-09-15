import { describe, expect, it } from 'vitest';
import { MAIL_ACTION_SOURCE_FOLDER, mailActionErrorMessage, mailActionStatusLabel } from './mail-action-candidates';

describe('Mail action candidate panel states', () => {
  it('uses only the school-work folder as its home source', () => {
    expect(MAIL_ACTION_SOURCE_FOLDER).toBe('school-work');
  });

  it('labels loading, ready, empty, and error states', () => {
    expect(mailActionStatusLabel('loading', 0)).toBe('확인 중');
    expect(mailActionStatusLabel('ready', 2)).toBe('2건');
    expect(mailActionStatusLabel('empty', 0)).toBe('없음');
    expect(mailActionStatusLabel('error', 0)).toBe('확인 필요');
    expect(mailActionErrorMessage('bridge_auth')).toContain('token');
  });
});
