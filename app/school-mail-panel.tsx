'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  openThunderbird,
  openThunderbirdMessage,
  thunderbirdMailErrorMessage,
  ThunderbirdMailError,
  type ThunderbirdMail,
  type ThunderbirdMailErrorCode,
  type ThunderbirdAnalysisFolderId,
} from '../lib/thunderbird-mail';
import { getMailAnalysis, MailAnalysisClientError, readBridgeToken } from '../lib/mail-analysis-client';
import {
  mailPriorityLabel,
  prioritizeMails,
  type MailPriority,
  type PrioritizedMail,
} from '../lib/mail-priority';

type SchoolMailPanelVariant = 'home' | 'settings';
type SchoolMailStatus = 'loading' | 'ready' | 'empty' | 'bridge_offline' | 'thunderbird_not_found' | 'sync_required' | 'error';
export const SCHOOL_MAIL_HOME_FOLDER: ThunderbirdAnalysisFolderId = 'school-work';

export function SchoolMailPanel({ variant, folder = SCHOOL_MAIL_HOME_FOLDER }: { variant: SchoolMailPanelVariant; folder?: ThunderbirdAnalysisFolderId }) {
  const [status, setStatus] = useState<SchoolMailStatus>('loading');
  const [errorCode, setErrorCode] = useState<ThunderbirdMailErrorCode | null>(null);
  const [items, setItems] = useState<PrioritizedMail[]>([]);
  const [openState, setOpenState] = useState<'idle' | 'opening' | 'opened'>('idle');
  const [openingMailId, setOpeningMailId] = useState<string | null>(null);
  const [openError, setOpenError] = useState<ThunderbirdMailErrorCode | null>(null);

  const loadMail = useCallback(async () => {
    setStatus('loading');
    setErrorCode(null);
    setItems([]);
    try {
      const result = await getMailAnalysis(readBridgeToken(), { folder, limit: 20 });
      const prioritizedItems = prioritizeMails(result.items.map((item) => item.mail));
      setItems(prioritizedItems);
      setStatus(prioritizedItems.length ? 'ready' : 'empty');
    } catch (error) {
      const nextCode = readErrorCode(error);
      setItems([]);
      setErrorCode(nextCode);
      setStatus(statusForError(nextCode));
    }
  }, [folder]);

  useEffect(() => {
    void loadMail();
  }, [loadMail]);

  async function handleOpenThunderbird() {
    setOpenState('opening');
    setOpenError(null);
    try {
      await openThunderbird(readBridgeToken());
      setOpenState('opened');
    } catch (error) {
      setOpenState('idle');
      setOpenError(readErrorCode(error));
    }
  }

  async function handleOpenMail(item: PrioritizedMail) {
    setOpeningMailId(item.id);
    setOpenError(null);
    try {
      if (item.messageId) {
        await openThunderbirdMessage(readBridgeToken(), item.messageId);
      } else {
        await openThunderbird(readBridgeToken());
      }
      setOpenState('opened');
    } catch (error) {
      setOpenError(readErrorCode(error));
    } finally {
      setOpeningMailId(null);
    }
  }

  const hasOpenButton = status !== 'loading' && errorCode !== 'thunderbird_not_installed';
  const openLabel = openState === 'opening' ? 'Thunderbird 여는 중…' : openState === 'opened' ? 'Thunderbird 열림' : 'Thunderbird 열기';

  return <section className="card section microsoft-mail-card school-mail-card">
    <div className="head"><h3>학교 메일</h3><span>{schoolMailStatusLabel(status, errorCode)}</span></div>
    <div className="muted"><small>{folder === 'school-work' ? '학교 업무' : '국제과'} · SQLite · Thunderbird 동기화 결과</small></div>
    {variant === 'settings' && <div className="note">메일 탭의 <b>메일 분석 동기화</b> 버튼을 눌렀을 때만 Thunderbird의 학교 업무·국제과 폴더를 스캔해. 수집한 메일과 AI 분석 결과는 Local Bridge의 SQLite에 저장되고, 이 카드와 대시보드는 저장된 결과만 읽어. Microsoft Graph OAuth token·첨부파일은 읽지 않아.<br />중요 메일 자동 선별: 켜짐<br />행동 후보 추출: 규칙 + 로컬 CLI AI</div>}
    {status === 'loading' && <div className="microsoft-mail-state">SQLite에 저장된 학교 메일을 확인하는 중이야…</div>}
    {(status === 'ready' || status === 'empty') && (items.length ? <div className="microsoft-mail-list">{items.map((item, index) => <SchoolMailRow item={item} isOpening={openingMailId === item.id} key={schoolMailRowKey(item, index)} onOpen={handleOpenMail} />)}</div> : <div className="empty compact-empty">최근 학교 메일이 없어.</div>)}
    {status !== 'loading' && status !== 'ready' && status !== 'empty' && <SchoolMailErrorState errorCode={errorCode} onRetry={() => void loadMail()} />}
    {openError && <div className="error school-mail-open-error">{thunderbirdMailErrorMessage(openError)}</div>}
    {(hasOpenButton || variant === 'settings') && <div className="toolbar school-mail-actions">
      {hasOpenButton && <button className="btn" disabled={openState === 'opening'} onClick={() => void handleOpenThunderbird()} type="button">{openLabel}</button>}
      <button className="mini" onClick={() => void loadMail()} type="button">새로고침</button>
    </div>}
  </section>;
}

