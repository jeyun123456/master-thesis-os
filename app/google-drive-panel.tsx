'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import {
  getGoogleDriveContent,
  getRecentGoogleDriveFiles,
  GoogleDriveClientError,
  searchGoogleDriveResearch,
} from '../lib/google-drive-client';
import {
  askResearchQuestion,
  ResearchQAClientError,
  type ResearchQAAnswer,
  type ResearchQAMode,
} from '../lib/research-qa-client';
import type {
  GoogleDriveFile,
  GoogleDriveFileContent,
  GoogleDriveSearchResult,
} from '../lib/google-drive';

type DrivePanelStatus = 'loading' | 'ready' | 'empty' | 'unconfigured' | 'error';
type ContentStatus = 'idle' | 'loading' | 'ready' | 'error';
type ResearchSearchStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error';
type ResearchQAStatus = 'idle' | 'loading' | 'ready' | 'error';

export function GoogleDrivePanel() {
  const [status, setStatus] = useState<DrivePanelStatus>('loading');
  const [items, setItems] = useState<GoogleDriveFile[]>([]);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [contentStatus, setContentStatus] = useState<ContentStatus>('idle');
  const [contentErrorCode, setContentErrorCode] = useState<string | null>(null);
  const [selectedContent, setSelectedContent] = useState<GoogleDriveFileContent | null>(null);
  const [contentQuery, setContentQuery] = useState('');
  const [researchQuery, setResearchQuery] = useState('');
  const [researchStatus, setResearchStatus] = useState<ResearchSearchStatus>('idle');
  const [researchErrorCode, setResearchErrorCode] = useState<string | null>(null);
  const [researchResults, setResearchResults] = useState<GoogleDriveSearchResult[]>([]);
  const [researchCandidates, setResearchCandidates] = useState(0);
  const [researchInspected, setResearchInspected] = useState(0);
  const [researchQuestion, setResearchQuestion] = useState('');
  const [researchQAStatus, setResearchQAStatus] = useState<ResearchQAStatus>('idle');
  const [researchQAError, setResearchQAError] = useState<string | null>(null);
  const [researchAnswer, setResearchAnswer] = useState<ResearchQAAnswer | null>(null);

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

  async function runResearchSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = researchQuery.trim();
    if (normalized.length < 2) {
      setResearchStatus('error');
      setResearchErrorCode('provider_bad_request');
      setResearchResults([]);
      return;
    }

    setResearchStatus('loading');
    setResearchErrorCode(null);
    try {
      const result = await searchGoogleDriveResearch(normalized, fetch, 10);
      setResearchResults(result.items);
      setResearchQuestion((current) => current.trim() ? current : normalized);
      setResearchAnswer(null);
      setResearchQAStatus('idle');
      setResearchQAError(null);
      setResearchCandidates(result.candidates);
      setResearchInspected(result.contentInspected);
      setResearchStatus(result.items.length ? 'ready' : 'empty');
    } catch (error) {
      setResearchResults([]);
      setResearchCandidates(0);
      setResearchInspected(0);
      setResearchStatus('error');
      setResearchErrorCode(error instanceof GoogleDriveClientError ? error.code : 'network_error');
    }
  }

  async function runResearchQA(mode: ResearchQAMode) {
    if (!researchResults.length) {
      setResearchQAStatus('error');
      setResearchQAError('먼저 Drive 연구자료 검색을 실행해줘.');
      return;
    }
    setResearchQAStatus('loading');
    setResearchQAError(null);
    try {
      const answer = await askResearchQuestion(researchQuestion, mode, researchResults);
      setResearchAnswer(answer);
      setResearchQAStatus('ready');
    } catch (error) {
      setResearchAnswer(null);
      setResearchQAStatus('error');
      setResearchQAError(error instanceof ResearchQAClientError ? error.message : '연구 Q&A에 실패했어.');
    }
  }

  async function loadContent(item: GoogleDriveFile) {
    if (!contentReadable(item)) return;
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
    <div className="muted"><small>Google OAuth · Drive API · 읽기 전용 · 본문 인덱스 검색</small></div>

    {(status === 'ready' || status === 'empty') && <div className="google-drive-research-search">
      <form className="library-toolbar google-drive-search-toolbar" onSubmit={runResearchSearch}>
        <input
          className="search"
          value={researchQuery}
          onChange={(event) => setResearchQuery(event.target.value)}
          placeholder="내 Drive 연구자료 전체에서 검색"
          aria-label="Google Drive 연구자료 전체 검색"
        />
        <button className="btn" disabled={researchStatus === 'loading'} type="submit">
          {researchStatus === 'loading' ? '검색 중…' : '연구자료 검색'}
        </button>
      </form>
      <div className="muted google-drive-search-help"><small>파일명 + Google Drive 전체 텍스트 인덱스로 후보를 찾고, 읽을 수 있는 상위 문서는 실제 본문 문맥까지 확인해.</small></div>

      {researchStatus === 'loading' && <div className="microsoft-mail-state">Drive 연구자료 전체를 검색하는 중이야…</div>}
      {researchStatus === 'error' && <div className="error microsoft-mail-error">{researchSearchErrorMessage(researchErrorCode)}</div>}
      {(researchStatus === 'ready' || researchStatus === 'empty') && <div className="google-drive-search-results">
        <div className="library-section-heading compact-heading">
          <div><h3>통합 검색 결과</h3><p>Drive 후보 {researchCandidates}개 · 실제 본문 확인 {researchInspected}개</p></div>
          <span>{researchResults.length}개</span>
        </div>
        {researchResults.length
          ? <>
              <div className="google-drive-search-list">{researchResults.map((result) => <DriveSearchResultRow result={result} key={result.file.id} onRead={loadContent} />)}</div>
              <div className="google-drive-research-qa">
                <div className="library-section-heading compact-heading">
                  <div><h3>내 자료로 질문하기</h3><p>Luna가 기본이야. 복잡한 논증 비교나 비판만 Sol 정밀 분석을 쓰면 돼.</p></div>
                </div>
                <textarea
                  className="google-drive-qa-input"
                  value={researchQuestion}
                  onChange={(event) => setResearchQuestion(event.target.value)}
                  placeholder="예: 이 자료들에서 전환 문제에 대한 핵심 논점이 어떻게 다른지 비교해줘"
                  rows={3}
                />
                <div className="google-drive-qa-actions">
                  <button className="btn" disabled={researchQAStatus === 'loading'} onClick={() => void runResearchQA('luna')} type="button">
                    {researchQAStatus === 'loading' ? '답변 생성 중…' : 'Luna 답변'}
                  </button>
                  <button className="mini" disabled={researchQAStatus === 'loading'} onClick={() => void runResearchQA('sol')} type="button">Sol 정밀 분석</button>
                </div>
                {researchQAStatus === 'error' && <div className="error microsoft-mail-error">{researchQAError || '연구 Q&A에 실패했어.'}</div>}
                {researchQAStatus === 'ready' && researchAnswer && <div className="google-drive-qa-answer">
                  <div className="google-drive-qa-answer-head">
                    <strong>{researchAnswer.mode === 'sol' ? 'Sol 정밀 분석' : 'Luna 답변'}</strong>
                    <span>{researchAnswer.model}</span>
                  </div>
                  {researchAnswer.insufficientEvidence && <div className="note">제공된 검색 근거만으로는 일부 판단에 근거가 부족해.</div>}
                  <div className="google-drive-qa-answer-body">{researchAnswer.answer}</div>
                  {researchAnswer.sourceIds.length > 0 && <div className="muted"><small>사용 근거: {researchAnswer.sourceIds.join(', ')}</small></div>}
                </div>}
              </div>
            </>
          : <div className="library-empty">일치하는 Drive 연구자료가 없어.</div>}
      </div>}
    </div>}

    {(status === 'ready' || status === 'empty') && <div className="library-toolbar google-drive-toolbar">
      <input className="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="최근 파일명 검색" />
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

function contentReadable(item: GoogleDriveFile): boolean {
  return item.kind === 'document'
    || item.kind === 'spreadsheet'
    || item.kind === 'presentation'
    || item.mimeType.startsWith('text/')
    || item.mimeType === 'application/json'
    || item.mimeType === 'application/xml'
    || item.mimeType === 'application/javascript'
    || item.mimeType === 'application/x-javascript';
}

function DriveSearchResultRow({ result, onRead }: { result: GoogleDriveSearchResult; onRead: (item: GoogleDriveFile) => void | Promise<void> }) {
  const { file } = result;
  return <article className="google-drive-search-result">
    <div className="google-drive-search-result-head">
      <div className="google-drive-search-result-title">
        <span className="resource-badge">{kindLabel(file.kind)}</span>
        <div><h4>{file.name}</h4><p>{formatModified(file.modifiedTime)} · 점수 {result.score}</p></div>
      </div>
      <div className="google-drive-row-actions">
        {result.contentReadable && <button className="mini" onClick={() => void onRead(file)} type="button">내용</button>}
        <a className="mini" href={file.webViewLink} rel="noreferrer" target="_blank">열기</a>
      </div>
    </div>
    <div className="google-drive-search-evidence">
      {result.matchedTerms.length > 0 && <div className="google-drive-search-terms">{result.matchedTerms.map((term) => <span key={term}>{term}</span>)}</div>}
      {result.snippets.length > 0
        ? result.snippets.map((snippet, index) => <div className="google-drive-search-snippet" key={`${file.id}:${snippet.lineNumber ?? index}`}>
            <span>{snippet.lineNumber ? `L${snippet.lineNumber}` : '본문'}</span><p>{snippet.text}</p>
          </div>)
        : <p className="google-drive-index-hit">Google Drive 전체 텍스트 인덱스에서 일치했어.{file.kind === 'pdf' ? ' PDF 본문은 아직 미리보기 추출하지 않아.' : ''}</p>}
    </div>
  </article>;
}

function DriveRow({ item, onRead }: { item: GoogleDriveFile; onRead: (item: GoogleDriveFile) => void | Promise<void> }) {
  const readable = contentReadable(item);
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

function researchSearchErrorMessage(code: string | null): string {
  if (code === 'provider_bad_request') return '검색어를 2자 이상 입력해줘.';
  if (code === 'auth_error') return 'Google OAuth 인증이 만료됐어.';
  if (code === 'insufficient_permissions') return 'Google Drive 검색 권한이 없어.';
  if (code === 'quota_error') return 'Google Drive API quota 또는 rate limit을 확인해줘.';
  return 'Drive 연구자료 검색에 실패했어.';
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
