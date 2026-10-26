'use client';

import { useEffect, useState } from 'react';
import { hasRemoteImages, htmlSrcDoc, type DetailAnalysis, type DetailAttachment, type DetailSource, type MailDetailModel, type NoticeDetailModel } from '../lib/detail-model';
import { edgeLaunchUrl, isEmbeddedWebView, isMobileUserAgent, safeSourceUrl, type SourceKind } from '../lib/safe-url';
import styles from './detail-drawer.module.css';

const IMPORTANCE: Record<string, string> = { high: '중요도 높음', normal: '중요도 보통', low: '중요도 낮음' };

export function formatDetailDate(value: string | null | undefined): string {
  if (!value) return '정보 없음';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
}

const fileSize = (size: number | null) => (size === null ? '' : size >= 1048576 ? `${(size / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.round(size / 1024))}KB`);

export function DetailState({ loading, error, onRetry }: { loading: boolean; error: string | null; onRetry?: () => void }) {
  if (error) return <div className={styles.error} role="alert">{error}{onRetry && <> <button type="button" className={styles.btn} onClick={onRetry}>다시 시도</button></>}</div>;
  if (loading) return <div className={styles.state} role="status">불러오는 중…</div>;
  return null;
}

function Analysis({ analysis }: { analysis: DetailAnalysis }) {
  if (!analysis) return null;
  return <div className={styles.ai}>
    <b>AI 요약</b>{analysis.summary || '요약 없음'}
    {analysis.suggestedTask && <small>등록된 할 일: {analysis.suggestedTask}</small>}
    {analysis.reason && <small>이유: {analysis.reason}</small>}
  </div>;
}

export function AttachmentList({ items }: { items: DetailAttachment[] }) {
  if (!items.length) return null;
  return <ul className={styles.files} aria-label="첨부파일">{items.map((file, i) => <li key={`${file.id ?? file.filename}-${i}`}>
    {file.downloadable && file.id ? <a href={`/api/school/attachments/${encodeURIComponent(file.id)}`} download>{file.filename}</a> : <span>{file.filename}</span>}
    {file.size !== null && <small>{fileSize(file.size)}</small>}
    {!file.downloadable && file.note && <small>{file.note}</small>}
  </li>)}</ul>;
}

/** Mail HTML renders in a sandboxed frame without scripts; remote images load only after the user asks. */
export function HtmlBody({ html }: { html: string }) {
  const [remote, setRemote] = useState(false);
  return <div>
    {hasRemoteImages(html) && <div className={styles.remote}>
      <span>{remote ? '원격 이미지를 불러오는 중이야.' : '원격 이미지는 추적을 막기 위해 차단했어.'}</span>
      <button type="button" className={styles.btn} onClick={() => setRemote((v) => !v)}>{remote ? '다시 차단' : '이미지 불러오기'}</button>
    </div>}
    <iframe className={styles.frame} title="메일 본문" sandbox="" referrerPolicy="no-referrer" srcDoc={htmlSrcDoc(html, remote)} />
  </div>;
}

export function MailDetailBody({ mail }: { mail: MailDetailModel }) {
  const [asText, setAsText] = useState(false);
  const showHtml = Boolean(mail.bodyHtml) && !asText;
  return <article>
    <div className={styles.chips}>
      <span className={styles.chip}>{mail.providerLabel}</span>
      {mail.analysis && <span className={`${styles.chip} ${mail.analysis.importance === 'high' ? styles.high : ''}`}>{IMPORTANCE[mail.analysis.importance] ?? mail.analysis.importance}</span>}
      {mail.analysis?.requiresAction && <span className={`${styles.chip} ${styles.action}`}>조치 필요</span>}
      {mail.analysis?.deadline && <span className={styles.chip}>마감 {mail.analysis.deadline}</span>}
    </div>
    <dl className={styles.meta}>
      <dt>보낸 사람</dt><dd>{mail.from || '정보 없음'}</dd>
      <dt>받는 사람</dt><dd>{mail.to || '정보 없음'}</dd>
      {mail.cc && <><dt>참조</dt><dd>{mail.cc}</dd></>}
      <dt>수신 시각</dt><dd>{formatDetailDate(mail.date)}</dd>
    </dl>
    <Analysis analysis={mail.analysis} />
    {mail.bodyHtml && mail.bodyText && <div className={styles.remote}><button type="button" className={styles.btn} onClick={() => setAsText((v) => !v)}>{asText ? '원본 서식으로 보기' : '텍스트로 보기'}</button></div>}
    {showHtml ? <HtmlBody html={mail.bodyHtml as string} /> : <pre className={styles.text}>{mail.bodyText || '(본문 없음)'}</pre>}
    <AttachmentList items={mail.attachments} />
  </article>;
}

