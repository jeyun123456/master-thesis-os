'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getGmailDetail, getRecentGmail, GmailClientError } from '../lib/gmail-client';
import { fromGmail } from '../lib/detail-model';
import type { GmailMessage } from '../lib/gmail';
import { filterAndSortMailItems, DEFAULT_MAIL_LIST_PREFERENCES } from '../lib/mail-list';
import { prioritizeMail, type PrioritizedMail } from '../lib/mail-priority';
import { DetailDrawer, useDetailSelection, useSelectedDetail } from './detail-drawer';
import { DetailState, MailDetailBody, SourceActions } from './detail-views';
import { MailErrorNotice } from './mail-error-notice';
import { SchoolMailRow, schoolMailRowKey } from './school-mail-panel';

type GmailPanelStatus = 'loading' | 'ready' | 'empty' | 'unconfigured' | 'error';

export function GmailMailPanel() {
  const [status, setStatus] = useState<GmailPanelStatus>('loading');
  const [account, setAccount] = useState('');
  const [items, setItems] = useState<GmailMessage[]>([]);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const { selectedId, select, close } = useDetailSelection('gmail');
  const detail = useSelectedDetail(selectedId, async (id) => (await getGmailDetail(id)).message, 'Gmail 메일을 열지 못했어.');
  const model = useMemo(() => (detail.data ? fromGmail(detail.data) : null), [detail.data]);
  const preview = items.find((value) => value.id === selectedId);

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

  const openMail = (item: PrioritizedMail) => select(item.id);

  return <section className="card section microsoft-mail-card school-mail-card">
    <div className="head"><h3>Gmail</h3><span>{statusLabel(status)}</span></div>
    <div className="muted"><small>{account || 'Google OAuth'} · Gmail API · 읽기 전용</small></div>
    {status === 'loading' && <div className="microsoft-mail-state">Gmail 받은편지함을 읽는 중이야…</div>}
    {(status === 'ready' || status === 'empty') && (prioritized.length
      ? <div className="microsoft-mail-list">{prioritized.map((item, index) => <SchoolMailRow
          item={item}
          key={schoolMailRowKey(item, index)}
          onOpen={openMail}
        />)}</div>
      : <div className="empty compact-empty">최근 Gmail 메일이 없어.</div>)}
    {status === 'unconfigured' && <div className="note">Google OAuth 설정이 필요해.</div>}
    {status === 'error' && <MailErrorNotice message={errorMessage(errorCode)} code={errorCode} onRetry={() => void load()} />}
    <div className="toolbar school-mail-actions">
      <button className="mini" onClick={() => void load()} type="button">새로고침</button>
    </div>
    <DetailDrawer open={selectedId !== null} title={model?.subject ?? preview?.subject ?? '메일'} onClose={close}
      footer={model ? <SourceActions source={model.source} kind="gmail" /> : undefined}>
      <DetailState loading={detail.loading} error={detail.error} onRetry={detail.retry} />
      {!model && preview && !detail.error && <p className="muted"><small>{preview.snippet}</small></p>}
      {model && <MailDetailBody mail={model} />}
    </DetailDrawer>
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
