import type { GmailMessageDetail } from './gmail';
import { OUTLOOK_APP_HOME, OUTLOOK_WEB_HOME, safeSourceUrl } from './safe-url';
import type { SchoolAnalysis, SchoolAttachment, SchoolMailDetail, SchoolNoticeDetail } from './mtos-client';

/** One shape for everything the detail drawer can show, whatever the source. */
export type DetailAnalysis = { summary: string; importance: string; requiresAction: boolean; deadline: string | null; suggestedTask: string | null; reason: string | null } | null;
export type DetailAttachment = { id: string | null; filename: string; size: number | null; downloadable: boolean; note?: string };
export type DetailSource = {
  /** Verified URL that opens exactly this item, or null when none is known. */
  openUrl: string | null;
  openLabel: string;
  /** Optional generic fallback that does NOT point at this item (always labelled as such). */
  fallbackUrl: string | null;
  fallbackLabel: string;
  /** Optional fixed app link (generic, not per item) */
  appUrl?: string | null;
  appLabel?: string;
  hint: string;
};
export type MailDetailModel = {
  kind: 'mail';
  provider: 'gmail' | 'school-outlook';
  providerLabel: string;
  subject: string;
  from: string;
  to: string;
  cc: string;
  date: string | null;
  bodyText: string;
  bodyHtml: string | null;
  attachments: DetailAttachment[];
  analysis: DetailAnalysis;
  source: DetailSource;
};
export type NoticeDetailModel = {
  kind: 'notice';
  title: string;
  noticeType: string;
  department: string;
  publishedAt: string | null;
  changedAt: string | null;
  deadline: string | null;
  expiresAt: string | null;
  bodyText: string;
  attachments: DetailAttachment[];
  analysis: DetailAnalysis;
  source: DetailSource;
  history: Array<{ field: string; old_value: string | null; new_value: string | null; changed_at: string }>;
};

function analysisOf(a: SchoolAnalysis | null | undefined): DetailAnalysis {
  if (!a) return null;
  return { summary: a.summary, importance: a.importance, requiresAction: a.requires_action, deadline: a.deadline, suggestedTask: a.suggested_task, reason: a.reason };
}

const attachmentsOf = (items: SchoolAttachment[]): DetailAttachment[] => items.map((f) => ({ id: f.id, filename: f.filename, size: f.size, downloadable: f.stored, note: f.stored ? undefined : '서버에 저장되지 않음' }));

export function fromSchoolMail(mail: SchoolMailDetail): MailDetailModel {
  return {
    kind: 'mail', provider: 'school-outlook', providerLabel: '학교 Outlook',
    subject: mail.subject || '(제목 없음)', from: mail.from_addr, to: mail.to_addr, cc: mail.cc_addr, date: mail.received_at ?? mail.sent_at ?? mail.collected_at,
    bodyText: mail.body_text, bodyHtml: mail.body_html ?? null, attachments: attachmentsOf(mail.attachments), analysis: analysisOf(mail.analysis),
    // The collector reads Thunderbird's mbox copy, which carries no Outlook web link. A link for this exact mail cannot be derived, so none is made.
    source: {
      openUrl: null, openLabel: '원본 링크 없음',
      fallbackUrl: safeSourceUrl(OUTLOOK_WEB_HOME, 'outlook-web'), fallbackLabel: 'Outlook 웹 열기',
      appUrl: OUTLOOK_APP_HOME, appLabel: 'Outlook 앱 열기',
      hint: '이 메일의 정확한 Outlook 링크는 수집 데이터에 없어. Outlook 앱/웹 버튼은 이 메일이 아니라 받은편지함을 열어. 앱이 없으면 아무 일도 일어나지 않을 수 있어.',
    },
  };
}

export function fromGmail(mail: GmailMessageDetail): MailDetailModel {
  const from = mail.senderName ? `${mail.senderName} <${mail.senderAddress}>` : mail.senderAddress;
  const url = safeSourceUrl(mail.webUrl, 'gmail');
  return {
    kind: 'mail', provider: 'gmail', providerLabel: 'Gmail',
    subject: mail.subject, from, to: mail.to, cc: mail.cc, date: mail.receivedAt, bodyText: mail.bodyText || mail.snippet, bodyHtml: mail.bodyHtml,
    attachments: mail.attachments.map((f) => ({ id: null, filename: f.filename, size: f.size, downloadable: false, note: 'Gmail에서 받아야 해' })),
    analysis: null,
    source: { openUrl: url, openLabel: '원본 열기', fallbackUrl: null, fallbackLabel: '', hint: url ? '이 기기의 Gmail 앱 또는 브라우저에서 열려. 계정은 이 메일함으로 지정돼.' : 'Gmail 링크를 만들 수 없어.' },
  };
}

export function fromNotice(notice: SchoolNoticeDetail): NoticeDetailModel {
  const url = safeSourceUrl(notice.source_url, 'school-notice');
  return {
    kind: 'notice', title: notice.title, noticeType: notice.notice_type || 'ALL', department: notice.department, publishedAt: notice.published_at, changedAt: notice.changed_at,
    deadline: notice.deadline, expiresAt: notice.expires_at, bodyText: notice.body_text, attachments: attachmentsOf(notice.attachments), analysis: analysisOf(notice.analysis), history: notice.history,
    source: url
      ? { openUrl: url, openLabel: '원본 열기', fallbackUrl: null, fallbackLabel: '', hint: '이 기기의 브라우저에서 열려. 포털 로그인이 필요하면 로그인 화면이 먼저 나와.' }
      : { openUrl: null, openLabel: '원본 링크 없음', fallbackUrl: null, fallbackLabel: '', hint: '저장된 원본 주소가 없어. 아래 저장된 본문을 확인해.' },
  };
}

/** The mail body is shown in a script-less, sandboxed frame. Remote images (tracking pixels) stay blocked unless the user opts in. */
export function htmlSrcDoc(html: string, allowRemoteImages: boolean): string {
  const img = allowRemoteImages ? "img-src data: https:" : 'img-src data:';
  const csp = `default-src 'none'; ${img}; style-src 'unsafe-inline'; font-src data:; form-action 'none'; base-uri 'none'`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="referrer" content="no-referrer"><style>body{font:15px/1.6 system-ui,sans-serif;margin:12px;overflow-wrap:anywhere;color:#2e2a26}img{max-width:100%;height:auto}</style></head><body>${html}</body></html>`;
}

export const hasRemoteImages = (html: string | null | undefined) => Boolean(html && /<img\b[^>]*\bsrc\s*=\s*["']?\s*(https?:)?\/\//i.test(html));

/** `?detail=<kind>:<id>` carried on the current URL so back/forward and reloads keep the selection without touching other params. */
export function detailUrl(href: string, kind: string, id: string | null): string {
  const url = new URL(href);
  if (id === null) url.searchParams.delete('detail');
  else url.searchParams.set('detail', `${kind}:${id}`);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function readDetailParam(href: string): { kind: string; id: string } | null {
  const raw = new URL(href).searchParams.get('detail');
  const at = raw?.indexOf(':') ?? -1;
  if (!raw || at < 1 || at === raw.length - 1) return null;
  return { kind: raw.slice(0, at), id: raw.slice(at + 1) };
}
