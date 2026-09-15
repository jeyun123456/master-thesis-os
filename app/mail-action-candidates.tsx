'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  getRecentThunderbirdMail,
  thunderbirdMailErrorMessage,
  ThunderbirdMailError,
  type ThunderbirdMailErrorCode,
} from '../lib/thunderbird-mail';
import { prioritizeMail } from '../lib/mail-priority';
import {
  createMailActionCandidates,
  isMailActionOverdue,
  MAIL_ACTION_DISMISSED_STORAGE_KEY,
  type MailActionCandidate,
} from '../lib/mail-action';

type MailActionStatus = 'loading' | 'ready' | 'empty' | 'error';

export function MailActionCandidates() {
  const [status, setStatus] = useState<MailActionStatus>('loading');
  const [errorCode, setErrorCode] = useState<ThunderbirdMailErrorCode | null>(null);
  const [candidates, setCandidates] = useState<MailActionCandidate[]>([]);

  const loadCandidates = useCallback(async () => {
    setStatus('loading');
    setErrorCode(null);
    try {
      const result = await getRecentThunderbirdMail(readBridgeToken(), fetch, 20);
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

  return <section className="card section mail-action-card">
    <div className="head"><h3>메일에서 확인 필요</h3><span>{mailActionStatusLabel(status, candidates.length)}</span></div>
    <div className="muted"><small>Mail candidate · Calendar 일정과 별도</small></div>
    {status === 'loading' && <div className="microsoft-mail-state">메일에서 행동 후보를 찾는 중이야…</div>}
    {status === 'empty' && <div className="empty compact-empty">현재 메일에서 확인할 중요 작업이 없어.</div>}
    {status === 'error' && <div className="microsoft-mail-error-wrap"><div className="error microsoft-mail-error">{mailActionErrorMessage(errorCode)}</div><button className="mini" onClick={() => void loadCandidates()} type="button">다시 시도</button></div>}
    {status === 'ready' && <div className="mail-action-list">{candidates.map((candidate) => <MailActionRow candidate={candidate} key={candidate.id} onDismiss={dismissCandidate} />)}</div>}
    {status !== 'loading' && status !== 'error' && <div className="toolbar mail-action-actions"><button className="mini" onClick={() => void loadCandidates()} type="button">새로고침</button></div>}
  </section>;
}

function MailActionRow({ candidate, onDismiss }: { candidate: MailActionCandidate; onDismiss: (candidate: MailActionCandidate) => void }) {
  const overdue = isMailActionOverdue(candidate);
  const priorityLabel = candidate.priority === 'critical' ? '긴급' : '중요';
  return <div className={`mail-action-row ${candidate.priority}`}>
    <span className={`mail-action-priority ${candidate.priority}`}>{priorityLabel}</span>
    <span className="mail-action-main">
      <b>{candidate.title}</b>
      <small>{candidate.reason}{candidate.dueAt && ` · ${overdue ? '기한 지남 · ' : ''}${formatDueDate(candidate.dueAt)}`}</small>
      <small>{candidate.senderName ? `${candidate.senderName} · ` : ''}{relativeMailDate(candidate.receivedAt)}</small>
    </span>
    <button className="mini mail-action-dismiss" onClick={() => onDismiss(candidate)} type="button">확인 완료</button>
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
