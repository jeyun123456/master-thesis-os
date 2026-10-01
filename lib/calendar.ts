import { createHash } from 'node:crypto';
import { CalendarIntegrationError, clearGoogleTokenCacheForTests, createGoogleCalendarSession } from './calendar-google';
export { calendarWeekDates } from './calendar-dates';
export { CALENDAR_SCOPE, CalendarIntegrationError, createServiceAccountAssertion, normalizePrivateKey } from './calendar-google';
export type { CalendarErrorCode } from './calendar-google';

export const CALENDAR_TIMEZONE = 'Asia/Seoul';
const DEFAULT_DAYS = 14;
const CACHE_TTL_MS = 5 * 60 * 1000;

export type CalendarCategory = 'Meeting' | 'Deadline' | 'Research' | 'Presentation' | 'Other';
export type CalendarEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  description: string;
  location: string;
  calendarId: string;
  htmlLink: string;
  status: string;
  category: CalendarCategory;
};

type GoogleEvent = {
  id?: unknown;
  summary?: unknown;
  start?: { date?: unknown; dateTime?: unknown };
  end?: { date?: unknown; dateTime?: unknown };
  description?: unknown;
  location?: unknown;
  htmlLink?: unknown;
  status?: unknown;
};
type FetchLike = typeof fetch;
type CalendarOptions = { fetchImpl?: FetchLike; now?: Date; bypassCache?: boolean; startDate?: string };
type CalendarConfig = { serviceAccountEmail: string; privateKey: string; calendarIds: string[] };
type GoogleCalendarRequester = Awaited<ReturnType<typeof createGoogleCalendarSession>>;
type CacheEntry = { expiresAt: number; items: CalendarEvent[] };

export type CalendarCreateInput = {
  mailId: string;
  candidateId: string;
  title: string;
  start: string;
  end?: string | null;
  allDay: boolean;
  type?: 'event' | 'deadline';
  reason?: string;
  source?: 'mail' | 'portal' | 'inbox';
};

export type CalendarCreateResult = {
  created: boolean;
  eventId: string;
  calendarId: string;
  event?: CalendarEvent;
};

const cache = new Map<string, CacheEntry>();

/** Parse canonical comma-separated IDs, falling back to the legacy single-ID variable. */
export function parseCalendarIds(value?: string, legacyValue?: string): string[] {
  const source = value?.trim() ? value : legacyValue;
  if (!source) return [];
  return [...new Set(source.split(',').map((item) => item.trim()).filter(Boolean))];
}

function config(): CalendarConfig {
  return {
    serviceAccountEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim() || '',
    privateKey: process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || '',
    calendarIds: parseCalendarIds(process.env.GOOGLE_CALENDAR_IDS, process.env.GOOGLE_CALENDAR_ID),
  };
}

export function calendarConfigured(): boolean {
  const value = config();
  return Boolean(value.serviceAccountEmail && value.privateKey && value.calendarIds.length);
}

/** Kept for the existing API response contract; multi-calendar callers use calendar IDs internally. */
export function configuredCalendarId(): string {
  return config().calendarIds[0] || 'primary';
}

