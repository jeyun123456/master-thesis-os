'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  getRecentThunderbirdMail,
  MAX_MAIL_LIMIT,
  openThunderbird,
  openThunderbirdMessage,
  thunderbirdMailErrorMessage,
  ThunderbirdMailError,
  type ThunderbirdMailErrorCode,
  type ThunderbirdFolderId,
} from '../lib/thunderbird-mail';
import { prioritizeMail } from '../lib/mail-priority';
import {
  createMailActionCandidates,
  isMailActionOverdue,
  MAIL_ACTION_DISMISSED_STORAGE_KEY,
  mailActionTypeLabel,
  type MailActionCandidate,
} from '../lib/mail-action';

type MailActionStatus = 'loading' | 'ready' | 'empty' | 'error';
export const MAIL_ACTION_SOURCE_FOLDER: ThunderbirdFolderId = 'school-work';

export function MailActionCandidates() {
  const [status, setStatus] = useState<MailActionStatus>('loading');
  const [errorCode, setErrorCode] = useState<ThunderbirdMailErrorCode | null>(null);
  const [candidates, setCandidates] = useState<MailActionCandidate[]>([]);
  const [openingMailId, setOpeningMailId] = useState<string | null>(null);
  const [openError, setOpenError] = useState<ThunderbirdMailErrorCode | null>(null);

  const loadCandidates = useCallback(async () => {
    setStatus('loading');
    setErrorCode(null);
    setOpenError(null);
    try {
      const result = await getRecentThunderbirdMail(readBridgeToken(), fetch, MAX_MAIL_LIMIT, MAIL_ACTION_SOURCE_FOLDER);
      const prioritized = result.items.map(prioritizeMail);
      const nextCandidates = createMailActionCandidates(prioritized, { dismissedIds: readDismissedIds() });
      setCandidates(nextCandidates);
      setStatus(nextCandidates.length ? 'ready' : 'empty');
    } catch (error) {
      setCandidates([]);
      setErrorCode(readErrorCode(error));
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    void loadCandidates();
  }, [loadCandidates]);

  function dismissCandidate(candidate: MailActionCandidate) {
    const dismissed = readDismissedRecord();
    dismissed[candidate.id] = Date.now();
    try {
      localStorage.setItem(MAIL_ACTION_DISMISSED_STORAGE_KEY, JSON.stringify(dismissed));
    } catch {
      // A denied localStorage should not make the dashboard fail.
    }
    const nextCandidates = candidates.filter((item) => item.id !== candidate.id);
    setCandidates(nextCandidates);
    setStatus(nextCandidates.length ? 'ready' : 'empty');
  }

  async function handleOpenCandidate(candidate: MailActionCandidate) {
    setOpeningMailId(candidate.id);
    setOpenError(null);
    try {
      if (candidate.messageId) {
        await openThunderbirdMessage(readBridgeToken(), candidate.messageId);
      } else {
        await openThunderbird(readBridgeToken());
      }
    } catch (error) {
      setOpenError(readErrorCode(error));
    } finally {
      setOpeningMailId(null);
    }
  }

  return <section className="card section mail-action-card">
    <div className="head"><h3>메일에서 확인 필요</h3><span>{mailActionStatusLabel(status, candidates.length)}</span></div>
    <div className="muted"><small>Mail candidate · Calendar 일정과 별도</small></div>
    {status === 'loading' && <div className="microsoft-mail-state">메일에서 행동 후보를 찾는 중이야…</div>}
    {status === 'empty' && <div className="empty compact-empty">현재 메일에서 확인할 중요 작업이 없어.</div>}
    {status === 'error' && <div className="microsoft-mail-error-wrap"><div className="error microsoft-mail-error">{mailActionErrorMessage(errorCode)}</div><button className="mini" onClick={() => void loadCandidates()} type="button">다시 시도</button></div>}
    {status === 'ready' && <div className="mail-action-list">{candidates.map((candidate) => <MailActionRow candidate={candidate} isOpening={openingMailId === candidate.id} key={candidate.id} onDismiss={dismissCandidate} onOpen={handleOpenCandidate} />)}</div>}
    {openError && <div className="error school-mail-open-error">{thunderbirdMailErrorMessage(openError)}</div>}
    {status !== 'loading' && status !== 'error' && <div className="toolbar mail-action-actions"><button className="mini" onClick={() => void loadCandidates()} type="button">새로고침</button></div>}
  </section>;
}

function MailActionRow({ candidate, isOpening, onDismiss, onOpen }: { candidate: MailActionCandidate; isOpening: boolean; onDismiss: (candidate: MailActionCandidate) => void; onOpen: (candidate: MailActionCandidate) => void | Promise<void> }) {
  const overdue = isMailActionOverdue(candidate);
  const priorityLabel = candidate.priority === 'critical' ? '긴급' : '중요';
  return <div className={`mail-action-row ${candidate.priority}`}>
    <span className={`mail-action-priority ${candidate.priority}`}>{priorityLabel}</span>
    <span className="mail-action-main">
      <b>{candidate.title}</b>
      <small><span className="mail-action-type">{mailActionTypeLabel(candidate.type)}</span> · {candidate.reason}{candidate.dueAt && ` · ${overdue ? '기한 지남 · ' : ''}${formatDueDate(candidate.dueAt)}`}</small>
      <small>{candidate.senderName ? `${candidate.senderName} · ` : ''}{relativeMailDate(candidate.receivedAt)}</small>
    </span>
    <div className="mail-action-row-actions">
      <button aria-label={`${candidate.title} Thunderbird에서 열기`} className="mini" disabled={isOpening} onClick={() => { void onOpen(candidate); }} type="button">{isOpening ? '여는 중…' : 'Thunderbird에서 열기'}</button>
      <button className="mini mail-action-dismiss" onClick={() => onDismiss(candidate)} type="button">확인 완료</button>
    </div>
  </div>;
}

export function mailActionStatusLabel(status: MailActionStatus, count: number): string {
  if (status === 'loading') return '확인 중';
  if (status === 'ready') return `${count}건`;
  if (status === 'empty') return '없음';
  return '확인 필요';
}

export function mailActionErrorMessage(errorCode: ThunderbirdMailErrorCode | null): string {
  if (errorCode === 'bridge_auth') return 'Settings에서 Local Bridge token을 확인해줘.';
  return errorCode ? thunderbirdMailErrorMessage(errorCode) : '메일 행동 후보를 읽지 못했어.';
}

function readBridgeToken(): string {
  try {
    return localStorage.getItem('thesisBridgeToken') || '';
  } catch {
    return '';
  }
}

function readDismissedRecord(): Record<string, number> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(MAIL_ACTION_DISMISSED_STORAGE_KEY) || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([, timestamp]) => typeof timestamp === 'number'));
  } catch {
    return {};
  }
}

function readDismissedIds(): string[] {
  return Object.keys(readDismissedRecord());
}

function readErrorCode(error: unknown): ThunderbirdMailErrorCode {
  if (error instanceof ThunderbirdMailError) return error.code;
  return 'bridge_offline';
}

function formatDueDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return '날짜 정보 없음';
  return `${Number(match[2])}/${Number(match[3])}`;
}

function relativeMailDate(value: string): string {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return '시간 정보 없음';
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return '방금 전';
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days}일 전`;
  return `${new Date(timestamp).getFullYear()}/${new Date(timestamp).getMonth() + 1}/${new Date(timestamp).getDate()}`;
}
