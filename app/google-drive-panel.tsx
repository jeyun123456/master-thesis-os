'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getRecentGoogleDriveFiles, GoogleDriveClientError } from '../lib/google-drive-client';
import type { GoogleDriveFile } from '../lib/google-drive';

type DrivePanelStatus = 'loading' | 'ready' | 'empty' | 'unconfigured' | 'error';

export function GoogleDrivePanel() {
  const [status, setStatus] = useState<DrivePanelStatus>('loading');
  const [items, setItems] = useState<GoogleDriveFile[]>([]);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    setStatus('loading');
    setErrorCode(null);
    try {
      const result = await getRecentGoogleDriveFiles(fetch, 50);
      setItems(result.items);
      setStatus(result.state);
    } catch (error) {
      setItems([]);
      setStatus('error');
      setErrorCode(error instanceof GoogleDriveClientError ? error.code : 'network_error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return items;
    return items.filter((item) => `${item.name} ${item.mimeType} ${item.kind}`.toLocaleLowerCase().includes(normalized));
  }, [items, query]);

  return <section className="card section google-drive-card">
    <div className="head"><h3>Google Drive</h3><span>{statusLabel(status)}</span></div>
    <div className="muted"><small>Google OAuth · Drive API · 읽기 전용 · 최근 수정 파일</small></div>
    {(status === 'ready' || status === 'empty') && <div className="library-toolbar google-drive-toolbar">
      <input className="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Drive 파일명 검색" />
      <button className="mini" onClick={() => void load()} type="button">새로고침</button>
    </div>}
    {status === 'loading' && <div className="microsoft-mail-state">Google Drive 파일을 읽는 중이야…</div>}
    {(status === 'ready' || status === 'empty') && <>
      <div className="library-section-heading compact-heading"><div><h3>최근 수정 파일</h3><p>최근 수정 순으로 최대 50개를 표시해.</p></div><span>{filtered.length} / {items.length}</span></div>
      <div className="library-list">
        {filtered.map((item) => <DriveRow item={item} key={item.id} />)}
        {filtered.length === 0 && <div className="library-empty">조건에 맞는 Drive 파일이 없어.</div>}
      </div>
    </>}
    {status === 'unconfigured' && <div className="note">Google OAuth 설정이 필요해.</div>}
    {status === 'error' && <div className="microsoft-mail-error-wrap">
      <div className="error microsoft-mail-error">{errorMessage(errorCode)}</div>
      <button className="mini" onClick={() => void load()} type="button">다시 시도</button>
    </div>}
  </section>;
}

function DriveRow({ item }: { item: GoogleDriveFile }) {
  return <div className="library-row">
    <span className="resource-badge">{kindLabel(item.kind)}</span>
    <div className="library-row-main">
      <h4>{item.name}</h4>
      <p>{formatModified(item.modifiedTime)}{item.size !== null ? ` · ${formatBytes(item.size)}` : ''}</p>
    </div>
    <a className="mini" href={item.webViewLink} rel="noreferrer" target="_blank">열기</a>
  </div>;
}

function kindLabel(kind: GoogleDriveFile['kind']): string {
  if (kind === 'folder') return '폴더';
  if (kind === 'document') return 'Docs';
  if (kind === 'spreadsheet') return 'Sheets';
  if (kind === 'presentation') return 'Slides';
  if (kind === 'pdf') return 'PDF';
  return '파일';
}

function statusLabel(status: DrivePanelStatus): string {
  if (status === 'loading') return '확인 중';
  if (status === 'ready' || status === 'empty') return 'Google ● 연결됨';
  if (status === 'unconfigured') return '설정 필요';
  return 'Drive 오류';
}

function errorMessage(code: string | null): string {
  if (code === 'auth_error') return 'Google OAuth 인증이 만료됐어.';
  if (code === 'insufficient_permissions') return 'Google Drive 읽기 권한이 없어. drive.readonly scope를 확인해줘.';
  if (code === 'quota_error') return 'Google Drive API quota 또는 rate limit을 확인해줘.';
  if (code === 'provider_bad_request') return 'Google Drive API 요청이 거부됐어.';
  return 'Google Drive 연결을 확인해줘.';
}

function formatModified(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '수정 시간 없음';
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`;
}
