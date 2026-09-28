'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  INBOX_MAX_RAW_CHARS,
  type InboxEntry,
  type InboxSuggestion,
} from '@/lib/inbox';
import type { ResearchProject } from '@/lib/projects';

export type InboxStorageStatus = 'loading' | 'saved' | 'saving' | 'failed';

type QuickCapturePanelProps = {
  entries: InboxEntry[];
  loaded: boolean;
  busy: boolean;
  storageStatus: InboxStorageStatus;
  storageError: string;
  bridgeApiWarning: string;
  bridgeTokenWarning: string;
  onAdd: (rawText: string) => boolean;
  onOrganize: () => void;
  onOpenInbox: () => void;
  onRetrySave: () => void;
};

type InboxPanelProps = Pick<QuickCapturePanelProps, 'entries' | 'loaded' | 'busy' | 'storageStatus' | 'storageError' | 'bridgeApiWarning' | 'bridgeTokenWarning' | 'onAdd' | 'onOrganize' | 'onRetrySave'> & {
  error: string;
  routeMessage: string;
  projects: ResearchProject[];
  projectTaskSavingId: string | null;
  deleteSavingId: string | null;
  onAddToProject: (entryId: string, projectId: string) => void;
  onDelete: (entryId: string) => Promise<boolean>;
};

const categoryLabels: Record<InboxSuggestion['category'], string> = {
  idea: '연구 아이디어',
  todo: '할 일',
  schedule: '일정',
  other: '기타',
};

type InboxFilter = 'all' | InboxSuggestion['category'];

const storageStatusText: Record<InboxStorageStatus, string> = {
  loading: 'Vault 불러오는 중',
  saved: 'Vault에 보존됨',
  saving: 'Vault 저장 중…',
  failed: 'Vault 저장 확인 필요',
};

function StorageStatus({ status, error, onRetry }: { status: InboxStorageStatus; error: string; onRetry: () => void }) {
  return <div className={`capture-storage-status is-${status}`} role={status === 'failed' ? 'alert' : 'status'}>
    <span>{error || storageStatusText[status]}</span>
    {status === 'failed' && <button type="button" className="text-link" onClick={onRetry}>저장 다시 시도</button>}
  </div>;
}

function BridgeWarnings({ api, token }: { api: string; token: string }) {
  return <>
    {api && <div className="inbox-ai-error local-bridge-warning" role="alert">{api}</div>}
    {token && <div className="inbox-ai-error local-bridge-warning" role="alert">{token}</div>}
  </>;
}

function formatInboxDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '시간 정보 없음';
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function CaptureForm({ onAdd, disabled = false }: { onAdd: (rawText: string) => boolean; disabled?: boolean }) {
  const [draft, setDraft] = useState('');
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (onAdd(draft)) setDraft('');
  }

  return <form className="capture-form" onSubmit={submit}>
    <label className="sr-only" htmlFor="quick-capture-text">Quick Capture</label>
    <textarea
      id="quick-capture-text"
      className="capture-textarea"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      maxLength={INBOX_MAX_RAW_CHARS}
      rows={2}
      disabled={disabled}
      placeholder="떠오른 할 일, 아이디어, 연구 메모를 편하게 적어두세요."
    />
    <div className="capture-form-footer">
      <small>{draft.length}/{INBOX_MAX_RAW_CHARS}</small>
      <button className="capture-add-button" type="submit" disabled={disabled || !draft.trim()}>추가</button>
    </div>
  </form>;
}

export function QuickCapturePanel({ entries, loaded, busy, storageStatus, storageError, bridgeApiWarning, bridgeTokenWarning, onAdd, onOrganize, onOpenInbox, onRetrySave }: QuickCapturePanelProps) {
  const recent = entries.slice(0, 3);
  const pendingCount = entries.filter((entry) => !entry.processed).length;
  return <section className="card section quick-capture-card" aria-labelledby="quick-capture-title">
    <div className="head quick-capture-head">
      <div>
        <span className="capture-eyebrow">QUICK CAPTURE</span>
        <h3 id="quick-capture-title">해야 할 일</h3>
      </div>
      <div className="quick-capture-state">
        <span>{pendingCount ? pendingCount + '개 미정리' : '형식 없이 빠르게 기록'}</span>
        <StorageStatus status={storageStatus} error={storageError} onRetry={onRetrySave} />
      </div>
    </div>
    <BridgeWarnings api={bridgeApiWarning} token={bridgeTokenWarning} />
    <CaptureForm onAdd={onAdd} disabled={!loaded} />
    <div className="capture-recent-head">
      <b>최근 기록</b>
      <button type="button" className="text-link" onClick={onOpenInbox}>Inbox 전체 보기 <span aria-hidden="true">↗</span></button>
    </div>
    {recent.length ? <ul className="capture-recent-list">{recent.map((entry) => <li className="capture-recent-row" key={entry.id}>
      <span className="capture-dot" aria-hidden="true" />
      <span className="capture-raw-text">{entry.rawText}</span>
      <time dateTime={entry.createdAt}>{formatInboxDate(entry.createdAt)}</time>
    </li>)}</ul> : <div className="capture-empty">아직 기록이 없어요. 떠오른 내용을 여기서 바로 저장하세요.</div>}
    <div className="capture-actions">
      <button className="capture-ai-button" type="button" onClick={onOrganize} disabled={busy || pendingCount === 0}>
        <span aria-hidden="true">✦</span> {busy ? 'GPT가 정리하는 중…' : 'GPT로 정리'}
      </button>
      <span>GPT 정리 후 할 일과 명시된 일정은 자동 전달돼요.</span>
    </div>
  </section>;
}

