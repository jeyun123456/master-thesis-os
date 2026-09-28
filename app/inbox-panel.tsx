'use client';

import { useState, type FormEvent } from 'react';
import {
  INBOX_MAX_RAW_CHARS,
  type InboxEntry,
  type InboxSuggestion,
} from '@/lib/inbox';

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
  preview: InboxSuggestion[] | null;
  error: string;
  onApply: () => void;
  onDiscardPreview: () => void;
};

const categoryLabels: Record<InboxSuggestion['category'], string> = {
  Todo: 'Todo',
  Idea: 'Idea',
  'Research Note': 'Research Note',
  'Later / Reference': 'Later / Reference',
};

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
      <span>분류 제안을 확인한 뒤 적용할 수 있어요.</span>
    </div>
  </section>;
}

export function InboxPanel({ entries, loaded, busy, storageStatus, storageError, bridgeApiWarning, bridgeTokenWarning, onAdd, onOrganize, onRetrySave, preview, error, onApply, onDiscardPreview }: InboxPanelProps) {
  const pendingCount = entries.filter((entry) => !entry.processed).length;
  const entriesById = new Map(entries.map((entry) => [entry.id, entry]));
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
      <CaptureForm onAdd={onAdd} disabled={!loaded} />
      <StorageStatus status={storageStatus} error={storageError} onRetry={onRetrySave} />
    </section>

    <section className="card section inbox-list-card" aria-labelledby="inbox-list-title">
      <div className="head inbox-list-head">
        <div>
          <span className="capture-eyebrow">AI INBOX</span>
          <h3 id="inbox-list-title">인박스</h3>
        </div>
        <div className="inbox-list-actions">
          <span>{entries.length}개 · 미정리 {pendingCount}개</span>
          <button className="capture-ai-button" type="button" onClick={onOrganize} disabled={busy || pendingCount === 0}>
            <span aria-hidden="true">✦</span> {busy ? 'GPT가 정리하는 중…' : 'GPT로 정리'}
          </button>
        </div>
      </div>
      {busy && <div className="inbox-ai-status" role="status">최근 미정리 항목을 분석하고 있어요. 원문은 변경되지 않습니다.</div>}
      {error && <div className="inbox-ai-error" role="alert">{error}</div>}
      {preview && <section className="inbox-preview" aria-labelledby="inbox-preview-title">
        <div className="inbox-preview-head">
          <div>
            <span className="capture-eyebrow">REVIEW BEFORE APPLY</span>
            <h4 id="inbox-preview-title">정리 미리보기</h4>
            <p>내용을 확인한 뒤 적용하세요. 원문은 별도로 계속 보존됩니다.</p>
          </div>
          <div className="inbox-preview-actions">
            <button className="btn" type="button" onClick={onDiscardPreview}>닫기</button>
            <button className="capture-ai-button" type="button" onClick={onApply}>미리보기 적용</button>
          </div>
        </div>
        <div className="inbox-proposal-list">{preview.map((suggestion) => {
          const entry = entriesById.get(suggestion.entryId);
          if (!entry) return null;
          const related = suggestion.relatedEntryIds.map((id) => entriesById.get(id)).filter((item): item is InboxEntry => Boolean(item));
          return <article className="inbox-proposal" key={suggestion.entryId}>
            <div className="inbox-proposal-top">
              <span className="inbox-category-tag">{categoryLabels[suggestion.category]}</span>
              <strong>{suggestion.title}</strong>
            </div>
            <blockquote>{entry.rawText}</blockquote>
            {suggestion.summary && <p>{suggestion.summary}</p>}
            {suggestion.category === 'Todo' && suggestion.nextAction && <div className="inbox-proposal-detail"><b>다음 행동</b><span>{suggestion.nextAction}</span></div>}
            {suggestion.dueDate && <div className="inbox-proposal-detail"><b>원문에 적힌 날짜</b><time dateTime={suggestion.dueDate}>{suggestion.dueDate}</time></div>}
            {related.length > 0 && <div className="inbox-related-suggestions"><b>유사 항목 제안</b>{related.map((item) => <span key={item.id}>{item.rawText}</span>)}</div>}
          </article>;
        })}</div>
      </section>}
      {!entries.length ? <div className="inbox-empty">아직 저장된 항목이 없습니다.</div> : <div className="inbox-entry-list">{entries.map((entry) => <article className={entry.processed ? 'inbox-entry is-processed' : 'inbox-entry'} key={entry.id}>
        <div className="inbox-entry-meta">
          <time dateTime={entry.createdAt}>{formatInboxDate(entry.createdAt)}</time>
          {entry.ai ? <span className="inbox-category-tag">{categoryLabels[entry.ai.category]}</span> : <span className="inbox-pending-tag">미정리</span>}
        </div>
        <p className="inbox-entry-raw">{entry.rawText}</p>
        {entry.ai && <div className="inbox-entry-ai">
          <strong>{entry.ai.title}</strong>
          {entry.ai.summary && <p>{entry.ai.summary}</p>}
          {entry.ai.category === 'Todo' && entry.ai.nextAction && <div><b>다음 행동</b><span>{entry.ai.nextAction}</span></div>}
          {entry.ai.dueDate && <div><b>날짜</b><time dateTime={entry.ai.dueDate}>{entry.ai.dueDate}</time></div>}
          {entry.ai.relatedEntryIds.length > 0 && <div className="inbox-entry-related"><b>유사 항목</b><span>{entry.ai.relatedEntryIds.map((id) => entriesById.get(id)?.rawText).filter(Boolean).join(' · ')}</span></div>}
        </div>}
      </article>)}</div>}
    </section>
  </section>;
}
