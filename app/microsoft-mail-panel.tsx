'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  acquireMicrosoftGraphToken,
  classifyMicrosoftAuthError,
  initializeMicrosoftAuth,
  isMicrosoftConfigured,
  loginMicrosoft,
  logoutMicrosoft,
  microsoftAuthErrorMessage,
  MicrosoftAuthError,
  type MicrosoftAuthErrorCode,
} from '@/lib/microsoft-auth';
import {
  getRecentOutlookMail,
  outlookMailErrorMessage,
  OutlookMailError,
  type OutlookMail,
  type OutlookMailErrorCode,
} from '@/lib/outlook-mail';
import type { AccountInfo } from '@azure/msal-browser';

type MicrosoftMailPanelVariant = 'home' | 'settings';
type MicrosoftMailStatus = 'checking' | 'unconfigured' | 'signed_out' | 'connecting' | 'ready' | 'error';
type MicrosoftMailErrorCode = MicrosoftAuthErrorCode | OutlookMailErrorCode;

const OUTLOOK_WEB_URL = 'https://outlook.office.com/mail/';

export function MicrosoftMailPanel({ variant }: { variant: MicrosoftMailPanelVariant }) {
  const [status, setStatus] = useState<MicrosoftMailStatus>('checking');
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [items, setItems] = useState<OutlookMail[]>([]);
  const [errorCode, setErrorCode] = useState<MicrosoftMailErrorCode | null>(null);

  const loadConnection = useCallback(async () => {
    if (!isMicrosoftConfigured()) {
      setAccount(null);
      setItems([]);
      setErrorCode(null);
      setStatus('unconfigured');
      return;
    }

    setStatus('connecting');
    setErrorCode(null);
    try {
      const nextAccount = await initializeMicrosoftAuth();
      if (!nextAccount) {
        setAccount(null);
        setItems([]);
        setStatus('signed_out');
        return;
      }
      setAccount(nextAccount);
      const accessToken = await acquireMicrosoftGraphToken(nextAccount);
      const nextItems = await getRecentOutlookMail(accessToken);
      setItems(nextItems);
      setStatus('ready');
    } catch (error) {
      setItems([]);
      setErrorCode(readErrorCode(error));
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    // Keep Microsoft failures local to this card so the existing dashboard load is unaffected.
    void loadConnection();
  }, [loadConnection]);

  async function connect() {
    setStatus('connecting');
    setErrorCode(null);
    try {
      await loginMicrosoft();
    } catch (error) {
      setErrorCode(readErrorCode(error));
      setStatus('error');
    }
  }

  async function disconnect() {
    setItems([]);
    setAccount(null);
    setErrorCode(null);
    setStatus('signed_out');
    try {
      await logoutMicrosoft();
    } catch (error) {
      setErrorCode(readErrorCode(error));
      setStatus('error');
    }
  }

  if (variant === 'settings') {
    return <MicrosoftSettingsCard
      account={account}
      errorCode={errorCode}
      onConnect={() => void connect()}
      onDisconnect={() => void disconnect()}
      onRetry={() => void loadConnection()}
      status={status}
    />;
  }

  return <MicrosoftMailCard
    errorCode={errorCode}
    items={items}
    onRetry={() => void loadConnection()}
    status={status}
  />;
}

function MicrosoftMailCard({
  errorCode,
  items,
  onRetry,
  status,
}: {
  errorCode: MicrosoftMailErrorCode | null;
  items: OutlookMail[];
  onRetry: () => void;
  status: MicrosoftMailStatus;
}) {
  return <section className="card section microsoft-mail-card">
    <div className="head"><h3>학교 메일</h3><span>{statusLabel(status, errorCode)}</span></div>
    {status === 'checking' && <div className="microsoft-mail-state">Microsoft 365 연결 상태를 확인하는 중이야…</div>}
    {status === 'connecting' && <div className="microsoft-mail-state">Microsoft 365 로그인과 학교 메일을 확인하는 중이야…</div>}
    {status === 'unconfigured' && <div className="empty compact-empty">설정에서 Microsoft 365 연결 정보를 먼저 등록해줘.</div>}
    {status === 'signed_out' && <div className="empty compact-empty">설정에서 리츠메이칸 Microsoft 365 계정을 연결해줘.</div>}
    {status === 'error' && <MailErrorState errorCode={errorCode} onRetry={onRetry} />}
    {status === 'ready' && (items.length ? <div className="microsoft-mail-list">{items.map((item) => <MailRow item={item} key={item.id} />)}</div> : <div className="empty compact-empty">최근 학교 메일이 없어.</div>)}
    {status === 'ready' && <a className="microsoft-mail-outlook-link" href={OUTLOOK_WEB_URL} rel="noreferrer" target="_blank">Outlook에서 열기 ↗</a>}
  </section>;
}

function MicrosoftSettingsCard({
  account,
  errorCode,
  onConnect,
  onDisconnect,
  onRetry,
  status,
}: {
  account: AccountInfo | null;
  errorCode: MicrosoftMailErrorCode | null;
  onConnect: () => void;
  onDisconnect: () => void;
  onRetry: () => void;
  status: MicrosoftMailStatus;
}) {
  const hasAccount = Boolean(account);
  return <section className="card section microsoft-settings-card">
    <div className="head"><h3>Microsoft Graph (선택)</h3><span>{statusLabel(status, errorCode)}</span></div>
    <div className="note">현재 기본 학교 메일 소스는 Thunderbird Local이야. Graph는 학교 tenant 관리자 승인 후 사용할 수 있는 보조 연결로 유지해.</div>
    {account && <div className="microsoft-account"><b>{account.name || account.username}</b><small>{account.username}</small></div>}
    {status === 'checking' && <div className="microsoft-mail-state">연결 상태를 확인하는 중이야…</div>}
    {status === 'connecting' && <div className="microsoft-mail-state">로그인 중이야… 학교 MFA 또는 consent 화면이 열릴 수 있어.</div>}
    {status === 'unconfigured' && <div className="empty compact-empty">NEXT_PUBLIC_MICROSOFT_CLIENT_ID 설정이 필요해.</div>}
    {status === 'signed_out' && <div className="microsoft-mail-state">현재 연결된 Microsoft 365 계정이 없어.</div>}
    {status === 'error' && <MailErrorState errorCode={errorCode} onRetry={onRetry} />}
    <div className="toolbar microsoft-settings-actions">
      {status !== 'unconfigured' && !hasAccount && <button className="btn primary" disabled={status === 'checking' || status === 'connecting'} onClick={onConnect} type="button">Microsoft Graph 연결(선택)</button>}
      {status === 'error' && hasAccount && <button className="btn primary" onClick={onConnect} type="button">다시 연결</button>}
      {hasAccount && <button className="btn" disabled={status === 'connecting'} onClick={onDisconnect} type="button">연결 해제</button>}
    </div>
    <small className="microsoft-settings-help">Graph access token은 MSAL의 sessionStorage cache에서만 관리하고 앱 서버·DB·환경변수에는 저장하지 않아.</small>
  </section>;
}

function MailErrorState({ errorCode, onRetry }: { errorCode: MicrosoftMailErrorCode | null; onRetry: () => void }) {
  return <div className="microsoft-mail-error-wrap">
    <div className="error microsoft-mail-error">{errorMessage(errorCode)}</div>
    <button className="mini" onClick={onRetry} type="button">다시 시도</button>
  </div>;
}

function MailRow({ item }: { item: OutlookMail }) {
  const content = <>
    <span className={`microsoft-mail-dot${item.isRead ? '' : ' unread'}`} aria-hidden="true">{item.isRead ? '○' : '●'}</span>
    <span className="microsoft-mail-main">
      <b>{!item.isRead && <span className="microsoft-mail-unread-label">미읽음</span>}{item.subject}</b>
      <small>{item.senderName}{item.senderAddress && ` · ${item.senderAddress}`} · <time dateTime={item.receivedDateTime} title={formatMailDate(item.receivedDateTime)}>{relativeMailDate(item.receivedDateTime)}</time></small>
    </span>
  </>;

  return item.webLink
    ? <a className={`microsoft-mail-row${item.isRead ? '' : ' unread'}`} href={item.webLink} rel="noreferrer" target="_blank">{content}</a>
    : <div className={`microsoft-mail-row${item.isRead ? '' : ' unread'}`}>{content}</div>;
}

function readErrorCode(error: unknown): MicrosoftMailErrorCode {
  if (error instanceof MicrosoftAuthError) return error.code;
  if (error instanceof OutlookMailError) return error.code;
  return classifyMicrosoftAuthError(error);
}

function errorMessage(errorCode: MicrosoftMailErrorCode | null): string {
  if (!errorCode) return 'Microsoft 365 연결에 실패했어. 다시 시도해줘.';
  if (isOutlookMailErrorCode(errorCode)) return outlookMailErrorMessage(errorCode);
  return microsoftAuthErrorMessage(errorCode);
}

function isOutlookMailErrorCode(code: MicrosoftMailErrorCode): code is OutlookMailErrorCode {
  return ['unauthorized', 'consent_required', 'rate_limited', 'network_error', 'malformed_response', 'graph_error'].includes(code);
}

function statusLabel(status: MicrosoftMailStatus, errorCode: MicrosoftMailErrorCode | null): string {
  if (status === 'checking') return '확인 중';
  if (status === 'unconfigured') return '설정 안 됨';
  if (status === 'signed_out') return '연결 안 됨';
  if (status === 'connecting') return '로그인 중';
  if (status === 'ready') return 'Graph ●';
  if (errorCode === 'consent_required' || errorCode === 'admin_approval_required') return '관리자 승인 필요 가능성';
  if (errorCode === 'unauthorized') return '권한 거부';
  return 'Graph 오류';
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
