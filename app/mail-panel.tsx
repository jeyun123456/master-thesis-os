'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  THUNDERBIRD_ANALYSIS_FOLDER_IDS,
  THUNDERBIRD_ANALYSIS_FOLDER_LABELS,
  openThunderbird,
  openThunderbirdMessage,
  thunderbirdMailErrorMessage,
  ThunderbirdMailError,
  type ThunderbirdAnalysisFolderId,
  type ThunderbirdFolder,
  type ThunderbirdMailErrorCode,
} from '../lib/thunderbird-mail';
import { prioritizeMail, type PrioritizedMail } from '../lib/mail-priority';
import {
  DEFAULT_MAIL_LIST_PREFERENCES,
  filterAndSortMailItems,
  INITIAL_MAIL_VISIBLE_COUNT,
  MAIL_FILTER_LABELS,
  MAIL_LIST_PREFERENCES_STORAGE_KEY,
  MAIL_SORT_LABELS,
  MAIL_VISIBLE_INCREMENT,
  MAX_MAIL_VISIBLE_COUNT,
  nextMailVisibleCount,
  readMailListPreferences,
  type MailFilter,
  type MailSort,
} from '../lib/mail-list';
import {
  getMailAnalysis,
  getMailAnalysisItem,
  getMailSyncStatus,
  MailAnalysisClientError,
  reanalyzeMail,
  readBridgeToken,
  startMailSync,
  updateMailCandidate,
} from '../lib/mail-analysis-client';
import type { MailAnalysisItem, MailSyncStatus, StoredMailCalendarCandidate } from '../lib/mail-analysis';
import { SchoolMailRow, schoolMailRowKey } from './school-mail-panel';
import { MailAnalysisDetails, type CalendarCandidateEdit } from './mail-analysis-details';
import { addCalendarEvent } from '../lib/calendar-client';

type MailPanelStatus = 'loading' | 'ready' | 'empty' | 'bridge_offline' | 'error';

export const MAIL_FOLDER_TAB_IDS = THUNDERBIRD_ANALYSIS_FOLDER_IDS;

export function mailFolderTabLabel(folderId: ThunderbirdAnalysisFolderId): string {
  return THUNDERBIRD_ANALYSIS_FOLDER_LABELS[folderId];
}

export function defaultMailFolders(): ThunderbirdFolder[] {
  return MAIL_FOLDER_TAB_IDS.map((id) => ({ id, label: mailFolderTabLabel(id), available: true }));
}

export function mailPanelStatusLabel(status: MailPanelStatus, errorCode: ThunderbirdMailErrorCode | null): string {
  if (status === 'loading') return '확인 중';
  if (status === 'ready' || status === 'empty') return 'SQLite ● 로컬';
  if (status === 'bridge_offline') return '브리지 오프라인';
  if (errorCode === 'bridge_auth') return '브리지 설정 필요';
  return '로컬 메일 오류';
}

export function mailPanelStateMessage(errorCode: ThunderbirdMailErrorCode | null): string {
  if (errorCode === 'profile_not_found' || errorCode === 'account_not_found') return 'Thunderbird 학교 계정을 찾지 못했어.';
  if (errorCode === 'inbox_not_found' || errorCode === 'folder_not_found') return '선택한 Thunderbird 메일 폴더를 찾지 못했어.';
  if (errorCode === 'local_sync_required') return thunderbirdMailErrorMessage('local_sync_required');
  if (errorCode === 'bridge_auth') return 'Settings에서 Local Bridge token을 확인해줘.';
  return errorCode ? thunderbirdMailErrorMessage(errorCode) : '저장된 메일을 읽지 못했어.';
}

