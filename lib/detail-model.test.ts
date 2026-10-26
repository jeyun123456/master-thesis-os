import { describe, expect, it } from 'vitest';
import { detailUrl, fromGmail, fromNotice, fromSchoolMail, hasRemoteImages, htmlSrcDoc, readDetailParam } from './detail-model';
import type { GmailMessageDetail } from './gmail';
import type { SchoolMailDetail, SchoolNoticeDetail } from './mtos-client';

const analysis = { summary: '요약', importance: 'high' as const, requires_action: true, suggested_task: '제출', deadline: '2026-11-01', project_id: null, reason: '마감', model: 'm', analyzed_at: '2026-10-26T00:00:00Z' };
const schoolMail: SchoolMailDetail = {
  id: 'm1', account_id: 'a', folder_id: 'f', subject: '학교 메일', from_addr: 'a@x.ac.jp', to_addr: 'me@x.ac.jp', cc_addr: '', received_at: '2026-10-26T01:00:00Z', sent_at: null, read_state: false,
  collected_at: '2026-10-26T01:01:00Z', body_text: '본문', body_html: '<p>html</p>', attachments: [{ id: 'att1', filename: 'a.pdf', mime: 'application/pdf', size: 2048, stored: true, url: null }], analysis,
};
const notice: SchoolNoticeDetail = {
  notice_id: 'n1', notice_type: 'DM', category: '', department: '국제과', title: '공지', importance: 'normal', published_at: '2026-10-20T00:00:00Z', deadline: '2026-11-05', expires_at: null,
  source_url: 'https://sp.ritsumei.ac.jp/notice/1', collected_at: '', changed_at: '2026-10-21T00:00:00Z', body_text: '내용', attachments: [], analysis: null, history: [],
};
const gmail: GmailMessageDetail = {
  id: 'g1abcdef', threadId: 'thread1abcdef', subject: 'Gmail', senderName: 'Kim', senderAddress: 'k@x.com', receivedAt: '2026-10-26T00:00:00Z', isRead: false, snippet: 'snip',
  webUrl: 'https://mail.google.com/mail/?authuser=me%40example.com#all/thread1abcdef', to: 'me@example.com', cc: '', bodyText: '', bodyHtml: null, attachments: [{ filename: 'x.zip', mimeType: 'application/zip', size: 10 }],
};

describe('detail models', () => {
  it('school Outlook never fabricates a link for the exact mail; the generic Outlook web link is labelled as such', () => {
    const m = fromSchoolMail(schoolMail);
    expect(m.source.openUrl).toBeNull();
    expect(m.source.openLabel).toBe('원본 링크 없음');
    expect(m.source.fallbackUrl).toBe('https://outlook.office.com/mail/');
    expect(m.source.hint).toContain('받은편지함');
    expect(m.analysis?.requiresAction).toBe(true);
    expect(m.attachments[0]).toMatchObject({ id: 'att1', downloadable: true });
  });

  it('Gmail keeps the account-pinned link, falls back to the snippet and has no AI analysis to invent', () => {
    const m = fromGmail(gmail);
    expect(m.source.openUrl).toBe(gmail.webUrl);
    expect(m.bodyText).toBe('snip');
    expect(m.analysis).toBeNull();
    expect(m.attachments[0].downloadable).toBe(false);
    expect(fromGmail({ ...gmail, webUrl: 'https://evil.example/x' }).source.openUrl).toBeNull();
  });

  it('notice uses only the stored, verified portal URL', () => {
    expect(fromNotice(notice).source.openUrl).toBe('https://sp.ritsumei.ac.jp/notice/1');
    expect(fromNotice({ ...notice, source_url: null }).source.openUrl).toBeNull();
    expect(fromNotice({ ...notice, source_url: 'https://sp.ritsumei.ac.jp.evil.example/' }).source.openUrl).toBeNull();
    expect(fromNotice({ ...notice, source_url: 'javascript:alert(1)' }).source.openUrl).toBeNull();
  });
});

describe('html body safety', () => {
  it('blocks scripts, network and remote images by default via CSP', () => {
    const doc = htmlSrcDoc('<img src="https://t.example/p.gif"><script>alert(1)</script>', false);
    expect(doc).toContain("default-src 'none'");
    expect(doc).toContain('img-src data:;');
    expect(doc).not.toContain('img-src data: https:');
    expect(doc).toContain('no-referrer');
    expect(htmlSrcDoc('<p>x</p>', true)).toContain('img-src data: https:');
    expect(htmlSrcDoc('x', true)).not.toContain('script-src');
  });

  it('detects remote images only', () => {
    expect(hasRemoteImages('<img src="https://t.example/p.gif">')).toBe(true);
    expect(hasRemoteImages("<IMG alt=x src='//t.example/p.gif'>")).toBe(true);
    expect(hasRemoteImages('<img src="data:image/png;base64,AAAA">')).toBe(false);
    expect(hasRemoteImages('<p>no image</p>')).toBe(false);
    expect(hasRemoteImages(null)).toBe(false);
  });
});

describe('detail URL state', () => {
  it('adds and removes only the detail param', () => {
    const base = 'https://app.example/?p=mail&q=a#x';
    const opened = detailUrl(base, 'gmail', 'abc123');
    expect(opened).toBe('/?p=mail&q=a&detail=gmail%3Aabc123#x');
    expect(readDetailParam(`https://app.example${opened}`)).toEqual({ kind: 'gmail', id: 'abc123' });
    expect(detailUrl(`https://app.example${opened}`, 'gmail', null)).toBe('/?p=mail&q=a#x');
    expect(readDetailParam('https://app.example/?detail=bad')).toBeNull();
  });
});
