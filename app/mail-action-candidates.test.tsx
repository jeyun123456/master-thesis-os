import { describe, expect, it } from 'vitest';
import { mailActionErrorMessage, mailActionStatusLabel } from './mail-action-candidates';

describe('Mail action candidate panel states', () => {
  it('labels loading, ready, empty, and error states', () => {
    expect(mailActionStatusLabel('loading', 0)).toBe('확인 중');
    expect(mailActionStatusLabel('ready', 2)).toBe('2건');
    expect(mailActionStatusLabel('empty', 0)).toBe('없음');
    expect(mailActionStatusLabel('error', 0)).toBe('확인 필요');
    expect(mailActionErrorMessage('bridge_auth')).toContain('token');
  });
});
