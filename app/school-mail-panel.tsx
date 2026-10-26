'use client';

import type { ReactNode } from 'react';
import type { ThunderbirdMail } from '../lib/thunderbird-mail';
import {
  mailPriorityLabel,
  type MailPriority,
  type PrioritizedMail,
} from '../lib/mail-priority';

export type SchoolMailAnalysisState = 'queued' | 'processing' | 'completed' | 'failed';

export function SchoolMailRow({
  item,
  isOpening = false,
  onOpen,
  analysisState,
  analysisExpanded = false,
  onToggleAnalysis,
  analysisDetails,
  analysisSummary,
  analysisAvailable = true,
  showNormalPriorityLabel = false,
}: {
  item: PrioritizedMail;
  isOpening?: boolean;
  onOpen?: (item: PrioritizedMail) => void | Promise<void>;
  analysisState?: SchoolMailAnalysisState;
  analysisExpanded?: boolean;
  onToggleAnalysis?: () => void;
  analysisDetails?: ReactNode;
  analysisSummary?: string;
  analysisAvailable?: boolean;
  showNormalPriorityLabel?: boolean;
}) {
  const priorityLabel = item.priority === 'normal' && showNormalPriorityLabel ? '기본' : mailPriorityLabel(item.priority);
  const content = <>
    <span className={`microsoft-mail-dot${item.isRead ? '' : ' unread'}`} aria-label={item.isRead ? '읽음' : '미읽음'}>{schoolMailIndicator(item.isRead)}</span>
    <span className="microsoft-mail-main">
      <b>{priorityLabel && <span className={`school-mail-priority-label ${item.priority}`}>{priorityLabel}</span>}{!item.isRead && <span className="microsoft-mail-unread-label">미읽음</span>}{item.subject}</b>
      <small>{item.senderName}{item.senderAddress && ` · ${item.senderAddress}`} · <time dateTime={item.receivedAt} title={formatMailDate(item.receivedAt)}>{relativeMailDate(item.receivedAt)}</time></small>
      {item.priorityReason && <small className="school-mail-priority-reason">{item.priorityReason}</small>}
    </span>
    {!onToggleAnalysis && onOpen && <span className="school-mail-open-hint" aria-hidden="true">{isOpening ? '여는 중…' : '열기'}</span>}
  </>;
  const row = !onOpen ? <div className={schoolMailRowClass(item.isRead, item.priority)}>{content}</div> : <button
    aria-label={isOpening ? '메일을 여는 중' : `${item.subject} 메일 열기`}
    className={`${schoolMailRowClass(item.isRead, item.priority)} school-mail-row-button`}
    disabled={isOpening}
    onClick={() => { void onOpen(item); }}
    type="button"
  >{content}</button>;
  if (!onToggleAnalysis) return row;
  return <div className="school-mail-item">
    <div className="school-mail-triage-row">{row}<div className="school-mail-inline-actions">
      {onOpen && <button type="button" disabled={isOpening} onClick={() => { void onOpen(item); }}>{isOpening ? '여는 중…' : '열기'}</button>}
      <button className={`school-mail-analysis-toggle${analysisExpanded ? ' active' : ''}`} disabled={!analysisAvailable && !analysisExpanded} onClick={onToggleAnalysis} type="button">
        {analysisExpanded ? 'AI 분석 닫기' : analysisState === 'queued' || analysisState === 'processing' ? 'AI 분석 대기…' : analysisState === 'failed' ? 'AI 다시 시도' : 'AI 분석 보기'}
      </button>
    </div></div>
    {analysisSummary && <p className="school-mail-ai-summary"><b>AI 요약</b><span>{analysisSummary}</span></p>}
    {analysisExpanded && !analysisAvailable && <div className="note">저장된 AI 분석이 없어. 메일 동기화 후 분석된 요약이 표시돼.</div>}
    {analysisExpanded && analysisDetails}
  </div>;
}

export function schoolMailRowClass(isRead: boolean, priority: MailPriority = 'normal'): string {
  return `microsoft-mail-row${isRead ? '' : ' unread'} school-mail-priority-${priority}`;
}

export function schoolMailIndicator(isRead: boolean): '○' | '●' {
  return isRead ? '○' : '●';
}

export function schoolMailRowKey(item: ThunderbirdMail, index: number): string {
  return `${item.id}:${index}`;
}

function relativeMailDate(value: string): string {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return '시간 정보 없음';
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return '방금 전';
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days}일 전`;
  return formatMailDate(value);
}

function formatMailDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '시간 정보 없음';
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}
