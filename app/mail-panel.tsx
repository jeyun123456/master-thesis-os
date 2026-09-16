'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  getRecentThunderbirdMail,
  getThunderbirdFolders,
  MAX_MAIL_LIMIT,
  openThunderbird,
  openThunderbirdMessage,
  thunderbirdMailErrorMessage,
  ThunderbirdMailError,
  THUNDERBIRD_FOLDER_IDS,
  THUNDERBIRD_FOLDER_LABELS,
  type ThunderbirdFolder,
  type ThunderbirdFolderId,
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
import { SchoolMailRow, schoolMailRowKey } from './school-mail-panel';

type MailPanelStatus = 'loading' | 'ready' | 'empty' | 'bridge_offline' | 'thunderbird_not_found' | 'sync_required' | 'folder_not_found' | 'error';

export const MAIL_FOLDER_TAB_IDS = THUNDERBIRD_FOLDER_IDS;

export function mailFolderTabLabel(folderId: ThunderbirdFolderId): string {
  return THUNDERBIRD_FOLDER_LABELS[folderId];
}

export function defaultMailFolders(): ThunderbirdFolder[] {
  return MAIL_FOLDER_TAB_IDS.map((id) => ({ id, label: mailFolderTabLabel(id), available: true }));
}

export function mailPanelStatusLabel(status: MailPanelStatus, errorCode: ThunderbirdMailErrorCode | null): string {
  if (status === 'loading') return '확인 중';
  if (status === 'ready' || status === 'empty') return 'Thunderbird ● 로컬';
  if (status === 'bridge_offline') return '브리지 오프라인';
  if (status === 'thunderbird_not_found') return 'Thunderbird 없음';
  if (status === 'sync_required') return '동기화 필요';
  if (errorCode === 'bridge_auth') return '브리지 설정 필요';
  if (errorCode === 'folder_not_found') return '폴더 확인 필요';
  return '로컬 메일 오류';
}

export function mailPanelStateMessage(errorCode: ThunderbirdMailErrorCode | null): string {
  if (errorCode === 'profile_not_found' || errorCode === 'account_not_found') return 'Thunderbird 학교 계정을 찾지 못했어.';
  if (errorCode === 'inbox_not_found' || errorCode === 'folder_not_found') return '선택한 Thunderbird 메일 폴더를 찾지 못했어.';
  if (errorCode === 'local_sync_required') return thunderbirdMailErrorMessage('local_sync_required');
  if (errorCode === 'bridge_auth') return 'Settings에서 Local Bridge token을 확인해줘.';
  return errorCode ? thunderbirdMailErrorMessage(errorCode) : '학교 메일을 읽지 못했어.';
}

