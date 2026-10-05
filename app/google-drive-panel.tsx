'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getGoogleDriveContent,
  getRecentGoogleDriveFiles,
  GoogleDriveClientError,
} from '../lib/google-drive-client';
import {
  googleDriveContentReadable,
  type GoogleDriveFile,
  type GoogleDriveFileContent,
} from '../lib/google-drive';

type DrivePanelStatus = 'loading' | 'ready' | 'empty' | 'unconfigured' | 'error';
type ContentStatus = 'idle' | 'loading' | 'ready' | 'error';

export function GoogleDrivePanel() {
  const [status, setStatus] = useState<DrivePanelStatus>('loading');
  const [items, setItems] = useState<GoogleDriveFile[]>([]);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [contentStatus, setContentStatus] = useState<ContentStatus>('idle');
  const [contentErrorCode, setContentErrorCode] = useState<string | null>(null);
  const [selectedContent, setSelectedContent] = useState<GoogleDriveFileContent | null>(null);
  const [contentQuery, setContentQuery] = useState('');

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

  const contentMatches = useMemo(() => {
    if (!selectedContent) return [];
    const normalized = contentQuery.trim().toLocaleLowerCase();
    if (!normalized) return [];
    return selectedContent.content
      .split(/\r?\n/)
      .map((line, index) => ({ line, lineNumber: index + 1 }))
      .filter(({ line }) => line.toLocaleLowerCase().includes(normalized))
      .slice(0, 50);
  }, [contentQuery, selectedContent]);

  async function loadContent(item: GoogleDriveFile) {
    if (!googleDriveContentReadable(item)) return;
    setContentStatus('loading');
    setContentErrorCode(null);
    setContentQuery('');
    try {
      const result = await getGoogleDriveContent(item.id);
      setSelectedContent(result);
      setContentStatus('ready');
    } catch (error) {
      setSelectedContent(null);
      setContentStatus('error');
      setContentErrorCode(error instanceof GoogleDriveClientError ? error.code : 'network_error');
    }
  }

  function closeContent() {
    setSelectedContent(null);
    setContentStatus('idle');
    setContentErrorCode(null);
    setContentQuery('');
  }

  return <section className="card section google-drive-card">
    <div className="head"><h3>Google Drive</h3><span>{statusLabel(status)}</span></div>
    <div className="muted"><small>Google OAuth · Drive API · 읽기 전용 · 최근 수정 파일</small></div>
    {(status === 'ready' || status === 'empty') && <div className="library-toolbar google-drive-toolbar">
      <input className="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Drive 파일명 검색" />
      <button className="mini" onClick={() => void load()} type="button">새로고침</button>
    </div>}
    {status === 'loading' && <div className="microsoft-mail-state">Google Drive 파일을 읽는 중이야…</div>}
    {(status === 'ready' || status === 'empty') && <>
      <div className="library-section-heading compact-heading"><div><h3>최근 수정 파일</h3><p>최근 수정 순으로 최대 50개를 표시해. Docs·Slides·텍스트는 본문, Sheets는 첫 시트를 읽을 수 있어.</p></div><span>{filtered.length} / {items.length}</span></div>
      <div className="library-list">
        {filtered.map((item) => <DriveRow item={item} key={item.id} onRead={loadContent} />)}
        {filtered.length === 0 && <div className="library-empty">조건에 맞는 Drive 파일이 없어.</div>}
      </div>
    </>}
    {status === 'unconfigured' && <div className="note">Google OAuth 설정이 필요해.</div>}
    {status === 'error' && <div className="microsoft-mail-error-wrap">
      <div className="error microsoft-mail-error">{errorMessage(errorCode)}</div>
      <button className="mini" onClick={() => void load()} type="button">다시 시도</button>
    </div>}

    {contentStatus !== 'idle' && <div className="google-drive-content-panel">
      <div className="google-drive-content-head">
        <div>
          <h3>{selectedContent?.file.name || 'Drive 내용'}</h3>
          <p>{contentStatus === 'loading' ? '파일 내용을 불러오는 중이야…' : selectedContent ? contentMeta(selectedContent) : '내용을 읽지 못했어.'}</p>
        </div>
        <button className="mini" onClick={closeContent} type="button">닫기</button>
      </div>

      {contentStatus === 'loading' && <div className="microsoft-mail-state">파일 내용을 읽는 중이야…</div>}
      {contentStatus === 'error' && <div className="error microsoft-mail-error">{contentErrorMessage(contentErrorCode)}</div>}

      {contentStatus === 'ready' && selectedContent && <>
        <div className="library-toolbar google-drive-content-toolbar">
          <input
            className="search"
            value={contentQuery}
            onChange={(event) => setContentQuery(event.target.value)}
            placeholder="이 파일 내용에서 검색"
          />
          <a className="mini" href={selectedContent.file.webViewLink} rel="noreferrer" target="_blank">원본 열기</a>
        </div>
        {selectedContent.truncated && <div className="note">파일이 커서 앞 200,000자까지만 미리보기와 검색에 사용하고 있어.</div>}
        {contentQuery.trim() ? <div className="google-drive-content-matches">
          <div className="library-section-heading compact-heading"><div><h3>검색 결과</h3></div><span>{contentMatches.length}{contentMatches.length === 50 ? '+' : ''}개</span></div>
          {contentMatches.length
            ? <div className="library-list">{contentMatches.map((match) => <div className="google-drive-match" key={match.lineNumber}><span>{match.lineNumber}</span><p>{match.line || ' '}</p></div>)}</div>
            : <div className="library-empty">일치하는 내용이 없어.</div>}
        </div> : <pre className="google-drive-content-preview">{selectedContent.content || '(내용 없음)'}</pre>}
      </>}
    </div>}
  </section>;
}

function DriveRow({ item, onRead }: { item: GoogleDriveFile; onRead: (item: GoogleDriveFile) => void | Promise<void> }) {
  const readable = googleDriveContentReadable(item);
  return <div className="library-row google-drive-row">
    <span className="resource-badge">{kindLabel(item.kind)}</span>
    <div className="library-row-main">
      <h4>{item.name}</h4>
      <p>{formatModified(item.modifiedTime)}{item.size !== null ? ` · ${formatBytes(item.size)}` : ''}{readable ? ' · 내용 읽기 가능' : ''}</p>
    </div>
    <div className="google-drive-row-actions">
      {readable && <button className="mini" onClick={() => void onRead(item)} type="button">내용</button>}
      <a className="mini" href={item.webViewLink} rel="noreferrer" target="_blank">열기</a>
    </div>
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

function contentErrorMessage(code: string | null): string {
  if (code === 'unsupported_content') return '이 파일 형식은 아직 텍스트 내용 추출을 지원하지 않아. 원본 열기를 사용해줘.';
  if (code === 'auth_error') return 'Google OAuth 인증이 만료됐어.';
  if (code === 'insufficient_permissions') return '이 파일 내용을 읽을 권한이 없어.';
  if (code === 'quota_error') return 'Google Drive API quota 또는 rate limit을 확인해줘.';
  return '파일 내용을 읽지 못했어.';
}

function contentMeta(value: GoogleDriveFileContent): string {
  const format = value.format === 'csv' ? 'CSV' : '텍스트';
  return `${format} · ${value.charCount.toLocaleString('ko-KR')}자${value.truncated ? ' · 일부만 표시' : ''}`;
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