export function NoticeDetailBody({ notice }: { notice: NoticeDetailModel }) {
  return <article>
    <div className={styles.chips}>
      <span className={styles.chip}>{notice.noticeType}</span>
      {notice.analysis && <span className={`${styles.chip} ${notice.analysis.importance === 'high' ? styles.high : ''}`}>{IMPORTANCE[notice.analysis.importance] ?? notice.analysis.importance}</span>}
      {notice.analysis?.requiresAction && <span className={`${styles.chip} ${styles.action}`}>조치 필요</span>}
    </div>
    <dl className={styles.meta}>
      <dt>게시 부서</dt><dd>{notice.department || '정보 없음'}</dd>
      <dt>게시일</dt><dd>{formatDetailDate(notice.publishedAt)}</dd>
      {notice.changedAt && notice.changedAt !== notice.publishedAt && <><dt>수정일</dt><dd>{formatDetailDate(notice.changedAt)}</dd></>}
      {notice.deadline && <><dt>신청 마감</dt><dd>{notice.deadline}</dd></>}
      {notice.expiresAt && <><dt>게시 종료</dt><dd>{formatDetailDate(notice.expiresAt)}</dd></>}
    </dl>
    <Analysis analysis={notice.analysis} />
    <pre className={styles.text}>{notice.bodyText || '(본문 없음)'}</pre>
    <AttachmentList items={notice.attachments} />
    {notice.history.length > 0 && <details><summary>변경 이력 {notice.history.length}건</summary><ul>{notice.history.map((h, i) => <li key={`${h.changed_at}-${i}`}><small>{formatDetailDate(h.changed_at)} · {h.field}: {h.old_value ?? '없음'} → {h.new_value ?? '없음'}</small></li>)}</ul></details>}
  </article>;
}

/**
 * "원본 열기" opens on the viewer's own device through plain links; nothing runs on the server.
 * Inside an embedded web view (wallpaper app) normal links would load inside that view, so there the link is
 * handed to the OS (Edge) instead, and a copy-link button is always available.
 */
export function SourceActions({ source, kind, embedded: embeddedProp, desktop: desktopProp }: { source: DetailSource; kind: SourceKind; embedded?: boolean; desktop?: boolean }) {
  const [embeddedState, setEmbedded] = useState(false);
  const [desktopState, setDesktop] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => { setEmbedded(isEmbeddedWebView(navigator.userAgent)); setDesktop(!isMobileUserAgent(navigator.userAgent)); }, []);
  const embedded = embeddedProp ?? embeddedState;
  // Desktop only: protocol links for apps installed on this PC. Phones keep the plain https / app links.
  const desktop = desktopProp ?? desktopState;
  const open = safeSourceUrl(source.openUrl, kind);
  const fallback = source.fallbackUrl ? safeSourceUrl(source.fallbackUrl, 'outlook-web') : null;
  const external = (url: string | null) => (embedded ? edgeLaunchUrl(url) : url);
  const copy = async (url: string) => {
    try { await navigator.clipboard.writeText(url); setCopied('링크를 복사했어.'); } catch { setCopied('복사하지 못했어. 링크를 길게 눌러 복사해줘.'); }
  };
  const linkProps = embedded ? {} : { target: '_blank', rel: 'noopener noreferrer' } as const;
  return <>
    {open
      ? <a className={`${styles.btn} ${styles.primary}`} href={external(open) || open} {...linkProps}>{embedded ? `${source.openLabel} (Edge)` : source.openLabel}</a>
      : <span className={styles.btn} role="link" aria-disabled="true">{source.openLabel}</span>}
    {open && desktop && !embedded && <a className={styles.btn} href={edgeLaunchUrl(open) ?? open}>Edge로 열기</a>}
    {open && desktop && !embedded && <button type="button" className={styles.btn} onClick={() => void copy(open)}>링크 복사</button>}
    {desktop && source.thunderbirdUrl && <a className={styles.btn} href={source.thunderbirdUrl}>Thunderbird로 열기</a>}
    {open && embedded && <button type="button" className={styles.btn} onClick={() => void copy(open)}>링크 복사</button>}
    {source.appUrl && <a className={styles.btn} href={source.appUrl}>{source.appLabel}</a>}
    {fallback && <a className={styles.btn} href={external(fallback) ?? fallback} {...linkProps}>{source.fallbackLabel}{embedded ? ' (Edge)' : ''}</a>}
    <p className={styles.hint}>{source.hint}{embedded && open ? ' 배경화면/웹뷰 앱 안에서는 기본 브라우저를 직접 지정할 수 없어서 Edge로 열려.' : ''}{copied ? ` ${copied}` : ''}</p>
  </>;
}
