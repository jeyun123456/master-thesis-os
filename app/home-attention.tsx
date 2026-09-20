'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  getPortalNotices,
  PortalNoticesClientError,
  readPortalBridgeToken,
  type PortalNoticeSummary,
  type PortalSyncStatus,
} from '@/lib/portal-notices-client';

type PortalAttentionState = 'loading' | 'ready' | 'empty' | 'error';

const initialSync: PortalSyncStatus = {
  source: 'ritsumei',
  lastSyncAt: null,
  status: 'idle',
  storedCount: 0,
  counts: { ALL: 0, DM: 0 },
  totalCount: 0,
  newCount: 0,
  updatedCount: 0,
  detailFailedCount: 0,
  session: { state: 'unknown' },
  jobRunning: false,
};

export function PortalAttention({ onOpen }: { onOpen: () => void }) {
  const [state, setState] = useState<PortalAttentionState>('loading');
  const [items, setItems] = useState<PortalNoticeSummary[]>([]);
  const [sync, setSync] = useState<PortalSyncStatus>(initialSync);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setState('loading');
    setError('');
    try {
      const response = await getPortalNotices(readPortalBridgeToken(), { limit: 500 });
      setItems(response.items);
      setSync(response.sync);
      setState(response.items.length ? 'ready' : 'empty');
    } catch (nextError) {
      setItems([]);
      setState('error');
      setError(portalAttentionError(nextError));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const unread = items.filter((item) => !item.isRead && !item.isArchived).length;
  const important = items.filter((item) => item.isImportant && !item.isArchived).length;
  const statusLabel = state === 'loading'
    ? '확인 중'
    : state === 'error'
      ? '확인 필요'
      : unread > 0 || important > 0
        ? '주의 필요'
        : '정리됨';

  return <section className="card section home-attention-card portal-attention-card">
    <div className="head"><h3>학교 공지</h3><span>{statusLabel}</span></div>
    {state === 'loading' && <div className="home-attention-state">저장된 공지 상태를 확인하는 중이야…</div>}
    {state === 'error' && <div className="home-attention-state home-attention-error">{error}</div>}
    {state === 'empty' && <div className="empty compact-empty">저장된 학교 공지가 없어.</div>}
    {state === 'ready' && <>
      <div className="attention-metrics" aria-label="학교 공지 요약">
        <div><span>미읽음</span><strong>{unread}</strong></div>
        <div><span>중요</span><strong>{important}</strong></div>
        <div><span>최근 신규</span><strong>{sync.newCount}</strong></div>
      </div>
      <p className="home-attention-note">학교 포털에 저장된 목록 기준 · 상세 탭에서 확인</p>
    </>}
    <div className="home-attention-actions">
      <button className="mini" type="button" onClick={onOpen}>공지 열기</button>
      <button className="mini" type="button" onClick={() => void load()}>새로고침</button>
    </div>
  </section>;
}

function portalAttentionError(error: unknown) {
  if (error instanceof PortalNoticesClientError && error.code === 'bridge_auth') return 'Settings에서 Local Bridge token을 확인해줘.';
  if (error instanceof PortalNoticesClientError && error.code === 'bridge_offline') return 'Local Bridge가 실행 중인지 확인해줘.';
  return '학교 공지 상태를 읽지 못했어.';
}
