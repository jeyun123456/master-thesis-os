'use client';

import { useState } from 'react';
import { hasRemoteImages, htmlSrcDoc, type DetailAnalysis, type DetailAttachment, type DetailSource, type MailDetailModel, type NoticeDetailModel } from '../lib/detail-model';
import { safeSourceUrl, type SourceKind } from '../lib/safe-url';
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

/** "원본 열기" always opens in the viewer's own browser/app via a plain https link; nothing runs on the server. */
export function SourceActions({ source, kind }: { source: DetailSource; kind: SourceKind }) {
  const open = safeSourceUrl(source.openUrl, kind);
  const fallback = source.fallbackUrl ? safeSourceUrl(source.fallbackUrl, 'outlook-web') : null;
  return <>
    {open
      ? <a className={`${styles.btn} ${styles.primary}`} href={open} target="_blank" rel="noopener noreferrer">{source.openLabel}</a>
      : <span className={styles.btn} role="link" aria-disabled="true">{source.openLabel}</span>}
    {fallback && <a className={styles.btn} href={fallback} target="_blank" rel="noopener noreferrer">{source.fallbackLabel}</a>}
    <p className={styles.hint}>{source.hint}</p>
  </>;
}
