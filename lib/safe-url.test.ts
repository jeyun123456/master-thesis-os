import { describe, expect, it } from 'vitest';
import { gmailThreadUrl, safeSourceUrl } from './safe-url';

describe('safeSourceUrl', () => {
  it('accepts only https URLs on the allow-list for the given source', () => {
    expect(safeSourceUrl('https://sp.ritsumei.ac.jp/portal/notice/1', 'school-notice')).toBe('https://sp.ritsumei.ac.jp/portal/notice/1');
    expect(safeSourceUrl('https://mail.google.com/mail/u/0/#all/abc123', 'gmail')).toContain('mail.google.com');
    expect(safeSourceUrl('https://outlook.office.com/mail/', 'outlook-web')).toBe('https://outlook.office.com/mail/');
  });

  it('rejects other schemes, hosts, credentials, ports and malformed input', () => {
    const bad: unknown[] = [
      'javascript:alert(1)', 'data:text/html,<script>1</script>', 'intent://x#Intent;end', 'ms-outlook://emails', 'file:///C:/x', 'http://sp.ritsumei.ac.jp/x',
      'https://evil.example/https://sp.ritsumei.ac.jp/', 'https://sp.ritsumei.ac.jp.evil.example/x', 'https://user:pw@sp.ritsumei.ac.jp/x', 'https://sp.ritsumei.ac.jp:8443/x',
      '', 'not a url', null, undefined, 42, `https://sp.ritsumei.ac.jp/${'a'.repeat(2100)}`,
    ];
    for (const value of bad) expect(safeSourceUrl(value, 'school-notice'), String(value)).toBeNull();
    expect(safeSourceUrl('https://sp.ritsumei.ac.jp/x', 'gmail')).toBeNull();
    expect(safeSourceUrl('https://mail.google.com/x', 'outlook-web')).toBeNull();
  });
});

describe('gmailThreadUrl', () => {
  it('pins the link to the mailbox account so another signed-in Google account is not opened', () => {
    expect(gmailThreadUrl('18f3a2b4c5d6e7f8', 'me@example.com')).toBe('https://mail.google.com/mail/?authuser=me%40example.com#all/18f3a2b4c5d6e7f8');
    expect(gmailThreadUrl('18f3a2b4c5d6e7f8', '')).toBe('https://mail.google.com/mail/u/0/#all/18f3a2b4c5d6e7f8');
  });

  it('refuses ids that are not plain Gmail ids', () => {
    for (const id of ['', 'a', '../x', 'a b c d e f', 'x'.repeat(80), 'abc/def#x']) expect(gmailThreadUrl(id, 'me@example.com')).toBeNull();
  });
});
