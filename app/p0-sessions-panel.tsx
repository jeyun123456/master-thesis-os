'use client';

import { useCallback, useEffect, useState } from 'react';
import { notifyP0SessionInvalid } from '@/lib/p0-tasks-client';

type DeviceSession = { id: string; device_label: string; created_at: string; expires_at: string; revoked: boolean };
type SessionList = { current: string; sessions: DeviceSession[] };

export function P0SessionsPanel() {
  const [result, setResult] = useState<SessionList | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/p0/sessions', { cache: 'no-store' });
      notifyP0SessionInvalid(response);
      const data = await response.json() as SessionList & { error?: string };
      if (!response.ok) throw new Error(data.error || 'P0 기기 세션을 불러오지 못했어.');
      setResult(data);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'P0 기기 세션을 불러오지 못했어.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function revoke(session: DeviceSession) {
    if (session.id === result?.current || session.revoked || busyId) return;
    if (!window.confirm(`“${session.device_label || '이름 없는 기기'}” 세션을 폐기할까? 해당 기기는 다시 로그인해야 해.`)) return;
    setBusyId(session.id);
    setError('');
    try {
      const response = await fetch(`/api/p0/sessions/${encodeURIComponent(session.id)}`, { method: 'DELETE' });
      notifyP0SessionInvalid(response);
      const data = await response.json() as { revoked?: boolean; error?: string };
      if (!response.ok || !data.revoked) throw new Error(data.error || '해당 세션을 폐기하지 못했어.');
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '기기 세션을 폐기하지 못했어.');
    } finally {
      setBusyId('');
    }
  }

  return <section className="card section" aria-labelledby="p0-sessions-title">
    <div className="head">
      <div><h3 id="p0-sessions-title">로그인된 기기</h3><small>P0 서버에서 세션을 확인하고 분실 기기를 폐기할 수 있어.</small></div>
      <button className="mini" type="button" disabled={loading} onClick={() => void load()}>새로고침</button>
    </div>
    {loading && <p className="note" role="status">세션 목록을 확인하는 중…</p>}
    {error && <p className="error" role="alert">{error}</p>}
    {!loading && result && <div className="p0-session-list">
      {result.sessions.length === 0 && <p className="empty compact-empty">등록된 기기 세션이 없어.</p>}
      {result.sessions.map((session) => {
        const current = session.id === result.current;
        return <div className="p0-session-row" key={session.id}>
          <div>
            <b>{session.device_label || '이름 없는 기기'}{current ? ' · 현재 기기' : ''}</b>
            <small>로그인 {formatDate(session.created_at)} · 만료 {formatDate(session.expires_at)}{session.revoked ? ' · 폐기됨' : ''}</small>
          </div>
          {!current && !session.revoked && <button className="mini" type="button" disabled={Boolean(busyId)} onClick={() => void revoke(session)}>{busyId === session.id ? '폐기 중…' : '세션 폐기'}</button>}
        </div>;
      })}
    </div>}
  </section>;
}

function formatDate(value: string) {
  try {
    return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Tokyo', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  } catch {
    return value;
  }
}