export function MailPanel() {
  const [selectedFolder, setSelectedFolder] = useState<ThunderbirdAnalysisFolderId>('school-work');
  const [status, setStatus] = useState<MailPanelStatus>('loading');
  const [errorCode, setErrorCode] = useState<ThunderbirdMailErrorCode | null>(null);
  const [items, setItems] = useState<MailAnalysisItem[]>([]);
  const [syncStatus, setSyncStatus] = useState<MailSyncStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState('아직 동기화하지 않았어.');
  const [openState, setOpenState] = useState<'idle' | 'opening' | 'opened'>('idle');
  const [openingMailId, setOpeningMailId] = useState<string | null>(null);
  const [openError, setOpenError] = useState<ThunderbirdMailErrorCode | null>(null);
  const [searchQuery, setSearchQuery] = useState(DEFAULT_MAIL_LIST_PREFERENCES.query);
  const [mailFilter, setMailFilter] = useState<MailFilter>(DEFAULT_MAIL_LIST_PREFERENCES.filter);
  const [mailSort, setMailSort] = useState<MailSort>(DEFAULT_MAIL_LIST_PREFERENCES.sort);
  const [visibleCount, setVisibleCount] = useState(DEFAULT_MAIL_LIST_PREFERENCES.visibleCount);
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [expandedAnalysisId, setExpandedAnalysisId] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => { mountedRef.current = false; };
  }, []);

  const loadAnalysis = useCallback(async () => {
    setStatus('loading');
    setErrorCode(null);
    try {
      const result = await getMailAnalysis(readBridgeToken(), { limit: 100 });
      if (!mountedRef.current) return;
      setItems(result.items);
      setSyncStatus(result.sync);
      setStatus(result.items.some((item) => item.folder === selectedFolder) ? 'ready' : 'empty');
    } catch (error) {
      if (!mountedRef.current) return;
      const nextCode = readErrorCode(error);
      setItems([]);
      setErrorCode(nextCode);
      setStatus(statusForError(nextCode));
    }
  }, [selectedFolder]);

  useEffect(() => {
    void loadAnalysis();
  }, [loadAnalysis]);

  useEffect(() => {
    try {
      const preferences = readMailListPreferences(localStorage.getItem(MAIL_LIST_PREFERENCES_STORAGE_KEY));
      setSearchQuery(preferences.query);
      setMailFilter(preferences.filter);
      setMailSort(preferences.sort);
      setVisibleCount(preferences.visibleCount);
    } catch {
      // Browser preferences are optional; SQLite remains the mail source.
    } finally {
      setPreferencesReady(true);
    }
  }, []);

  useEffect(() => {
    if (!preferencesReady) return;
    try {
      localStorage.setItem(MAIL_LIST_PREFERENCES_STORAGE_KEY, JSON.stringify({
        query: searchQuery,
        filter: mailFilter,
        sort: mailSort,
        visibleCount,
      }));
    } catch {
      // A denied or full localStorage must not break mail browsing.
    }
  }, [mailFilter, mailSort, preferencesReady, searchQuery, visibleCount]);

  const folderItems = useMemo(() => items.filter((item) => item.folder === selectedFolder), [items, selectedFolder]);
  const prioritizedItems = useMemo(() => folderItems.map((item) => prioritizeMail(item.mail)), [folderItems]);
  const filteredItems = useMemo(
    () => filterAndSortMailItems(prioritizedItems, { filter: mailFilter, query: searchQuery, sort: mailSort }),
    [mailFilter, mailSort, prioritizedItems, searchQuery],
  );
  const visibleItems = filteredItems.slice(0, visibleCount);
  const hasMoreItems = visibleCount < MAX_MAIL_VISIBLE_COUNT && visibleItems.length < filteredItems.length;

  async function pollSyncStatus(): Promise<void> {
    let sawRunning = false;
    for (let attempt = 0; attempt < 180; attempt += 1) {
      const next = await getMailSyncStatus(readBridgeToken());
      if (!mountedRef.current) return;
      setSyncStatus(next);
      if (next.status === 'running' && next.jobRunning !== false) {
        sawRunning = true;
        const current = next.phase === 'analyzing' && next.progress.total
          ? `${next.progress.current}/${next.progress.total} 분석 중…`
          : syncPhaseLabel(next.phase);
        setSyncMessage(current);
      } else if (next.status === 'failed' || (sawRunning && next.jobRunning === false && next.status !== 'completed')) {
        throw new Error(next.jobError || '메일 동기화에 실패했어.');
      } else if (next.status === 'completed' && (sawRunning || attempt >= 3)) {
        setSyncMessage('동기화 완료');
        await loadAnalysis();
        return;
      }
      await delay(1000);
    }
    throw new Error('메일 동기화 시간이 너무 오래 걸리고 있어. 상태를 다시 확인해줘.');
  }

  async function handleSync() {
    if (syncing) return;
    setSyncing(true);
    setSyncMessage('메일 수집 중…');
    setErrorCode(null);
    try {
      await startMailSync(readBridgeToken());
      await pollSyncStatus();
    } catch (error) {
      if (mountedRef.current) {
        setErrorCode(readErrorCode(error));
        setSyncMessage(error instanceof Error ? error.message : '메일 동기화에 실패했어.');
      }
    } finally {
      if (mountedRef.current) setSyncing(false);
    }
  }

  async function handleOpenThunderbird() {
    setOpenState('opening');
    setOpenError(null);
    try {
      await openThunderbird(readBridgeToken());
      setOpenState('opened');
    } catch (error) {
      setOpenState('idle');
      setOpenError(readErrorCode(error));
    }
  }

  async function handleOpenMail(item: PrioritizedMail) {
    setOpeningMailId(item.id);
    setOpenError(null);
    try {
      if (item.messageId) await openThunderbirdMessage(readBridgeToken(), item.messageId);
      else await openThunderbird(readBridgeToken());
      setOpenState('opened');
    } catch (error) {
      setOpenError(readErrorCode(error));
    } finally {
      setOpeningMailId(null);
    }
  }

  function replaceItem(next: MailAnalysisItem) {
    setItems((current) => current.map((item) => item.mail.id === next.mail.id ? next : item));
  }

  async function handleAddCandidate(item: PrioritizedMail, candidate: StoredMailCalendarCandidate, edit: CalendarCandidateEdit) {
    const result = await addCalendarEvent({
      mailId: item.id,
      candidateId: candidate.id,
      title: edit.title,
      start: edit.start,
      end: edit.end,
      allDay: edit.allDay,
      type: candidate.type,
      reason: candidate.reason,
    });
    const updated = await updateMailCandidate(readBridgeToken(), {
      mailId: item.id,
      candidateId: candidate.id,
      status: 'added',
      ...edit,
      ...(result.eventId ? { calendarEventId: result.eventId } : {}),
    });
    setItems((current) => current.map((value) => value.mail.id !== item.id ? value : {
      ...value,
      candidates: value.candidates.map((stored) => stored.id === candidate.id ? updated : stored),
    }));
  }

  async function handleIgnoreCandidate(item: PrioritizedMail, candidate: StoredMailCalendarCandidate) {
    const updated = await updateMailCandidate(readBridgeToken(), {
      mailId: item.id,
      candidateId: candidate.id,
      status: 'ignored',
      title: candidate.title,
      start: candidate.start,
      end: candidate.end,
      allDay: candidate.allDay,
    });
    setItems((current) => current.map((value) => value.mail.id !== item.id ? value : {
      ...value,
      candidates: value.candidates.map((stored) => stored.id === candidate.id ? updated : stored),
    }));
  }

  async function handleRetry(item: MailAnalysisItem) {
    try {
      await reanalyzeMail(readBridgeToken(), item.mail.id);
      setItems((current) => current.map((value) => value.mail.id !== item.mail.id ? value : {
        ...value,
        analysis: { ...value.analysis, status: 'processing', error: null },
      }));
      for (let attempt = 0; attempt < 180; attempt += 1) {
        await delay(1000);
        const next = await getMailAnalysisItem(readBridgeToken(), item.mail.id);
        replaceItem(next);
        if (next.analysis.status === 'completed' || next.analysis.status === 'failed') return;
      }
      throw new Error('AI 재분석 시간이 너무 오래 걸리고 있어. 상태를 다시 확인해줘.');
    } catch (error) {
      if (!mountedRef.current) return;
      const message = error instanceof Error ? error.message : 'AI 재분석에 실패했어.';
      setItems((current) => current.map((value) => value.mail.id !== item.mail.id ? value : {
        ...value,
        analysis: { ...value.analysis, status: 'failed', error: message },
      }));
    }
  }

  function handleFolderChange(folder: ThunderbirdAnalysisFolderId) {
    setSelectedFolder(folder);
    setVisibleCount(INITIAL_MAIL_VISIBLE_COUNT);
  }

  function handleSearchChange(value: string) {
    setSearchQuery(value);
    setVisibleCount(INITIAL_MAIL_VISIBLE_COUNT);
  }

  function handleFilterChange(value: MailFilter) {
    setMailFilter(value);
    setVisibleCount(INITIAL_MAIL_VISIBLE_COUNT);
  }

  function handleSortChange(value: MailSort) {
    setMailSort(value);
    setVisibleCount(INITIAL_MAIL_VISIBLE_COUNT);
  }

  const selectedLabel = mailFolderTabLabel(selectedFolder);
  const openLabel = openState === 'opening' ? 'Thunderbird 여는 중…' : openState === 'opened' ? 'Thunderbird 열림' : 'Thunderbird 열기';
  const currentSyncLabel = syncing ? syncMessage : syncStatus?.status === 'running' ? syncPhaseLabel(syncStatus.phase) : syncMessage;

  return <section className="card section microsoft-mail-card mail-panel">
    <div className="head"><h3>메일</h3><span>{mailPanelStatusLabel(status, errorCode)}</span></div>
    <div className="mail-analysis-sync-summary">
      <div><b>메일 분석</b><small>대상 폴더: 학교 업무, 국제과</small></div>
      <div className="mail-analysis-sync-metrics"><small>마지막 동기화: {formatSyncDate(syncStatus?.lastSyncAt)}</small><small>신규 메일: {syncStatus?.newCount ?? 0}</small><small>분석 완료: {syncStatus?.analysisCompleted ?? 0}</small><small>분석 실패: {syncStatus?.analysisFailed ?? 0}</small></div>
      <button className="btn" disabled={syncing} onClick={() => void handleSync()} type="button">{syncing ? currentSyncLabel : '메일 분석 동기화'}</button>
    </div>
    {syncing && <div className="note" aria-live="polite">{currentSyncLabel}</div>}
    {!syncing && syncStatus?.status === 'failed' && <div className="error microsoft-mail-error">{syncStatus.folders.find((folder) => folder.error)?.error || '마지막 메일 동기화에 실패했어.'}</div>}
    <div className="muted"><small>{selectedLabel} · SQLite · Thunderbird 동기화 결과</small></div>
    <div className="mail-folder-tabs" role="tablist" aria-label="메일 분석 폴더">
      {defaultMailFolders().map((folder) => <button
        className={`mail-folder-tab${selectedFolder === folder.id ? ' active' : ''}`}
        key={folder.id}
        onClick={() => handleFolderChange(folder.id as ThunderbirdAnalysisFolderId)}
        role="tab"
        aria-selected={selectedFolder === folder.id}
        type="button"
      >{folder.label}</button>)}
    </div>
    {(status === 'ready' || status === 'empty') && <MailListControls
      filter={mailFilter}
      onFilterChange={handleFilterChange}
      onQueryChange={handleSearchChange}
      onSortChange={handleSortChange}
      query={searchQuery}
      sort={mailSort}
    />}
    {status === 'loading' && <div className="microsoft-mail-state">SQLite에 저장된 {selectedLabel} 메일을 확인하는 중이야…</div>}
    {(status === 'ready' || status === 'empty') && <>
      <div className="mail-list-summary" aria-live="polite"><span>{visibleItems.length} / {filteredItems.length}개 표시</span><small>SQLite 저장 범위 기준</small></div>
      {filteredItems.length ? <div className="microsoft-mail-list">{visibleItems.map((item, index) => {
        const stored = folderItems.find((value) => value.mail.id === item.id);
        if (!stored) return null;
        return <SchoolMailRow
          analysisDetails={<MailAnalysisDetails
            candidates={stored.candidates}
            onAddCandidate={(candidate, edit) => handleAddCandidate(item, candidate, edit)}
            onIgnoreCandidate={(candidate) => handleIgnoreCandidate(item, candidate)}
            onRetry={() => handleRetry(stored)}
            record={stored.analysis}
          />}
          analysisExpanded={expandedAnalysisId === item.id}
          analysisState={stored.analysis.status}
          item={item}
          isOpening={openingMailId === item.id}
          key={schoolMailRowKey(item, index)}
          onOpen={handleOpenMail}
          onToggleAnalysis={() => setExpandedAnalysisId((current) => current === item.id ? null : item.id)}
        />;
      })}</div> : <div className="empty compact-empty">{folderItems.length ? '조건에 맞는 메일이 없어.' : `${selectedLabel}에 저장된 메일이 없어. 동기화를 눌러 수집해줘.`}</div>}
      {hasMoreItems && <div className="mail-list-more"><button className="mini" onClick={() => setVisibleCount(nextMailVisibleCount(visibleCount))} type="button">더 보기 (+{Math.min(MAIL_VISIBLE_INCREMENT, filteredItems.length - visibleItems.length)})</button></div>}
    </>}
    {status !== 'loading' && status !== 'ready' && status !== 'empty' && <div className="microsoft-mail-error-wrap"><div className="error microsoft-mail-error">{mailPanelStateMessage(errorCode)}</div><button className="mini" onClick={() => void loadAnalysis()} type="button">다시 시도</button></div>}
    {openError && <div className="error school-mail-open-error">{thunderbirdMailErrorMessage(openError)}</div>}
    <div className="toolbar school-mail-actions">
      <button className="btn" disabled={openState === 'opening'} onClick={() => void handleOpenThunderbird()} type="button">{openLabel}</button>
      <button className="mini" onClick={() => void loadAnalysis()} type="button">새로고침</button>
    </div>
  </section>;
}

