import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MailErrorNotice } from './mail-error-notice';

describe('MailErrorNotice', () => {
  it('says the mail was not checked, keeps the raw code folded, and offers a retry', () => {
    const html = renderToStaticMarkup(<MailErrorNotice message="Gmail 연결을 확인해줘." code="auth_error" onRetry={() => {}} />);
    expect(html).toContain('메일이 없는 게 아니라 확인하지 못한 상태');
    expect(html).toContain('<details class="mail-error-details"><summary>진단 정보</summary>오류 코드: auth_error');
    expect(html).toContain('다시 시도');
    expect(html).toContain('role="alert"');
  });
});