export function InboxPanel({ entries, loaded, busy, storageStatus, storageError, bridgeApiWarning, bridgeTokenWarning, onAdd, onOrganize, onRetrySave, error, routeMessage, projects, projectTaskSavingId, deleteSavingId, onAddToProject, onDelete }: InboxPanelProps) {
  const [filter, setFilter] = useState<InboxFilter>('all');
  const pendingCount = entries.filter((entry) => !entry.processed).length;
  const entriesById = new Map(entries.map((entry) => [entry.id, entry]));
  const visibleEntries = entries.filter((entry) => filter === 'all' || entry.ai?.category === filter);
  return <section className="inbox-page">
    <BridgeWarnings api={bridgeApiWarning} token={bridgeTokenWarning} />
    <section className="card section inbox-capture-card" aria-labelledby="inbox-capture-title">
      <div className="head">
        <div>
          <span className="capture-eyebrow">CAPTURE</span>
          <h3 id="inbox-capture-title">새로 기록하기</h3>
        </div>
        <span>원문은 그대로 보존됩니다</span>
      </div>
      <CaptureForm onAdd={onAdd} disabled={!loaded || busy || storageStatus === 'saving'} />
      <StorageStatus status={storageStatus} error={storageError} onRetry={onRetrySave} />
    </section>

    <section className="card section inbox-list-card" aria-labelledby="inbox-list-title">
      <div className="head inbox-list-head">
        <div>
          <span className="capture-eyebrow">AI INBOX</span>
          <h3 id="inbox-list-title">인박스</h3>
        </div>
        <div className="inbox-list-actions">
          <span>{visibleEntries.length}개 표시 · 미정리 {pendingCount}개</span>
          <button className="capture-ai-button" type="button" onClick={onOrganize} disabled={busy || storageStatus === 'saving' || pendingCount === 0}>
            <span aria-hidden="true">✦</span> {busy ? 'GPT가 정리하는 중…' : 'GPT로 정리'}
          </button>
        </div>
      </div>
      {busy && <div className="inbox-ai-status" role="status">최근 미정리 항목을 분석하고 있어요. 원문은 변경되지 않습니다.</div>}
      {error && <div className="inbox-ai-error" role="alert">{error}</div>}
      {routeMessage && <div className="inbox-route-message" role="status">{routeMessage}</div>}
      <div className="inbox-category-filters" role="group" aria-label="Inbox 분류 필터">
        {([['all', '전체'], ['idea', '연구 아이디어'], ['todo', '할 일'], ['schedule', '일정'], ['other', '기타']] as [InboxFilter, string][]).map(([value, label]) => <button
          aria-pressed={filter === value}
          className={filter === value ? 'active' : ''}
          key={value}
          onClick={() => setFilter(value)}
          type="button"
        >{label}</button>)}
      </div>
      {!entries.length ? <div className="inbox-empty">아직 저장된 항목이 없습니다.</div> : visibleEntries.length ? <div className="inbox-entry-list">{visibleEntries.map((entry) => <InboxEntryCard
        key={entry.id}
        entry={entry}
        entriesById={entriesById}
        projects={projects}
        loaded={loaded}
        busy={busy}
        storageStatus={storageStatus}
        projectTaskSaving={projectTaskSavingId === entry.id}
        deleting={deleteSavingId === entry.id}
        onAddToProject={(projectId) => onAddToProject(entry.id, projectId)}
        onDelete={() => onDelete(entry.id)}
      />)}</div> : <div className="inbox-empty">이 분류에 저장된 항목이 없습니다.</div>}
    </section>
  </section>;
}

