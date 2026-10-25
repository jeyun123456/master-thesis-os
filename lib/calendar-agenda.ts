import type { CalendarEvent } from './calendar';
import { eventDateKey } from './calendar-view';

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

/** Ids of timed events that overlap another timed event on the same Seoul day. All-day events never count. */
export function overlappingEventIds(events: CalendarEvent[]): Set<string> {
  const ids = new Set<string>();
  const timed = events.filter((event) => !event.allDay);
  for (let i = 0; i < timed.length; i += 1) {
    for (let j = i + 1; j < timed.length; j += 1) {
      const a = timed[i];
      const b = timed[j];
      if (eventDateKey(a) !== eventDateKey(b)) continue;
      if (Date.parse(a.start) < Date.parse(b.end) && Date.parse(b.start) < Date.parse(a.end)) {
        ids.add(a.id);
        ids.add(b.id);
      }
    }
  }
  return ids;
}

/** "오늘", "내일", or "10월 27일 (화) · D-3" from yyyy-mm-dd keys. */
export function agendaDayLabel(dateKey: string, todayKey: string): string {
  const day = new Date(`${dateKey}T12:00:00+09:00`);
  const today = new Date(`${todayKey}T12:00:00+09:00`);
  const diff = Math.round((day.getTime() - today.getTime()) / 86_400_000);
  const date = `${Number(dateKey.slice(5, 7))}월 ${Number(dateKey.slice(8, 10))}일 (${WEEKDAYS[day.getUTCDay()]})`;
  if (diff === 0) return `오늘 · ${date}`;
  if (diff === 1) return `내일 · ${date}`;
  return diff > 1 ? `${date} · D-${diff}` : date;
}
