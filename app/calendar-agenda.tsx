import type { CalendarEvent } from '@/lib/calendar';
import type { CalendarApiResponse } from '@/lib/client-api';
import { agendaDayLabel, overlappingEventIds } from '@/lib/calendar-agenda';
import { eventDateKey, seoulDateKey } from '@/lib/calendar-view';

const CATEGORY_LABEL: Record<CalendarEvent['category'], string> = { Meeting: '회의', Deadline: '마감', Research: '연구', Presentation: '발표', Other: '' };

function formatTime(start: string, end: string) {
  const formatter = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return `${formatter.format(new Date(start))}–${formatter.format(new Date(end))}`;
}

/** Confirmed Google Calendar events only: today first, then upcoming days. Candidates never appear here. */
export function CalendarAgenda({ calendar, stateText, now = new Date() }: { calendar: CalendarApiResponse; stateText: string; now?: Date }) {
  const todayKey = seoulDateKey(now);
  const failed = calendar.state === 'error' || calendar.state === 'unconfigured';
  const overlaps = overlappingEventIds(calendar.items);
  const days = new Map<string, CalendarEvent[]>();
  for (const event of calendar.items) {
    const key = eventDateKey(event);
    days.set(key, [...(days.get(key) ?? []), event]);
  }
  const ordered = [...days.entries()].sort(([a], [b]) => a.localeCompare(b));
  const hasToday = days.has(todayKey);

  return <div className="calendar-agenda">
    {failed
      ? <div className="calendar-agenda-notice" role="alert"><b>일정을 확인하지 못했어요.</b><span>일정이 없는 게 아니라 조회에 실패한 상태예요.</span><details><summary>진단 정보</summary>{stateText}</details></div>
      : !calendar.items.length && <p className="calendar-agenda-quiet">{stateText}</p>}
    {!failed && calendar.items.length > 0 && !hasToday && <p className="calendar-agenda-quiet">오늘 일정은 없어요.</p>}
    {ordered.map(([date, events]) => <section className={`calendar-agenda-day${date === todayKey ? ' today' : ''}`} key={date} aria-label={agendaDayLabel(date, todayKey)}>
      <h4>{agendaDayLabel(date, todayKey)}</h4>
      <ul className="calendar-events">{events.map((event) => <li className="event calendar-agenda-event" key={event.id}>
        <span className="calendar-agenda-time">{event.allDay ? '종일' : formatTime(event.start, event.end)}</span>
        <div className="calendar-agenda-copy">
          <b>{event.title || '(제목 없음)'}</b>
          <small>{[CATEGORY_LABEL[event.category], event.location].filter(Boolean).join(' · ') || 'Google Calendar'}</small>
          {overlaps.has(event.id) && <em className="calendar-agenda-overlap">다른 일정과 시간이 겹쳐요</em>}
          {event.htmlLink && <a href={event.htmlLink} target="_blank" rel="noreferrer">Google Calendar에서 열기</a>}
        </div>
      </li>)}</ul>
    </section>)}
    <p className="calendar-agenda-note">여기에는 확정된 일정만 보여요. 메일·학교 공지의 일정 후보는 검토 후 등록해야 나타나요.</p>
  </div>;
}