export function classifyCalendarEvent(title: string, description = ''): CalendarCategory {
  const value = `${title} ${description}`.toLocaleLowerCase();
  if (/deadline|due\b|마감|제출/.test(value)) return 'Deadline';
  if (/presentation|발표|세미나|콜로퀴엄/.test(value)) return 'Presentation';
  if (/meeting|미팅|회의|면담|지도교수/.test(value)) return 'Meeting';
  if (/research|연구|논문|문헌|분석|작성/.test(value)) return 'Research';
  return 'Other';
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function normalizeCalendarEvent(raw: GoogleEvent, calendarId: string): CalendarEvent {
  if (!raw || typeof raw !== 'object') {
    throw new CalendarIntegrationError('malformed_response', 'Google Calendar returned an invalid event.');
  }
  const id = stringValue(raw.id);
  const allDay = Boolean(stringValue(raw.start?.date));
  const start = allDay ? stringValue(raw.start?.date) : stringValue(raw.start?.dateTime);
  const end = allDay ? stringValue(raw.end?.date) : stringValue(raw.end?.dateTime);
  if (!id || !start || !end) {
    throw new CalendarIntegrationError('malformed_response', 'Google Calendar event is missing id, start, or end.');
  }
  const title = stringValue(raw.summary) || '(untitled)';
  const description = stringValue(raw.description);
  return {
    id,
    title,
    start,
    end,
    allDay,
    description,
    location: stringValue(raw.location),
    calendarId,
    htmlLink: stringValue(raw.htmlLink),
    status: stringValue(raw.status) || 'confirmed',
    category: classifyCalendarEvent(title, description),
  };
}

function seoulDate(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CALENDAR_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function calendarRange(days = DEFAULT_DAYS, now = new Date(), requestedStartDate?: string) {
  const safeDays = Number.isFinite(days) ? Math.min(Math.max(Math.trunc(days), 1), 365) : DEFAULT_DAYS;
  const startDate = requestedStartDate && dateOnlyIsValid(requestedStartDate) ? requestedStartDate : seoulDate(now);
  const start = new Date(`${startDate}T00:00:00+09:00`);
  const end = new Date(start.getTime() + safeDays * 86_400_000);
  return { days: safeDays, startDate, timeMin: start.toISOString(), timeMax: end.toISOString() };
}

export function calendarMonthBounds(month: string): { startDate: string; days: number } | null {
  const match = month.match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  if (year < 1970 || year > 9999 || monthNumber < 1 || monthNumber > 12) return null;
  return {
    startDate: `${match[1]}-${match[2]}-01`,
    days: new Date(Date.UTC(year, monthNumber, 0)).getUTCDate(),
  };
}

function validIdentifier(value: string): boolean {
  return Boolean(value) && value.length <= 256 && !/[\u0000-\u001f\u007f\s]/.test(value);
}

export function calendarEventIdForCandidate(mailId: string, candidateId: string): string {
  if (!validIdentifier(mailId) || !validIdentifier(candidateId)) {
    throw new CalendarIntegrationError('invalid_request', 'Calendar candidate identifiers are invalid.');
  }
  return createHash('sha256').update(`${mailId}\u0000${candidateId}`, 'utf8').digest('hex');
}

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::(\d{2}(?:\.\d{1,3})?))?(Z|[+-]\d{2}:\d{2})?$/;

function dateOnlyIsValid(value: string): boolean {
  if (!DATE_ONLY_RE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function dateTimeValue(value: string): string {
  const match = value.match(DATE_TIME_RE);
  if (!match) return value;
  return `${match[1]}:${match[2] || '00'}${match[3] || '+09:00'}`;
}

function dateTimeIsValid(value: string): boolean {
  return !Number.isNaN(Date.parse(dateTimeValue(value)));
}

function addOneDay(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function addOneHour(value: string): string {
  return new Date(Date.parse(dateTimeValue(value)) + 3_600_000).toISOString();
}

function normalizeCreateInput(input: CalendarCreateInput): {
  eventId: string;
  title: string;
  start: { date: string } | { dateTime: string; timeZone: string };
  end: { date: string } | { dateTime: string; timeZone: string };
  description: string;
} {
  const mailId = typeof input.mailId === 'string' ? input.mailId.trim() : '';
  const candidateId = typeof input.candidateId === 'string' ? input.candidateId.trim() : '';
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  const startValue = typeof input.start === 'string' ? input.start.trim() : '';
  const endValue = typeof input.end === 'string' ? input.end.trim() : '';
  if (!validIdentifier(mailId) || !validIdentifier(candidateId) || !title || title.length > 500 || !startValue) {
    throw new CalendarIntegrationError('invalid_request', 'Calendar event input is invalid.');
  }

  if (input.allDay) {
    if (!dateOnlyIsValid(startValue)) throw new CalendarIntegrationError('invalid_request', 'Calendar all-day start date is invalid.');
    const end = endValue || addOneDay(startValue);
    if (!dateOnlyIsValid(end) || end <= startValue) {
      throw new CalendarIntegrationError('invalid_request', 'Calendar all-day end date is invalid.');
    }
    return {
      eventId: calendarEventIdForCandidate(mailId, candidateId),
      title,
      start: { date: startValue },
      end: { date: end },
      description: `${input.source === 'portal' ? '학교 공지에서 확인한' : input.source === 'inbox' ? 'Inbox에서 정리한' : '메일에서 확인한'} ${input.type === 'deadline' ? '마감 후보' : '일정 후보'}${input.reason ? `\n${input.reason.trim().slice(0, 500)}` : ''}`,
    };
  }

  if (!startValue.includes('T') || !dateTimeIsValid(startValue)) {
    throw new CalendarIntegrationError('invalid_request', 'Calendar start time is invalid.');
  }
  const start = dateTimeValue(startValue);
  const end = endValue ? dateTimeValue(endValue) : addOneHour(startValue);
  if ((endValue && !endValue.includes('T')) || !dateTimeIsValid(end) || Date.parse(end) <= Date.parse(start)) {
    throw new CalendarIntegrationError('invalid_request', 'Calendar end time is invalid.');
  }
  return {
    eventId: calendarEventIdForCandidate(mailId, candidateId),
    title,
    start: { dateTime: start, timeZone: CALENDAR_TIMEZONE },
    end: { dateTime: end, timeZone: CALENDAR_TIMEZONE },
    description: `${input.source === 'portal' ? '학교 공지에서 확인한' : input.source === 'inbox' ? 'Inbox에서 정리한' : '메일에서 확인한'} ${input.type === 'deadline' ? '마감 후보' : '일정 후보'}${input.reason ? `\n${input.reason.trim().slice(0, 500)}` : ''}`,
  };
}

function eventStartMs(event: CalendarEvent): number {
  const value = event.allDay ? `${event.start}T00:00:00+09:00` : event.start;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? Number.MAX_SAFE_INTEGER : timestamp;
}

function eventDeduplicationKey(event: CalendarEvent): string {
  return `${event.calendarId}\u0000${event.id}\u0000${event.start}`;
}

async function fetchCalendarEvents(
  calendarId: string,
  range: ReturnType<typeof calendarRange>,
  requestGoogleCalendar: GoogleCalendarRequester,
): Promise<CalendarEvent[]> {
  const params = new URLSearchParams({
    timeMin: range.timeMin,
    timeMax: range.timeMax,
    timeZone: CALENDAR_TIMEZONE,
    singleEvents: 'true',
    orderBy: 'startTime',
    showDeleted: 'false',
    maxResults: '100',
  });
  const { data } = await requestGoogleCalendar({
    path: `/${encodeURIComponent(calendarId)}/events`,
    operation: 'events.list',
    calendarId,
    query: params,
  });
  if (!data || typeof data !== 'object' || !('items' in data) || !Array.isArray(data.items)) {
    throw new CalendarIntegrationError('malformed_response', 'Google Calendar response did not contain an event list.');
  }
  return data.items.map((item) => normalizeCalendarEvent(item as GoogleEvent, calendarId));
}

async function fetchCalendarEventById(
  calendarId: string,
  eventId: string,
  requestGoogleCalendar: GoogleCalendarRequester,
): Promise<CalendarEvent> {
  const { data } = await requestGoogleCalendar({
    path: `/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    operation: 'events.get',
    calendarId,
  });
  return normalizeCalendarEvent(data as GoogleEvent, calendarId);
}

export async function createCalendarEvent(
  input: CalendarCreateInput,
  options: { fetchImpl?: FetchLike; now?: Date } = {},
): Promise<CalendarCreateResult> {
  const value = config();
  if (!value.serviceAccountEmail || !value.privateKey || !value.calendarIds.length) {
    throw new CalendarIntegrationError('auth_error', 'Google Calendar service account is not configured.');
  }
  const normalized = normalizeCreateInput(input);
  const fetchImpl = options.fetchImpl || fetch;
  const now = options.now || new Date();
  const calendarId = value.calendarIds[0];
  const requestGoogleCalendar = await createGoogleCalendarSession(value, {
    fetchImpl,
    now,
    logOperation: { operation: 'events.insert', calendarId },
  });
  const { status, data } = await requestGoogleCalendar({
    path: `/${encodeURIComponent(calendarId)}/events`,
    operation: 'events.insert',
    calendarId,
    method: 'POST',
    query: new URLSearchParams({ sendUpdates: 'none' }),
    body: {
      id: normalized.eventId,
      summary: normalized.title,
      description: normalized.description,
      start: normalized.start,
      end: normalized.end,
      extendedProperties: {
        private: {
          masterThesisOsMailId: input.mailId.trim(),
          masterThesisOsCandidateId: input.candidateId.trim(),
          masterThesisOsSource: input.source === 'portal' ? 'portal-notice' : input.source === 'inbox' ? 'inbox' : 'mail',
        },
      },
    },
    acceptConflict: true,
  });
  if (status === 409) {
    const event = await fetchCalendarEventById(calendarId, normalized.eventId, requestGoogleCalendar);
    cache.clear();
    return { created: false, eventId: normalized.eventId, calendarId, event };
  }
  const event = normalizeCalendarEvent(data as GoogleEvent, calendarId);
  cache.clear();
  return { created: true, eventId: normalized.eventId, calendarId, event };
}

export async function getCalendarEvents(days = DEFAULT_DAYS, options: CalendarOptions = {}): Promise<CalendarEvent[]> {
  const fetchImpl = options.fetchImpl || fetch;
  const now = options.now || new Date();
  const value = config();
  const range = calendarRange(days, now, options.startDate);
  if (!value.calendarIds.length) {
    throw new CalendarIntegrationError('auth_error', 'Google Calendar service account is not configured.');
  }
  const cacheKey = `${value.calendarIds.join(',')}:${range.days}:${range.timeMin}`;
  const cached = cache.get(cacheKey);
  if (!options.bypassCache && cached && cached.expiresAt > now.getTime()) return cached.items;

  const requestGoogleCalendar = await createGoogleCalendarSession(value, { fetchImpl, now });
  const events: CalendarEvent[] = [];
  const failures: CalendarIntegrationError[] = [];
  for (const [index, calendarId] of value.calendarIds.entries()) {
    try {
      events.push(...await fetchCalendarEvents(calendarId, range, requestGoogleCalendar));
    } catch (error) {
      const failure = error instanceof CalendarIntegrationError
        ? error
        : new CalendarIntegrationError('network_error', 'Google Calendar request failed.');
      failures.push(failure);
      console.warn(`[calendar] calendar request failed (index=${index}, code=${failure.code})`);
    }
  }

  if (!events.length && failures.length === value.calendarIds.length) {
    throw failures[0];
  }

  const unique = [...new Map(events.map((event) => [eventDeduplicationKey(event), event])).values()];
  unique.sort((left, right) => eventStartMs(left) - eventStartMs(right));
  cache.set(cacheKey, { expiresAt: now.getTime() + CACHE_TTL_MS, items: unique });
  return unique;
}

export function clearCalendarCacheForTests(): void {
  cache.clear();
  clearGoogleTokenCacheForTests();
}