export type SchoolMailAnalysisState = 'queued' | 'processing' | 'completed' | 'failed';

export function SchoolMailRow({
  item,
  isOpening = false,
  onOpen,
  analysisState,
  analysisExpanded = false,
  onToggleAnalysis,
  analysisDetails,
}: {
  item: PrioritizedMail;
  isOpening?: boolean;
  onOpen?: (item: PrioritizedMail) => void | Promise<void>;
  analysisState?: SchoolMailAnalysisState;
  analysisExpanded?: boolean;
  onToggleAnalysis?: () => void;
  analysisDetails?: ReactNode;
}) {
  const priorityLabel = mailPriorityLabel(item.priority);
  const content = <>
    <span className={`microsoft-mail-dot${item.isRead ? '' : ' unread'}`} aria-label={item.isRead ? '읽음' : '미읽음'}>{schoolMailIndicator(item.isRead)}</span>
    <span className="microsoft-mail-main">
      <b>{priorityLabel && <span className={`school-mail-priority-label ${item.priority}`}>{priorityLabel}</span>}{!item.isRead && <span className="microsoft-mail-unread-label">미읽음</span>}{item.subject}</b>
      <small>{item.senderName}{item.senderAddress && ` · ${item.senderAddress}`} · <time dateTime={item.receivedAt} title={formatMailDate(item.receivedAt)}>{relativeMailDate(item.receivedAt)}</time></small>
      {item.priorityReason && <small className="school-mail-priority-reason">{item.priorityReason}</small>}
    </span>
    {onOpen && <span className="school-mail-open-hint" aria-hidden="true">{isOpening ? '여는 중…' : '열기'}</span>}
  </>;
  const row = !onOpen ? <div className={schoolMailRowClass(item.isRead, item.priority)}>{content}</div> : <button
    aria-label={isOpening ? 'Thunderbird에서 메일을 여는 중' : `${item.subject} 메일 열기`}
    className={`${schoolMailRowClass(item.isRead, item.priority)} school-mail-row-button`}
    disabled={isOpening}
    onClick={() => { void onOpen(item); }}
    type="button"
  >{content}</button>;
  if (!onToggleAnalysis) return row;
  return <div className="school-mail-item">
    {row}
    <button className={`school-mail-analysis-toggle${analysisExpanded ? ' active' : ''}`} onClick={onToggleAnalysis} type="button">
      {analysisExpanded ? 'AI 분석 닫기' : analysisState === 'queued' || analysisState === 'processing' ? 'AI 분석 대기…' : analysisState === 'failed' ? 'AI 다시 시도' : 'AI 분석 보기'}
    </button>
    {analysisExpanded && analysisDetails}
  </div>;
}

function SchoolMailErrorState({ errorCode, onRetry }: { errorCode: ThunderbirdMailErrorCode | null; onRetry: () => void }) {
  return <div className="microsoft-mail-error-wrap">
    <div className="error microsoft-mail-error">{schoolMailStateMessage(errorCode)}</div>
    <button className="mini" onClick={onRetry} type="button">다시 시도</button>
  </div>;
}

export function schoolMailStatusLabel(status: SchoolMailStatus, errorCode: ThunderbirdMailErrorCode | null): string {
  if (status === 'loading') return '확인 중';
  if (status === 'ready' || status === 'empty') return 'Thunderbird ● 로컬';
  if (status === 'bridge_offline') return '브리지 오프라인';
  if (status === 'thunderbird_not_found') return 'Thunderbird 없음';
  if (status === 'sync_required') return '동기화 필요';
  if (errorCode === 'bridge_auth') return '브리지 설정 필요';
  return '로컬 메일 오류';
}

export function schoolMailStateMessage(errorCode: ThunderbirdMailErrorCode | null): string {
  if (errorCode === 'folder_not_found') return '학교 업무 폴더를 찾지 못했어.';
  if (errorCode === 'profile_not_found' || errorCode === 'account_not_found' || errorCode === 'inbox_not_found') {
    return 'Thunderbird 학교 계정 또는 받은편지함을 찾지 못했어.';
  }
  if (errorCode === 'local_sync_required') return thunderbirdMailErrorMessage('local_sync_required');
  if (errorCode === 'bridge_auth') return 'Settings에서 Local Bridge token을 확인해줘.';
  return errorCode ? thunderbirdMailErrorMessage(errorCode) : '학교 메일을 읽지 못했어.';
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

function statusForError(errorCode: ThunderbirdMailErrorCode): SchoolMailStatus {
  if (errorCode === 'bridge_offline') return 'bridge_offline';
  if (errorCode === 'thunderbird_not_installed') return 'thunderbird_not_found';
  if (errorCode === 'local_sync_required') return 'sync_required';
  return 'error';
}

function readErrorCode(error: unknown): ThunderbirdMailErrorCode {
  if (error instanceof ThunderbirdMailError) return error.code;
  if (error instanceof MailAnalysisClientError) {
    if (error.code === 'bridge_auth') return 'bridge_auth';
    return error.code === 'bridge_offline' ? 'bridge_offline' : 'parse_error';
  }
  return 'bridge_offline';
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
