import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { fromGmail, fromNotice, fromSchoolMail } from '../lib/detail-model';
import type { GmailMessageDetail } from '../lib/gmail';
import type { SchoolMailDetail, SchoolNoticeDetail } from '../lib/mtos-client';
import { DetailDrawer, DrawerPanel } from './detail-drawer';
import { DetailState, MailDetailBody, NoticeDetailBody, SourceActions } from './detail-views';

const mail: SchoolMailDetail = {
  id: 'm1', account_id: 'a', folder_id: 'f', subject: '학교 메일', from_addr: 'a@x.ac.jp', to_addr: 'me@x.ac.jp', cc_addr: '', received_at: '2026-10-26T01:00:00Z', sent_at: null, read_state: false,
  collected_at: '2026-10-26T01:01:00Z', body_text: '본문 <script>alert(1)</script>', body_html: null,
  attachments: [{ id: 'att/1', filename: 'a.pdf', mime: null, size: 2048, stored: true, url: null }, { id: 'att2', filename: 'gone.pdf', mime: null, size: null, stored: false, url: null }],
  analysis: { summary: '제출 필요', importance: 'high', requires_action: true, suggested_task: '서류 제출', deadline: '2026-11-01', project_id: null, reason: null, model: 'm', analyzed_at: '' },
};
const notice: SchoolNoticeDetail = {
  notice_id: 'n1', notice_type: 'DM', category: '', department: '국제과', title: '공지', importance: 'normal', published_at: '2026-10-20T00:00:00Z', deadline: '2026-11-05', expires_at: null,
  source_url: 'https://sp.ritsumei.ac.jp/notice/1', collected_at: '', changed_at: '2026-10-21T00:00:00Z', body_text: '공지 본문', attachments: [], analysis: null, history: [],
};
const gmail: GmailMessageDetail = {
  id: 'g1abcdef', threadId: 'thread1abcdef', subject: 'Gmail', senderName: 'Kim', senderAddress: 'k@x.com', receivedAt: '2026-10-26T00:00:00Z', isRead: false, snippet: 'snip',
  webUrl: 'https://mail.google.com/mail/?authuser=me%40example.com#all/thread1abcdef', to: 'me@example.com', cc: '', bodyText: 'hello', bodyHtml: '<p onclick="x()">hi</p><img src="https://t.example/p.gif">', attachments: [],
};

