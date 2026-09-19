'use client';

import { CalendarCandidateCard, type CalendarCandidateEdit } from './mail-analysis-details';
import type { StoredMailCalendarCandidate } from '../lib/mail-analysis';
import type {
  PortalNoticeAI,
  PortalNoticeCalendarCandidate,
} from '../lib/portal-notices-client';

type PortalNoticeAIProps = {
  ai: PortalNoticeAI;
  candidates: PortalNoticeCalendarCandidate[];
  busy: boolean;
  onAnalyze: (force?: boolean) => void | Promise<void>;
  onAddCandidate: (candidate: PortalNoticeCalendarCandidate, edit: CalendarCandidateEdit) => Promise<void>;
  onIgnoreCandidate: (candidate: PortalNoticeCalendarCandidate) => void | Promise<void>;
};

function asMailCandidate(candidate: PortalNoticeCalendarCandidate): StoredMailCalendarCandidate {
  return {
    id: candidate.id,
    title: candidate.title,
    start: candidate.start,
    end: candidate.end,
    allDay: candidate.allDay,
    type: candidate.type,
    reason: candidate.reason,
    status: candidate.status,
    ...(candidate.calendarEventId ? { calendarEventId: candidate.calendarEventId } : {}),
  };
}

function renderText(value: string, prefix: string) {
  return value.split(/\r?\n/).map((line, index) => <p key={`${prefix}-${index}-${line}`}>{line || '\u00a0'}</p>);
}

export function PortalNoticeAI({
  ai,
  candidates,
  busy,
  onAnalyze,
  onAddCandidate,
  onIgnoreCandidate,
}: PortalNoticeAIProps) {
  const processing = ai.status === 'queued' || ai.status === 'processing' || busy;
  const completed = ai.status === 'completed';
  const failed = ai.status === 'failed';
  const buttonLabel = processing ? '분석 중…' : completed || failed ? 'AI 재분석' : 'AI 분석';

  return <section className="mail-analysis-details portal-notice-ai">
    <div className="portal-notice-ai-head">
      <div className="mail-analysis-heading"><b>AI 요약 · 번역</b>{ai.model && <small>{ai.model}</small>}</div>
      <button className="mini" disabled={processing} onClick={() => void onAnalyze(completed || failed)} type="button">{buttonLabel}</button>
    </div>
    {processing && <div className="mail-analysis-state">공지 본문을 분석하고 있어. 잠시만 기다려줘.</div>}
    {failed && <div className="mail-analysis-error">{ai.error || 'AI 분석을 완료하지 못했어.'}</div>}
    {!processing && !completed && !failed && <div className="mail-analysis-state">아직 분석하지 않은 공지야. 버튼을 누르면 한국어 요약·번역과 일정 후보를 생성해.</div>}
    {completed && <>
      <details className="portal-notice-ai-collapsible portal-notice-ai-summary" open>
        <summary>요약</summary>
        <div className="portal-notice-ai-block">
          <div className="mail-analysis-summary">{ai.summary ? renderText(ai.summary, 'summary') : '요약이 비어 있어.'}</div>
        </div>
      </details>
      <details className="portal-notice-ai-translation" open>
        <summary>한국어 번역</summary>
        <div>{ai.translation ? renderText(ai.translation, 'translation') : '번역이 비어 있어.'}</div>
      </details>
      <details className="portal-notice-ai-collapsible portal-notice-ai-candidates" open>
        <summary>
          <span className="portal-notice-ai-candidates-label"><b>일정 후보</b><small>확인 후 Google Calendar에 추가</small></span>
          <small className="portal-notice-ai-candidates-count">{candidates.length}건</small>
        </summary>
        {candidates.length ? <div className="mail-analysis-candidates">{candidates.map((candidate) => <CalendarCandidateCard
          candidate={asMailCandidate(candidate)}
          key={candidate.id}
          onAdd={(_, edit) => onAddCandidate(candidate, edit)}
          onIgnore={() => onIgnoreCandidate(candidate)}
        />)}</div> : <div className="mail-analysis-empty">캘린더에 넣을 만한 일정 후보가 없어.</div>}
      </details>
    </>}
  </section>;
}
