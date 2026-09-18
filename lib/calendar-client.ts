import type { CalendarCreateInput, CalendarCreateResult } from './calendar';

export async function addCalendarEvent(input: CalendarCreateInput, fetchImpl: typeof fetch = fetch): Promise<CalendarCreateResult> {
  const response = await fetchImpl('/api/calendar/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new Error('Calendar 응답을 읽지 못했어.');
  }
  if (!response.ok || !data || typeof data !== 'object' || Array.isArray(data) || (data as Record<string, unknown>).ok !== true) {
    const message = data && typeof data === 'object' && !Array.isArray(data) && typeof (data as Record<string, unknown>).error === 'string'
      ? (data as Record<string, unknown>).error as string
      : 'Google Calendar에 일정을 추가하지 못했어.';
    throw new Error(message);
  }
  return data as CalendarCreateResult & { ok: true };
}
