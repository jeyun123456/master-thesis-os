'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getRecentGmail, GmailClientError } from '../lib/gmail-client';
import type { GmailMessage } from '../lib/gmail';
import { filterAndSortMailItems, DEFAULT_MAIL_LIST_PREFERENCES } from '../lib/mail-list';
import { prioritizeMail, type PrioritizedMail } from '../lib/mail-priority';
import { SchoolMailRow, schoolMailRowKey } from './school-mail-panel';

type GmailPanelStatus = 'loading' | 'ready' | 'empty' | 'unconfigured' | 'error';

export function GmailMailPanel() {
  const [status, setStatus] = useState<GmailPanelStatus>('loading');
  const [account, setAccount] = useState('');
  const [items, setItems] = useState<GmailMessage[]>([]);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setStatus('loading');
    setErrorCode(null);
    try {
      const result = await getRecentGmail(fetch, 20);
      setAccount(result.account);
      setItems(result.items);
      setStatus(result.state);
    } catch (error) {
      setItems([]);
      setStatus('error');
      setErrorCode(error instanceof GmailClientError ? error.code : 'network_error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const prioritized = useMemo(
    () => filterAndSortMailItems(
      items.map((item) => prioritizeMail(item)),
      DEFAULT_MAIL_LIST_PREFERENCES,
    ),
    [items],
  );

  async function openMail(item: PrioritizedMail) {
    const gmail = items.find((value) => value.id === item.id);
    if (!gmail) return;
    setOpeningId(item.id);
    window.open(gmail.webUrl, '_blank', 'noopener,noreferrer');
    setOpeningId(null);
  }

  return <section className="card section microsoft-mail-card school-mail-card">
    <div className="head"><h3>Gmail</h3><span>{statusLabel(status)}</span></div>
    <div className="muted"><small>{account || 'Google OAuth'} · Gmail API · 읽기 전용</small></div>
    {status === 'loading' && <div className="microsoft-mail-state">Gmail 받은편지함을 읽는 중이야…</div>}
    {(status === 'ready' || status === 'empty') && (prioritized.length
      ? <div className="microsoft-mail-list">{prioritized.map((item, index) => <SchoolMailRow
          item={item}
          isOpening={openingId === item.id}
          key={schoolMailRowKey(item, index)}
          onOpen={openMail}
          showNormalPriorityLabel
        />)}</div>
      : <div className="empty compact-empty">최근 Gmail 메일이 없어.</div>)}
    {status === 'unconfigured' && <div className="note">Google OAuth 설정이 필요해.</div>}
    {status === 'error' && <div className="microsoft-mail-error-wrap">
      <div className="error microsoft-mail-error">{errorMessage(errorCode)}</div>
      <button className="mini" onClick={() => void load()} type="button">다시 시도</button>
    </div>}
    <div className="toolbar school-mail-actions">
      <button className="mini" onClick={() => void load()} type="button">새로고침</button>
    </div>
  </section>;
}

function statusLabel(status: GmailPanelStatus): string {
  if (status === 'loading') return '확인 중';
  if (status === 'ready' || status === 'empty') return 'Google ● 연결됨';
  if (status === 'unconfigured') return '설정 필요';
  return 'Gmail 오류';
}

function errorMessage(code: string | null): string {
  if (code === 'auth_error') return 'Google OAuth 인증이 만료됐어.';
  if (code === 'insufficient_permissions') return 'Gmail 읽기 권한이 없어. gmail.readonly scope를 확인해줘.';
  if (code === 'quota_error') return 'Gmail API quota 또는 rate limit을 확인해줘.';
  if (code === 'provider_bad_request') return 'Gmail API 요청이 거부됐어.';
  return 'Gmail 연결을 확인해줘.';
}