function MailListControls({
  filter,
  onFilterChange,
  onQueryChange,
  onSortChange,
  query,
  sort,
}: {
  filter: MailFilter;
  onFilterChange: (value: MailFilter) => void;
  onQueryChange: (value: string) => void;
  onSortChange: (value: MailSort) => void;
  query: string;
  sort: MailSort;
}) {
  const filterOptions: MailFilter[] = ['all', 'unread', 'important', 'critical'];
  const sortOptions: MailSort[] = ['newest', 'priority'];
  return <div className="mail-list-controls">
    <label className="mail-search-field" htmlFor="mail-search-input"><span>메일 검색</span><input
      aria-label="제목 또는 발신자 검색"
      id="mail-search-input"
      onChange={(event) => onQueryChange(event.target.value)}
      placeholder="제목 또는 발신자 검색"
      type="search"
      value={query}
    /></label>
    <div className="mail-filter-control" aria-label="메일 필터" role="group">
      {filterOptions.map((value) => <button
        aria-pressed={filter === value}
        className={`mail-filter-button${filter === value ? ' active' : ''}`}
        key={value}
        onClick={() => onFilterChange(value)}
        type="button"
      >{MAIL_FILTER_LABELS[value]}</button>)}
    </div>
    <label className="mail-sort-control"><span>정렬</span><select aria-label="메일 정렬" onChange={(event) => onSortChange(event.target.value as MailSort)} value={sort}>
      {sortOptions.map((value) => <option key={value} value={value}>{MAIL_SORT_LABELS[value]}</option>)}
    </select></label>
  </div>;
}

function syncPhaseLabel(phase: string): string {
  if (phase === 'collecting') return '메일 수집 중…';
  if (phase === 'analyzing') return 'AI 분석 중…';
  return '동기화 중…';
}

function formatSyncDate(value: string | null | undefined): string {
  if (!value) return '없음';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '확인 필요';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function statusForError(errorCode: ThunderbirdMailErrorCode): MailPanelStatus {
  if (errorCode === 'bridge_offline') return 'bridge_offline';
  return 'error';
}

function readErrorCode(error: unknown): ThunderbirdMailErrorCode {
  if (error instanceof ThunderbirdMailError) return error.code;
  if (error instanceof MailAnalysisClientError) return error.code === 'bridge_auth' ? 'bridge_auth' : 'bridge_offline';
  return 'bridge_offline';
}
