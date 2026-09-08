'use client';

import { useEffect, useMemo, useState } from 'react';
import { dashboardApi } from '@/lib/client-api';
import type { LibraryPaper, WikiCategory } from '@/lib/library';
import { classifyWikiPath, wikiCategoryLabels, wikiCategoryOrder, wikiDisplayTitle } from '@/lib/library';
import { classifyRepositoryItems, type RepositoryItem } from '@/lib/repository';
import type { ResearchStatus } from '@/lib/research-status';

type LibraryTab = 'key' | 'literature' | 'wiki' | 'files';

type KeyResource = {
  label: string;
  path: string;
  category: string;
};

export function LibraryPanel({ tree, researchStatus, onOpen }: { tree: RepositoryItem[]; researchStatus: ResearchStatus | null; onOpen: (path: string) => void }) {
  const [tab, setTab] = useState<LibraryTab>('key');
  const [query, setQuery] = useState('');
  const [papers, setPapers] = useState<LibraryPaper[]>([]);
  const [paperSourcePath, setPaperSourcePath] = useState('연구/문헌/논문 리스트.md');
  const [paperError, setPaperError] = useState('');

  useEffect(() => {
    dashboardApi.papers()
      .then((response) => {
        setPapers(response.items || []);
        setPaperSourcePath(response.sourcePath || '연구/문헌/논문 리스트.md');
        setPaperError(response.error || '');
      })
      .catch((error) => setPaperError(error instanceof Error ? error.message : '문헌 인덱스를 불러오지 못했어.'));
  }, []);

  const groups = useMemo(() => classifyRepositoryItems(tree), [tree]);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const blobPaths = useMemo(() => new Set(tree.filter((item) => item.type === 'blob').map((item) => item.path)), [tree]);

  const files = useMemo(
    () => tree.filter((item) => item.type === 'blob' && item.path.toLocaleLowerCase().includes(normalizedQuery)).slice(0, 160),
    [tree, normalizedQuery],
  );

  const filteredPapers = useMemo(
    () => papers.filter((paper) => `${paper.author} ${paper.year} ${paper.title} ${paper.path}`.toLocaleLowerCase().includes(normalizedQuery)),
    [papers, normalizedQuery],
  );

  const wikiItems = useMemo(
    () => groups.wiki
      .filter((item) => /\.md$/i.test(item.path))
      .filter((item) => `${wikiDisplayTitle(item.path)} ${item.path}`.toLocaleLowerCase().includes(normalizedQuery)),
    [groups.wiki, normalizedQuery],
  );

  const wikiGroups = useMemo(() => {
    const result = Object.fromEntries(wikiCategoryOrder.map((category) => [category, []])) as Record<WikiCategory, RepositoryItem[]>;
    for (const item of wikiItems) result[classifyWikiPath(item.path)].push(item);
    return result;
  }, [wikiItems]);

  const keyResources = useMemo(() => {
    const candidates: KeyResource[] = [
      { label: '현재 연구 상태', path: researchStatus?.sourcePath || 'wiki/current_status.md', category: '현재 상태' },
      { label: '연구 Wiki 안내', path: 'wiki/README.md', category: '연구 기준' },
      { label: '벤치마크 결과', path: 'wiki/findings/benchmark_results.md', category: '결과 기준' },
      { label: '대표 논문 목록', path: paperSourcePath, category: '문헌 인덱스' },
      ...(researchStatus?.decisions || []).map((item) => ({ ...item, category: '연구 결정' })),
      ...(researchStatus?.importantFiles || []).map((item) => ({ ...item, category: '계산 결과' })),
    ];
    const seen = new Set<string>();
    return candidates
      .filter((item) => blobPaths.has(item.path))
      .filter((item) => {
        if (seen.has(item.path)) return false;
        seen.add(item.path);
        return true;
      })
      .filter((item) => `${item.label} ${item.category} ${item.path}`.toLocaleLowerCase().includes(normalizedQuery));
  }, [blobPaths, normalizedQuery, paperSourcePath, researchStatus]);

  const placeholder = tab === 'literature'
    ? '저자 · 연도 · 논문 제목 검색'
    : tab === 'wiki'
      ? 'Wiki 제목 · 경로 검색'
      : tab === 'files'
        ? '저장소 전체 경로 검색'
        : '주요 자료 검색';

  return (
    <div className="library-shell">
      <div className="library-stats">
        <Stat label="주요 자료" value={keyResources.length} />
        <Stat label="대표 논문" value={papers.length} />
        <Stat label="연구 Wiki" value={groups.wiki.filter((item) => /\.md$/i.test(item.path)).length} />
        <Stat label="전체 파일" value={tree.filter((item) => item.type === 'blob').length} />
      </div>

      <div className="library-toolbar">
        <div className="tabs library-tabs">
          <button className={tab === 'key' ? 'active' : ''} onClick={() => setTab('key')}>주요 자료</button>
          <button className={tab === 'literature' ? 'active' : ''} onClick={() => setTab('literature')}>문헌</button>
          <button className={tab === 'wiki' ? 'active' : ''} onClick={() => setTab('wiki')}>연구 Wiki</button>
          <button className={tab === 'files' ? 'active' : ''} onClick={() => setTab('files')}>전체 파일</button>
        </div>
        <input className="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={placeholder} />
      </div>

      {tab === 'key' && (
        <>
          <div className="library-section-heading">
            <div><h3>지금 연구에 바로 쓰는 자료</h3><p>현재 상태 Wiki가 가리키는 결정·결과 파일과 핵심 인덱스를 모았어.</p></div>
            <span>{keyResources.length}개</span>
          </div>
          <div className="resource-grid">
            {keyResources.map((item) => <ResourceCard key={item.path} item={item} onOpen={onOpen} />)}
            {keyResources.length === 0 && <div className="card empty">조건에 맞는 주요 자료가 없어.</div>}
          </div>
        </>
      )}

      {tab === 'literature' && (
        <>
          <div className="library-section-heading">
            <div><h3>대표 논문</h3><p>백업·중복본이 아니라 정리된 논문 인덱스를 기준으로 표시해.</p></div>
            <span>{filteredPapers.length} / {papers.length}</span>
          </div>
          {paperError && <div className="error library-inline-error">{paperError}</div>}
          <div className="paper-grid">
            {filteredPapers.map((paper) => <PaperCard key={paper.path} paper={paper} onOpen={onOpen} />)}
            {!paperError && filteredPapers.length === 0 && <div className="card empty">조건에 맞는 대표 논문이 없어.</div>}
          </div>
          <div className="library-source-note">기준 인덱스 · <code>{paperSourcePath}</code></div>
        </>
      )}

      {tab === 'wiki' && (
        <div className="wiki-sections">
          {wikiCategoryOrder.map((category) => {
            const items = wikiGroups[category];
            if (!items.length) return null;
            return <section className="wiki-section" key={category}>
              <div className="library-section-heading compact-heading"><div><h3>{wikiCategoryLabels[category]}</h3></div><span>{items.length}개</span></div>
              <div className="wikigrid">
                {items.map((file) => <WikiCard key={file.path} file={file} category={wikiCategoryLabels[category]} onOpen={onOpen} />)}
              </div>
            </section>;
          })}
          {wikiItems.length === 0 && <div className="card empty">조건에 맞는 Wiki 문서가 없어.</div>}
        </div>
      )}

      {tab === 'files' && (
        <>
          <div className="library-section-heading">
            <div><h3>전체 파일</h3><p>큐레이션되지 않은 파일까지 포함한 저장소 탐색용 목록이야.</p></div>
            <span>최대 160개 표시</span>
          </div>
          <div className="filegrid">
            {files.map((file) => <FileCard key={file.path} file={file} onOpen={onOpen} />)}
            {files.length === 0 && <div className="card empty">조건에 맞는 파일이 없어.</div>}
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return <div className="card library-stat"><span>{label}</span><b>{value.toLocaleString('ko-KR')}</b></div>;
}

function ResourceCard({ item, onOpen }: { item: KeyResource; onOpen: (path: string) => void }) {
  return <div className="card resource-card"><div className="resource-top"><span className="resource-badge">{item.category}</span></div><h4>{item.label}</h4><p>{item.path}</p><button className="mini" onClick={() => onOpen(item.path)}>로컬에서 열기</button></div>;
}

function PaperCard({ paper, onOpen }: { paper: LibraryPaper; onOpen: (path: string) => void }) {
  return <article className="card paper-card"><div className="paper-meta"><b>{paper.author}</b><span>{paper.year}</span></div><h4>{paper.title}</h4><p>{paper.path}</p><button className="mini" onClick={() => onOpen(paper.path)}>PDF 열기</button></article>;
}

function WikiCard({ file, category, onOpen }: { file: RepositoryItem; category: string; onOpen: (path: string) => void }) {
  return <div className="card library-card wiki-library-card"><div className="library-icon">{category.slice(0, 4)}</div><div className="grow"><h4>{wikiDisplayTitle(file.path)}</h4><p>{file.path}</p></div><button className="mini" onClick={() => onOpen(file.path)}>열기</button></div>;
}

function FileCard({ file, onOpen }: { file: RepositoryItem; onOpen: (path: string) => void }) {
  return <div className="card library-card"><div className="library-icon">{extension(file.path)}</div><div className="grow"><h4>{basename(file.path)}</h4><p>{file.path}</p></div><button className="mini" onClick={() => onOpen(file.path)}>열기</button></div>;
}

function basename(path: string) { return path.split('/').pop() || path; }
function extension(path: string) { const value = (path.split('.').pop() || 'FILE').toUpperCase(); return value.slice(0, 4); }
