'use client';

import { useEffect, useState } from 'react';
import type {
  MailAnalysisRecord,
  MailCalendarCandidateStatus,
  StoredMailCalendarCandidate,
} from '../lib/mail-analysis';

export type CalendarCandidateEdit = {
  title: string;
  start: string;
  end: string | null;
  allDay: boolean;
};

type MailAnalysisDetailsProps = {
  record?: MailAnalysisRecord;
  candidates?: StoredMailCalendarCandidate[];
  onRetry: () => void | Promise<void>;
  onAddCandidate: (candidate: StoredMailCalendarCandidate, edit: CalendarCandidateEdit) => Promise<void>;
  onIgnoreCandidate: (candidate: StoredMailCalendarCandidate) => void | Promise<void>;
};

export function MailAnalysisDetails({ record, candidates = [], onRetry, onAddCandidate, onIgnoreCandidate }: MailAnalysisDetailsProps) {
  if (!record || record.status === 'queued' || record.status === 'processing') {
    return <div className="mail-analysis-details"><div className="mail-analysis-state">{record?.status === 'processing' ? '로컬 CLI가 AI 분석을 진행 중이야…' : '메일 분석 동기화 후 AI 분석을 시작할 수 있어.'}</div></div>;
  }
  if (record.status === 'failed') {
    return <div className="mail-analysis-details"><div className="mail-analysis-error">{record.error || 'AI 메일 분석을 완료하지 못했어.'}</div><button className="mini" onClick={() => void onRetry()} type="button">AI 재분석</button></div>;
  }

  return <div className="mail-analysis-details">
    <div className="mail-analysis-heading"><b>AI 요약</b>{record.model && <small>{record.model}</small>}</div>
    <p className="mail-analysis-summary">{record.summary || '요약이 비어 있어. AI 재분석을 시도해줘.'}</p>
    {record.action && <div className="mail-analysis-action"><b>해야 할 일</b><p>{record.action}</p></div>}
    <div className="mail-analysis-heading mail-analysis-calendar-heading"><b>일정 후보</b><small>확인 후 Google Calendar에 추가</small></div>
    {candidates.length ? <div className="mail-analysis-candidates">{candidates.map((candidate) => <CalendarCandidateCard
      candidate={candidate}
      key={candidate.id}
      onAdd={onAddCandidate}
      onIgnore={onIgnoreCandidate}
    />)}</div> : <div className="mail-analysis-empty">캘린더에 넣을 만한 일정 후보가 없어.</div>}
  </div>;
}

function CalendarCandidateCard({
  candidate,
  onAdd,
  onIgnore,
}: {
  candidate: StoredMailCalendarCandidate;
  onAdd: (candidate: StoredMailCalendarCandidate, edit: CalendarCandidateEdit) => Promise<void>;
  onIgnore: (candidate: StoredMailCalendarCandidate) => void | Promise<void>;
}) {
  const [title, setTitle] = useState(candidate.title);
  const [allDay, setAllDay] = useState(candidate.allDay);
  const [start, setStart] = useState(toInputValue(candidate.start, candidate.allDay));
  const [end, setEnd] = useState(candidate.end ? toInputValue(candidate.end, candidate.allDay) : '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setTitle(candidate.title);
    setAllDay(candidate.allDay);
    setStart(toInputValue(candidate.start, candidate.allDay));
    setEnd(candidate.end ? toInputValue(candidate.end, candidate.allDay) : '');
  }, [candidate.allDay, candidate.end, candidate.start, candidate.title]);

  function changeAllDay(value: boolean) {
    setAllDay(value);
    if (value) {
      setStart(start.slice(0, 10));
      setEnd(end ? end.slice(0, 10) : '');
    } else {
      const date = start.slice(0, 10);
      setStart(`${date}T09:00`);
      setEnd(end ? `${end.slice(0, 10)}T10:00` : `${date}T10:00`);
    }
  }

  async function handleAdd() {
    if (!title.trim() || !start.trim()) {
      setError('제목과 시작 날짜/시간을 입력해줘.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onAdd(candidate, { title: title.trim(), start: start.trim(), end: end.trim() || null, allDay });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Calendar에 추가하지 못했어.');
    } finally {
      setSaving(false);
    }
  }

  async function handleIgnore() {
    setSaving(true);
    setError('');
    try {
      await onIgnore(candidate);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '일정 후보를 무시하지 못했어.');
    } finally {
      setSaving(false);
    }
  }

  const statusLabel = candidateStatusLabel(candidate.status);
  return <article className={`mail-analysis-candidate ${candidate.status}`}>
    <div className="mail-analysis-candidate-top"><div><span className={`mail-analysis-type ${candidate.type}`}>{candidate.type === 'deadline' ? '마감' : '일정'}</span><b>{candidate.title}</b></div><span className="mail-analysis-candidate-status">{statusLabel}</span></div>
    <small className="mail-analysis-reason">{candidate.reason}</small>
    {candidate.status === 'pending' && <div className="mail-analysis-form">
      <label>제목<input onChange={(event) => setTitle(event.target.value)} value={title} /></label>
      <div className="mail-analysis-date-row">
        <label>시작<input onChange={(event) => setStart(event.target.value)} type={allDay ? 'date' : 'datetime-local'} value={start} /></label>
        <label>종료(선택)<input onChange={(event) => setEnd(event.target.value)} type={allDay ? 'date' : 'datetime-local'} value={end} /></label>
      </div>
      <label className="mail-analysis-all-day"><input checked={allDay} onChange={(event) => changeAllDay(event.target.checked)} type="checkbox" /> 종일 일정</label>
      <div className="mail-analysis-candidate-actions"><button className="btn" disabled={saving} onClick={() => void handleAdd()} type="button">{saving ? '추가 중…' : '캘린더 추가'}</button><button className="mini" disabled={saving} onClick={() => void handleIgnore()} type="button">무시</button></div>
      {error && <div className="mail-analysis-inline-error">{error}</div>}
    </div>}
    {candidate.status === 'added' && <small className="mail-analysis-added">Google Calendar에 추가했어{candidate.calendarEventId ? ` · ${candidate.calendarEventId.slice(0, 10)}…` : ''}</small>}
    {candidate.status === 'ignored' && <small className="mail-analysis-ignored">이 후보를 무시했어.</small>}
  </article>;
}

function candidateStatusLabel(status: MailCalendarCandidateStatus): string {
  if (status === 'added') return '추가됨';
  if (status === 'ignored') return '무시됨';
  return '확인 필요';
}

function toInputValue(value: string, allDay: boolean): string {
  if (allDay) return value.slice(0, 10);
  const date = new Date(DATE_TIME_WITHOUT_ZONE_RE.test(value) ? `${value}+09:00` : value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 16);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

const DATE_TIME_WITHOUT_ZONE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/;
