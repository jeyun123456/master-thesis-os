'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  getRecentThunderbirdMail,
  openThunderbird,
  thunderbirdMailErrorMessage,
  ThunderbirdMailError,
  type ThunderbirdMail,
  type ThunderbirdMailErrorCode,
} from '../lib/thunderbird-mail';
import {
  mailPriorityLabel,
  prioritizeMails,
  type MailPriority,
  type PrioritizedMail,
} from '../lib/mail-priority';

type SchoolMailPanelVariant = 'home' | 'settings';
type SchoolMailStatus = 'loading' | 'ready' | 'empty' | 'bridge_offline' | 'thunderbird_not_found' | 'sync_required' | 'error';

export function SchoolMailPanel({ variant }: { variant: SchoolMailPanelVariant }) {
  const [status, setStatus] = useState<SchoolMailStatus>('loading');
  const [errorCode, setErrorCode] = useState<ThunderbirdMailErrorCode | null>(null);
  const [account, setAccount] = useState('');
  const [items, setItems] = useState<PrioritizedMail[]>([]);
  const [openState, setOpenState] = useState<'idle' | 'opening' | 'opened'>('idle');
  const [openError, setOpenError] = useState<ThunderbirdMailErrorCode | null>(null);

  const loadMail = useCallback(async () => {
    setStatus('loading');
    setErrorCode(null);
    setItems([]);
    try {
      const result = await getRecentThunderbirdMail(readBridgeToken(), fetch, 20);
      const prioritizedItems = prioritizeMails(result.items);
      setAccount(result.account);
      setItems(prioritizedItems);
      setStatus(prioritizedItems.length ? 'ready' : 'empty');
    } catch (error) {
      const nextCode = readErrorCode(error);
      setAccount('');
      setItems([]);
      setErrorCode(nextCode);
      setStatus(statusForError(nextCode));
    }
  }, []);

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

  const hasOpenButton = status !== 'loading' && errorCode !== 'thunderbird_not_installed';
  const openLabel = openState === 'opening' ? 'Thunderbird 여는 중…' : openState === 'opened' ? 'Thunderbird 열림' : 'Thunderbird 열기';

  return <section className="card section microsoft-mail-card school-mail-card">
    <div className="head"><h3>학교 메일</h3><span>{schoolMailStatusLabel(status, errorCode)}</span></div>
    <div className="muted"><small>Thunderbird · 로컬 읽기 전용{account ? ` · ${account}` : ''}</small></div>
    {variant === 'settings' && <div className="note">Thunderbird가 이 컴퓨터에 동기화한 학교 메일의 헤더만 Local Bridge로 읽어와. Microsoft Graph OAuth token과 Thunderbird 인증정보는 읽지 않아.<br />중요 메일 자동 선별: 켜짐</div>}
    {status === 'loading' && <div className="microsoft-mail-state">Thunderbird 로컬 메일을 확인하는 중이야…</div>}
    {(status === 'ready' || status === 'empty') && (items.length ? <div className="microsoft-mail-list">{items.map((item, index) => <SchoolMailRow item={item} key={schoolMailRowKey(item, index)} />)}</div> : <div className="empty compact-empty">최근 학교 메일이 없어.</div>)}
    {status !== 'loading' && status !== 'ready' && status !== 'empty' && <SchoolMailErrorState errorCode={errorCode} onRetry={() => void loadMail()} />}
    {openError && <div className="error school-mail-open-error">{thunderbirdMailErrorMessage(openError)}</div>}
    {(hasOpenButton || variant === 'settings') && <div className="toolbar school-mail-actions">
      {hasOpenButton && <button className="btn" disabled={openState === 'opening'} onClick={() => void handleOpenThunderbird()} type="button">{openLabel}</button>}
      <button className="mini" onClick={() => void loadMail()} type="button">새로고침</button>
    </div>}
  </section>;
}

function SchoolMailRow({ item }: { item: PrioritizedMail }) {
  const priorityLabel = mailPriorityLabel(item.priority);
  return <div className={schoolMailRowClass(item.isRead, item.priority)}>
    <span className={`microsoft-mail-dot${item.isRead ? '' : ' unread'}`} aria-label={item.isRead ? '읽음' : '미읽음'}>{schoolMailIndicator(item.isRead)}</span>
    <span className="microsoft-mail-main">
      <b>{priorityLabel && <span className={`school-mail-priority-label ${item.priority}`}>{priorityLabel}</span>}{!item.isRead && <span className="microsoft-mail-unread-label">미읽음</span>}{item.subject}</b>
      <small>{item.senderName}{item.senderAddress && ` · ${item.senderAddress}`} · <time dateTime={item.receivedAt} title={formatMailDate(item.receivedAt)}>{relativeMailDate(item.receivedAt)}</time></small>
      {item.priorityReason && <small className="school-mail-priority-reason">{item.priorityReason}</small>}
    </span>
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
  return 'bridge_offline';
}

function readBridgeToken(): string {
  try {
    return localStorage.getItem('thesisBridgeToken') || '';
  } catch {
    return '';
  }
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