export function MailPanel() {
  const [selectedFolder, setSelectedFolder] = useState<ThunderbirdFolderId>('school-work');
  const [folders, setFolders] = useState<ThunderbirdFolder[]>(defaultMailFolders());
  const [status, setStatus] = useState<MailPanelStatus>('loading');
  const [errorCode, setErrorCode] = useState<ThunderbirdMailErrorCode | null>(null);
  const [folderErrorCode, setFolderErrorCode] = useState<ThunderbirdMailErrorCode | null>(null);
  const [account, setAccount] = useState('');
  const [items, setItems] = useState<PrioritizedMail[]>([]);
  const [openState, setOpenState] = useState<'idle' | 'opening' | 'opened'>('idle');
  const [openingMailId, setOpeningMailId] = useState<string | null>(null);
  const [openError, setOpenError] = useState<ThunderbirdMailErrorCode | null>(null);
  const [searchQuery, setSearchQuery] = useState(DEFAULT_MAIL_LIST_PREFERENCES.query);
  const [mailFilter, setMailFilter] = useState<MailFilter>(DEFAULT_MAIL_LIST_PREFERENCES.filter);
  const [mailSort, setMailSort] = useState<MailSort>(DEFAULT_MAIL_LIST_PREFERENCES.sort);
  const [visibleCount, setVisibleCount] = useState(DEFAULT_MAIL_LIST_PREFERENCES.visibleCount);
  const [preferencesReady, setPreferencesReady] = useState(false);
  const requestSerial = useRef(0);

  const loadFolders = useCallback(async () => {
    try {
      const result = await getThunderbirdFolders(readBridgeToken());
      setAccount(result.account);
      const discovered = new Map(result.folders.map((folder) => [folder.id, folder]));
      setFolders(MAIL_FOLDER_TAB_IDS.map((id) => discovered.get(id) || { id, label: mailFolderTabLabel(id), available: false }));
      setFolderErrorCode(null);
    } catch (error) {
      setFolderErrorCode(readErrorCode(error));
    }
  }, []);

  const loadMail = useCallback(async (folder: ThunderbirdFolderId) => {
    const serial = requestSerial.current + 1;
    requestSerial.current = serial;
    setStatus('loading');
    setErrorCode(null);
    setItems([]);
    try {
      const result = await getRecentThunderbirdMail(readBridgeToken(), fetch, MAX_MAIL_LIMIT, folder);
      if (serial !== requestSerial.current) return;
      setAccount(result.account);
      setItems(result.items.map(prioritizeMail));
      setStatus(result.items.length ? 'ready' : 'empty');
    } catch (error) {
      if (serial !== requestSerial.current) return;
      const nextCode = readErrorCode(error);
      setAccount('');
      setItems([]);
      setErrorCode(nextCode);
      setStatus(statusForError(nextCode));
    }
  }, []);

  useEffect(() => {
    void loadFolders();
  }, [loadFolders]);

  useEffect(() => {
    void loadMail(selectedFolder);
  }, [loadMail, selectedFolder]);

  useEffect(() => {
    try {
      const preferences = readMailListPreferences(localStorage.getItem(MAIL_LIST_PREFERENCES_STORAGE_KEY));
      setSearchQuery(preferences.query);
      setMailFilter(preferences.filter);
      setMailSort(preferences.sort);
      setVisibleCount(preferences.visibleCount);
    } catch {
      // Browser storage is optional; the in-memory defaults remain usable.
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

  const filteredItems = useMemo(
    () => filterAndSortMailItems(items, { filter: mailFilter, query: searchQuery, sort: mailSort }),
    [items, mailFilter, mailSort, searchQuery],
  );
  const visibleItems = filteredItems.slice(0, visibleCount);
  const hasMoreItems = visibleCount < MAX_MAIL_VISIBLE_COUNT && visibleItems.length < filteredItems.length;

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
      if (item.messageId) {
        await openThunderbirdMessage(readBridgeToken(), item.messageId);
      } else {
        await openThunderbird(readBridgeToken());
      }
      setOpenState('opened');
    } catch (error) {
      setOpenError(readErrorCode(error));
    } finally {
      setOpeningMailId(null);
    }
  }

  function handleFolderChange(folder: ThunderbirdFolderId) {
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

  return <section className="card section microsoft-mail-card mail-panel">
    <div className="head"><h3>메일</h3><span>{mailPanelStatusLabel(status, errorCode)}</span></div>
    <div className="muted"><small>{selectedLabel} · Thunderbird · 로컬 읽기 전용{account ? ` · ${account}` : ''}</small></div>
    <div className="mail-folder-tabs" role="tablist" aria-label="Thunderbird 메일 폴더">
      {folders.map((folder) => <button
        className={`mail-folder-tab${selectedFolder === folder.id ? ' active' : ''}`}
        disabled={!folder.available}
        key={folder.id}
        onClick={() => handleFolderChange(folder.id)}
        role="tab"
        aria-selected={selectedFolder === folder.id}
        type="button"
      >{folder.label}</button>)}
    </div>
    {folderErrorCode && status !== 'error' && <div className="note mail-folder-note">Thunderbird 폴더 목록을 확인하지 못했어. 선택한 폴더를 다시 시도할 수 있어.</div>}
    {(status === 'ready' || status === 'empty') && <MailListControls
      filter={mailFilter}
      onFilterChange={handleFilterChange}
      onQueryChange={handleSearchChange}
      onSortChange={handleSortChange}
      query={searchQuery}
      sort={mailSort}
    />}
    {status === 'loading' && <div className="microsoft-mail-state">{selectedLabel} 메일을 확인하는 중이야…</div>}
    {(status === 'ready' || status === 'empty') && <>
      <div className="mail-list-summary" aria-live="polite"><span>{visibleItems.length} / {filteredItems.length}개 표시</span><small>최근 불러온 범위 기준</small></div>
      {filteredItems.length ? <div className="microsoft-mail-list">{visibleItems.map((item, index) => <SchoolMailRow item={item} isOpening={openingMailId === item.id} key={schoolMailRowKey(item, index)} onOpen={handleOpenMail} />)}</div> : <div className="empty compact-empty">{items.length ? '조건에 맞는 메일이 없어.' : `${selectedLabel}에 최근 메일이 없어.`}</div>}
      {hasMoreItems && <div className="mail-list-more"><button className="mini" onClick={() => setVisibleCount(nextMailVisibleCount(visibleCount))} type="button">더 보기 (+{Math.min(MAIL_VISIBLE_INCREMENT, filteredItems.length - visibleItems.length)})</button></div>}
    </>}
    {status !== 'loading' && status !== 'ready' && status !== 'empty' && <div className="microsoft-mail-error-wrap"><div className="error microsoft-mail-error">{mailPanelStateMessage(errorCode)}</div><button className="mini" onClick={() => void loadMail(selectedFolder)} type="button">다시 시도</button></div>}
    {openError && <div className="error school-mail-open-error">{thunderbirdMailErrorMessage(openError)}</div>}
    <div className="toolbar school-mail-actions">
      <button className="btn" disabled={openState === 'opening'} onClick={() => void handleOpenThunderbird()} type="button">{openLabel}</button>
      <button className="mini" onClick={() => { void loadFolders(); void loadMail(selectedFolder); }} type="button">새로고침</button>
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

function statusForError(errorCode: ThunderbirdMailErrorCode): MailPanelStatus {
  if (errorCode === 'bridge_offline') return 'bridge_offline';
  if (errorCode === 'thunderbird_not_installed') return 'thunderbird_not_found';
  if (errorCode === 'local_sync_required') return 'sync_required';
  if (errorCode === 'folder_not_found' || errorCode === 'inbox_not_found') return 'folder_not_found';
  return 'error';
}

function readErrorCode(error: unknown): ThunderbirdMailErrorCode {
  if (error instanceof ThunderbirdMailError) return error.code;
  return 'bridge_offline';
}

function readBridgeToken(): string {
  try {
    return localStorage.getItem('thesisBridgeToken') || '';
  } catch {
    return '';
  }
}