function InboxEntryCard({ entry, entriesById, projects, loaded, busy, storageStatus, projectTaskSaving, deleting, onAddToProject, onDelete }: {
  entry: InboxEntry;
  entriesById: Map<string, InboxEntry>;
  projects: ResearchProject[];
  loaded: boolean;
  busy: boolean;
  storageStatus: InboxStorageStatus;
  projectTaskSaving: boolean;
  deleting: boolean;
  onAddToProject: (projectId: string) => void;
  onDelete: () => Promise<boolean>;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState(false);
  const saving = storageStatus === 'saving';
  const deleteDisabled = !loaded || busy || saving || projectTaskSaving || deleting;
  async function confirmAndDelete() {
    if (deleteDisabled) return;
    setDeleteError(false);
    const deleted = await onDelete();
    setDeleteError(!deleted);
    if (deleted) setConfirmDelete(false);
  }
  return <article className={entry.processed ? 'inbox-entry is-processed' : 'inbox-entry'}>
    <div className="inbox-entry-meta">
      <div className="inbox-entry-meta-content">
        <time dateTime={entry.createdAt}>{formatInboxDate(entry.createdAt)}</time>
        {!entry.ai && <span className="inbox-pending-tag">미정리</span>}
      </div>
      <button className="inbox-entry-delete" type="button" aria-label="Inbox 항목 삭제" title="항목 삭제" disabled={deleteDisabled} onClick={() => { setDeleteError(false); setConfirmDelete((open) => !open); }}>
        {deleting ? '삭제 중…' : '×'}
      </button>
    </div>
    {confirmDelete && <div className="inbox-delete-confirm" role="group" aria-label="Inbox 항목 삭제 확인">
      <span>{deleteError ? '삭제를 확인하지 못했어. 다시 시도할까?' : '이 항목을 삭제할까요?'}</span>
      <div>
        <button className="mini" type="button" disabled={deleting} onClick={() => { setConfirmDelete(false); setDeleteError(false); }}>취소</button>
        <button className="mini" type="button" disabled={deleteDisabled} onClick={() => void confirmAndDelete()}>{deleting ? '삭제 중…' : '삭제'}</button>
      </div>
    </div>}
    <p className="inbox-entry-raw">{entry.rawText}</p>
    {entry.ai && <div className="inbox-entry-ai">
      <strong>{entry.ai.title}</strong>
      {entry.ai.summary && <p>{entry.ai.summary}</p>}
      {entry.ai.category === 'todo' && entry.ai.nextAction && <div><b>다음 행동</b><span>{entry.ai.nextAction}</span></div>}
      {entry.ai.dueDate && <div><b>날짜</b><time dateTime={entry.ai.dueDate}>{entry.ai.dueDate}</time></div>}
      {entry.ai.relatedEntryIds.length > 0 && <div className="inbox-entry-related"><b>유사 항목</b><span>{entry.ai.relatedEntryIds.map((id) => entriesById.get(id)?.rawText).filter(Boolean).join(' · ')}</span></div>}
    </div>}
    {entry.ai && <div className="inbox-entry-actions">
      <span className="inbox-category-tag">{categoryLabels[entry.ai.category]}</span>
      {entry.ai.category === 'todo' && <ProjectTaskRoute
        entry={entry}
        projects={projects}
        busy={!loaded || projectTaskSaving || busy || saving || deleting}
        onAdd={onAddToProject}
      />}
    </div>}
  </article>;
}

function ProjectTaskRoute({ entry, projects, busy, onAdd }: {
  entry: InboxEntry;
  projects: ResearchProject[];
  busy: boolean;
  onAdd: (projectId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const matches = projects.filter((project) => `${project.title} ${project.id}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));

  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  function closeMenu() {
    setOpen(false);
    setQuery('');
  }

  return <div className="inbox-project-route" ref={rootRef}>
    <button className="inbox-project-trigger" type="button" disabled={busy || !projects.length} aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((value) => !value)}>
      {busy ? '추가 중…' : <>프로젝트에 추가 <span aria-hidden="true">▾</span></>}
    </button>
    {open && <div className="inbox-project-popover" role="dialog" aria-label="할 일을 추가할 프로젝트 선택">
      <div className="inbox-project-popover-head">
        <b>프로젝트 선택</b>
        <button type="button" aria-label="프로젝트 선택 닫기" onClick={closeMenu}>×</button>
      </div>
      <input className="inbox-project-search" type="search" autoFocus aria-label="프로젝트 검색" placeholder="프로젝트 검색" value={query} onChange={(event) => setQuery(event.target.value)} />
      <div className="inbox-project-options">
        {matches.length ? matches.map((project) => {
          return <button key={project.id} type="button" disabled={busy} onClick={() => { onAdd(project.id); closeMenu(); }}>
            <span>{project.title}</span><small>다음 작업에 연결</small>
          </button>;
        }) : <div className="inbox-project-no-results">일치하는 프로젝트가 없어.</div>}
      </div>
    </div>}
  </div>;
}