describe('detail views', () => {
  it('shows stored body, AI summary, chips and attachments; text is escaped, not executed', () => {
    const out = renderToStaticMarkup(<MailDetailBody mail={fromSchoolMail(mail)} />);
    expect(out).toContain('보낸 사람'); expect(out).toContain('a@x.ac.jp'); expect(out).toContain('AI 요약'); expect(out).toContain('제출 필요');
    expect(out).toContain('조치 필요'); expect(out).toContain('마감 2026-11-01'); expect(out).toContain('중요도 높음'); expect(out).toContain('학교 Outlook');
    expect(out).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(out).not.toContain('<script>');
    expect(out).toContain('href="/api/school/attachments/att%2F1"');
    expect(out).toContain('서버에 저장되지 않음');
  });

  it('omits AI and missing fields instead of inventing them', () => {
    const out = renderToStaticMarkup(<MailDetailBody mail={fromSchoolMail({ ...mail, analysis: null, cc_addr: '', attachments: [] })} />);
    expect(out).not.toContain('AI 요약'); expect(out).not.toContain('참조'); expect(out).not.toContain('조치 필요'); expect(out).not.toContain('첨부파일');
  });

  it('renders mail HTML only inside a script-less sandboxed frame with remote images blocked', () => {
    const out = renderToStaticMarkup(<MailDetailBody mail={fromGmail(gmail)} />);
    expect(out).toMatch(/<iframe[^>]*sandbox=""/);
    expect(out).not.toMatch(/sandbox="[^"]*allow-(scripts|same-origin)/);
    expect(out).toContain("default-src &#x27;none&#x27;");
    expect(out).toContain('이미지 불러오기');
    expect(out).toContain('원격 이미지는 추적을 막기 위해 차단했어');
    expect(out).not.toContain('<p onclick');
  });

  it('notice shows department, dates, deadline and the stored body', () => {
    const out = renderToStaticMarkup(<NoticeDetailBody notice={fromNotice(notice)} />);
    for (const text of ['국제과', '게시일', '신청 마감', '2026-11-05', '공지 본문', 'DM']) expect(out).toContain(text);
    expect(out).not.toContain('AI 요약');
  });

  it('원본 열기: verified https links open in a new browsing context; no link means a disabled control, never a made-up URL', () => {
    const gm = renderToStaticMarkup(<SourceActions source={fromGmail(gmail).source} kind="gmail" />);
    expect(gm).toContain('href="https://mail.google.com/mail/?authuser=me%40example.com#all/thread1abcdef"');
    expect(gm).toContain('rel="noopener noreferrer"'); expect(gm).toContain('target="_blank"');
    const nt = renderToStaticMarkup(<SourceActions source={fromNotice(notice).source} kind="school-notice" />);
    expect(nt).toContain('href="https://sp.ritsumei.ac.jp/notice/1"');
    const none = renderToStaticMarkup(<SourceActions source={fromNotice({ ...notice, source_url: null }).source} kind="school-notice" />);
    expect(none).toContain('aria-disabled="true"'); expect(none).toContain('원본 링크 없음'); expect(none).not.toContain('<a ');
    const outlook = renderToStaticMarkup(<SourceActions source={fromSchoolMail(mail).source} kind="outlook-web" />);
    expect(outlook).toContain('aria-disabled="true"'); expect(outlook).toContain('원본 링크 없음');
    expect(outlook).toContain('href="https://outlook.office.com/mail/"'); expect(outlook).toContain('Outlook 웹 열기'); expect(outlook).toContain('받은편지함');
    expect(outlook).toContain('href="ms-outlook://emails"'); expect(outlook).toContain('Outlook 앱 열기');
    expect(outlook).not.toMatch(/intent:|javascript:/);
  });

  it('inside an embedded web view the link is handed to Edge instead of loading in the view; copy-link is offered', () => {
    const nt = renderToStaticMarkup(<SourceActions source={fromNotice(notice).source} kind="school-notice" embedded />);
    expect(nt).toContain('href="microsoft-edge:https://sp.ritsumei.ac.jp/notice/1"');
    expect(nt).toContain('원본 열기 (Edge)'); expect(nt).toContain('링크 복사'); expect(nt).not.toContain('target="_blank"');
    const unverified = renderToStaticMarkup(<SourceActions source={{ ...fromNotice(notice).source, openUrl: 'https://evil.example/x' }} kind="school-notice" embedded />);
    expect(unverified).not.toContain('microsoft-edge:'); expect(unverified).not.toContain('evil.example');
    const ol = renderToStaticMarkup(<SourceActions source={fromSchoolMail(mail).source} kind="outlook-web" embedded />);
    expect(ol).toContain('href="microsoft-edge:https://outlook.office.com/mail/"'); expect(ol).toContain('href="ms-outlook://emails"');
  });

  it('drawer is an accessible modal dialog with a labelled close button, and renders nothing when closed', () => {
    const open = renderToStaticMarkup(<DrawerPanel title="제목" titleId="t1" onClose={() => {}} footer={<span>푸터</span>}><p>내용</p></DrawerPanel>);
    expect(open).toContain('role="dialog"'); expect(open).toContain('aria-modal="true"'); expect(open).toContain('aria-labelledby=');
    expect(open).toContain('aria-label="상세 패널 닫기"'); expect(open).toContain('제목'); expect(open).toContain('푸터');
    expect(renderToStaticMarkup(<DetailDrawer open={false} title="x" onClose={() => {}}><p>내용</p></DetailDrawer>)).toBe('');
    // the real drawer is portaled to <body>, so it renders nothing during server rendering
    expect(renderToStaticMarkup(<DetailDrawer open title="x" onClose={() => {}}><p>내용</p></DetailDrawer>)).toBe('');
  });

  it('loading and error states are announced', () => {
    expect(renderToStaticMarkup(<DetailState loading error={null} />)).toContain('role="status"');
    const err = renderToStaticMarkup(<DetailState loading={false} error="열지 못했어" onRetry={() => {}} />);
    expect(err).toContain('role="alert"'); expect(err).toContain('다시 시도');
    expect(renderToStaticMarkup(<DetailState loading={false} error={null} />)).toBe('');
  });
});
