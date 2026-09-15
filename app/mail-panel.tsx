'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getRecentThunderbirdMail,
  getThunderbirdFolders,
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
import { prioritizeMails, type PrioritizedMail } from '../lib/mail-priority';
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
      const result = await getRecentThunderbirdMail(readBridgeToken(), fetch, 20, folder);
      if (serial !== requestSerial.current) return;
      setAccount(result.account);
      setItems(prioritizeMails(result.items));
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
        onClick={() => setSelectedFolder(folder.id)}
        role="tab"
        aria-selected={selectedFolder === folder.id}
        type="button"
      >{folder.label}</button>)}
    </div>
    {folderErrorCode && status !== 'error' && <div className="note mail-folder-note">Thunderbird 폴더 목록을 확인하지 못했어. 선택한 폴더를 다시 시도할 수 있어.</div>}
    {status === 'loading' && <div className="microsoft-mail-state">{selectedLabel} 메일을 확인하는 중이야…</div>}
    {(status === 'ready' || status === 'empty') && (items.length ? <div className="microsoft-mail-list">{items.map((item, index) => <SchoolMailRow item={item} isOpening={openingMailId === item.id} key={schoolMailRowKey(item, index)} onOpen={handleOpenMail} />)}</div> : <div className="empty compact-empty">{selectedLabel}에 최근 메일이 없어.</div>)}
    {status !== 'loading' && status !== 'ready' && status !== 'empty' && <div className="microsoft-mail-error-wrap"><div className="error microsoft-mail-error">{mailPanelStateMessage(errorCode)}</div><button className="mini" onClick={() => void loadMail(selectedFolder)} type="button">다시 시도</button></div>}
    {openError && <div className="error school-mail-open-error">{thunderbirdMailErrorMessage(openError)}</div>}
    <div className="toolbar school-mail-actions">
      <button className="btn" disabled={openState === 'opening'} onClick={() => void handleOpenThunderbird()} type="button">{openLabel}</button>
      <button className="mini" onClick={() => { void loadFolders(); void loadMail(selectedFolder); }} type="button">새로고침</button>
    </div>
  </section>;
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
