import { createHash, createSign } from 'node:crypto';

export const CALENDAR_TIMEZONE = 'Asia/Seoul';
export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const CALENDAR_API_ROOT = 'https://www.googleapis.com/calendar/v3/calendars';
const DEFAULT_DAYS = 14;
const CACHE_TTL_MS = 5 * 60 * 1000;
const TOKEN_CACHE_SKEW_MS = 60 * 1000;

export type CalendarCategory = 'Meeting' | 'Deadline' | 'Research' | 'Presentation' | 'Other';
export type CalendarErrorCode = 'auth_error' | 'insufficient_permissions' | 'quota_error' | 'network_error' | 'malformed_response' | 'invalid_calendar' | 'conflict' | 'invalid_request';
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
type CalendarOptions = { fetchImpl?: FetchLike; now?: Date; bypassCache?: boolean };
type CalendarConfig = { serviceAccountEmail: string; privateKey: string; calendarIds: string[] };
type CacheEntry = { expiresAt: number; items: CalendarEvent[] };
type AccessTokenEntry = { token: string; expiresAt: number };

export type CalendarCreateInput = {
  mailId: string;
  candidateId: string;
  title: string;
  start: string;
  end?: string | null;
  allDay: boolean;
  type?: 'event' | 'deadline';
  reason?: string;
};

export type CalendarCreateResult = {
  created: boolean;
  eventId: string;
  calendarId: string;
  event?: CalendarEvent;
};

const cache = new Map<string, CacheEntry>();
let accessTokenCache: AccessTokenEntry | null = null;

export class CalendarIntegrationError extends Error {
  readonly httpStatus?: number;
  readonly providerReason?: string;
  readonly providerMessage?: string;

  constructor(
    public readonly code: CalendarErrorCode,
    message: string,
    details?: { httpStatus?: number; providerReason?: string; providerMessage?: string },
  ) {
    super(message);
    this.name = 'CalendarIntegrationError';
    this.httpStatus = details?.httpStatus;
    this.providerReason = details?.providerReason;
    this.providerMessage = details?.providerMessage;
  }
}

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
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: CALENDAR_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function calendarRange(days = DEFAULT_DAYS, now = new Date()) {
  const safeDays = Number.isFinite(days) ? Math.min(Math.max(Math.trunc(days), 1), 365) : DEFAULT_DAYS;
  const start = new Date(`${seoulDate(now)}T00:00:00+09:00`);
  const end = new Date(start.getTime() + safeDays * 86_400_000);
  return { days: safeDays, timeMin: start.toISOString(), timeMax: end.toISOString() };
}

export function normalizePrivateKey(value: string): string {
  return value.replace(/\\n/g, '\n');
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
const DATE_TIME_WITHOUT_ZONE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/;

function dateOnlyIsValid(value: string): boolean {
  if (!DATE_ONLY_RE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function dateTimeValue(value: string): string {
  return DATE_TIME_WITHOUT_ZONE_RE.test(value) ? `${value}+09:00` : value;
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
      description: `${input.type === 'deadline' ? '메일에서 확인한 마감 후보' : '메일에서 확인한 일정 후보'}${input.reason ? `\n${input.reason.trim().slice(0, 500)}` : ''}`,
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
    description: `${input.type === 'deadline' ? '메일에서 확인한 마감 후보' : '메일에서 확인한 일정 후보'}${input.reason ? `\n${input.reason.trim().slice(0, 500)}` : ''}`,
  };
}

function base64Url(value: string | Record<string, unknown> | Buffer): string {
  return Buffer.from(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value))
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

export function createServiceAccountAssertion(email: string, privateKey: string, now = new Date()): string {
  const issuedAt = Math.floor(now.getTime() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: email,
    scope: CALENDAR_SCOPE,
    aud: TOKEN_ENDPOINT,
    iat: issuedAt,
    exp: issuedAt + 3600,
  };
  const unsigned = `${base64Url(header)}.${base64Url(claim)}`;
  const signature = createSign('RSA-SHA256')
    .update(unsigned)
    .sign(normalizePrivateKey(privateKey));
  return `${unsigned}.${base64Url(signature)}`;
}

async function responseJson(response: Response): Promise<unknown> {
  try {
    return await response.json() as unknown;
  } catch {
    throw new CalendarIntegrationError('malformed_response', 'Google returned malformed JSON.');
  }
}

type ProviderErrorDetails = {
  providerReason?: string;
  providerMessage?: string;
  providerBody: string;
};

function providerErrorDetails(body: unknown): ProviderErrorDetails {
  const root = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
  const error = root.error && typeof root.error === 'object' && !Array.isArray(root.error)
    ? root.error as Record<string, unknown>
    : {};
  const errors = Array.isArray(error.errors) ? error.errors : [];
  const firstError = errors.find((item) => item && typeof item === 'object') as Record<string, unknown> | undefined;
  const providerReason = typeof firstError?.reason === 'string'
    ? firstError.reason
    : typeof error.reason === 'string'
      ? error.reason
      : undefined;
  const providerMessage = typeof error.message === 'string'
    ? error.message
    : typeof body === 'string'
      ? body
      : undefined;
  let providerBody = '{}';
  try {
    providerBody = JSON.stringify(body, (key, value) =>
      /token|secret|private.?key|assertion|authorization/i.test(key) ? '[redacted]' : value,
    ).slice(0, 2000);
  } catch {
    providerBody = '[unserializable provider response]';
  }
  return { providerReason, providerMessage, providerBody };
}

function providerFailure(
  operation: string,
  status: number,
  body: unknown,
  value: CalendarConfig,
  calendarId?: string,
): CalendarIntegrationError {
  const details = providerErrorDetails(body);
  const code = calendarErrorCode(status, body);
  console.error('[calendar] Google API failure', JSON.stringify({
    operation,
    status,
    code,
    serviceAccountEmail: value.serviceAccountEmail || '<missing>',
    calendarId: calendarId || null,
    scope: CALENDAR_SCOPE,
    providerReason: details.providerReason || null,
    providerMessage: details.providerMessage || null,
    providerBody: details.providerBody,
  }));
  return new CalendarIntegrationError(code, 'Google Calendar request failed.', {
    httpStatus: status,
    providerReason: details.providerReason,
    providerMessage: details.providerMessage,
  });
}

function logRuntimeConfig(operation: string, value: CalendarConfig, calendarId?: string): void {
  console.info('[calendar] runtime config', JSON.stringify({
    operation,
    serviceAccountEmail: value.serviceAccountEmail || '<missing>',
    calendarId: calendarId || null,
    calendarIds: value.calendarIds,
    hasPrivateKey: Boolean(value.privateKey),
    scope: CALENDAR_SCOPE,
  }));
}

function tokenErrorCode(status: number): CalendarErrorCode {
  if (status === 429) return 'quota_error';
  if (status === 400 || status === 401 || status === 403) return 'auth_error';
  return 'network_error';
}

function calendarErrorCode(status: number, body: unknown): CalendarErrorCode {
  if (status === 404) return 'invalid_calendar';
  if (status === 409) return 'conflict';
  if (status === 429) return 'quota_error';
  const serialized = JSON.stringify(body);
  if (status === 403 && /quotaExceeded|rateLimitExceeded|userRateLimitExceeded/.test(serialized)) return 'quota_error';
  if (status === 403 && /insufficientPermissions|insufficient permissions/i.test(serialized)) return 'insufficient_permissions';
  if (status === 400 || status === 401 || status === 403) return 'auth_error';
  return 'network_error';
}

async function accessToken(fetchImpl: FetchLike, now: Date): Promise<string> {
  const value = config();
  if (!value.serviceAccountEmail || !value.privateKey || !value.calendarIds.length) {
    throw new CalendarIntegrationError('auth_error', 'Google Calendar service account is not configured.');
  }
  logRuntimeConfig('oauth-token', value);

  const nowMs = now.getTime();
  if (accessTokenCache && accessTokenCache.expiresAt - TOKEN_CACHE_SKEW_MS > nowMs) {
    return accessTokenCache.token;
  }

  const assertion = createServiceAccountAssertion(value.serviceAccountEmail, value.privateKey, now);
  let response: Response;
  try {
    response = await fetchImpl(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
      cache: 'no-store',
    });
  } catch {
    throw new CalendarIntegrationError('network_error', 'Google service account token request could not be reached.');
  }

  const data = await responseJson(response);
  if (!response.ok) {
    const failure = providerFailure('oauth-token', response.status, data, value);
    throw new CalendarIntegrationError(tokenErrorCode(response.status), failure.message, {
      httpStatus: response.status,
      providerReason: failure.providerReason,
      providerMessage: failure.providerMessage,
    });
  }
  const token = typeof data === 'object' && data && 'access_token' in data ? stringValue(data.access_token) : '';
  if (!token) {
    throw new CalendarIntegrationError('malformed_response', 'Google service account response did not contain an access token.');
  }
  const expiresIn = typeof data === 'object' && data && 'expires_in' in data && typeof data.expires_in === 'number'
    ? data.expires_in
    : 3600;
  accessTokenCache = { token, expiresAt: nowMs + Math.max(0, expiresIn) * 1000 };
  return token;
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
  token: string,
  range: ReturnType<typeof calendarRange>,
  fetchImpl: FetchLike,
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
  let response: Response;
  try {
    response = await fetchImpl(`${CALENDAR_API_ROOT}/${encodeURIComponent(calendarId)}/events?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
  } catch {
    throw new CalendarIntegrationError('network_error', 'Google Calendar request could not be reached.');
  }

  const data = await responseJson(response);
  if (!response.ok) {
    throw providerFailure('events.list', response.status, data, config(), calendarId);
  }
  if (!data || typeof data !== 'object' || !('items' in data) || !Array.isArray(data.items)) {
    throw new CalendarIntegrationError('malformed_response', 'Google Calendar response did not contain an event list.');
  }
  return data.items.map((item) => normalizeCalendarEvent(item as GoogleEvent, calendarId));
}

async function fetchCalendarEventById(
  calendarId: string,
  eventId: string,
  token: string,
  fetchImpl: FetchLike,
): Promise<CalendarEvent> {
  let response: Response;
  try {
    response = await fetchImpl(`${CALENDAR_API_ROOT}/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
  } catch {
    throw new CalendarIntegrationError('network_error', 'Google Calendar request could not be reached.');
  }
  const data = await responseJson(response);
  if (!response.ok) throw providerFailure('events.get', response.status, data, config(), calendarId);
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
  logRuntimeConfig('events.insert', value, calendarId);
  const token = await accessToken(fetchImpl, now);
  let response: Response;
  try {
    response = await fetchImpl(`${CALENDAR_API_ROOT}/${encodeURIComponent(calendarId)}/events?sendUpdates=none`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        id: normalized.eventId,
        summary: normalized.title,
        description: normalized.description,
        start: normalized.start,
        end: normalized.end,
        extendedProperties: {
          private: {
            masterThesisOsMailId: input.mailId.trim(),
            masterThesisOsCandidateId: input.candidateId.trim(),
          },
        },
      }),
      cache: 'no-store',
    });
  } catch {
    throw new CalendarIntegrationError('network_error', 'Google Calendar request could not be reached.');
  }

  const data = await responseJson(response);
  if (response.status === 409) {
    const details = providerErrorDetails(data);
    console.warn('[calendar] events.insert conflict; checking deterministic event', JSON.stringify({
      operation: 'events.insert',
      status: response.status,
      code: 'conflict',
      serviceAccountEmail: value.serviceAccountEmail,
      calendarId,
      scope: CALENDAR_SCOPE,
      providerReason: details.providerReason || null,
      providerMessage: details.providerMessage || null,
      providerBody: details.providerBody,
    }));
    const event = await fetchCalendarEventById(calendarId, normalized.eventId, token, fetchImpl);
    cache.clear();
    return { created: false, eventId: normalized.eventId, calendarId, event };
  }
  if (!response.ok) throw providerFailure('events.insert', response.status, data, value, calendarId);
  const event = normalizeCalendarEvent(data as GoogleEvent, calendarId);
  cache.clear();
  return { created: true, eventId: normalized.eventId, calendarId, event };
}

export async function getCalendarEvents(days = DEFAULT_DAYS, options: CalendarOptions = {}): Promise<CalendarEvent[]> {
  const fetchImpl = options.fetchImpl || fetch;
  const now = options.now || new Date();
  const value = config();
  const range = calendarRange(days, now);
  if (!value.calendarIds.length) {
    throw new CalendarIntegrationError('auth_error', 'Google Calendar service account is not configured.');
  }
  const cacheKey = `${value.calendarIds.join(',')}:${range.days}:${range.timeMin}`;
  const cached = cache.get(cacheKey);
  if (!options.bypassCache && cached && cached.expiresAt > now.getTime()) return cached.items;

  const token = await accessToken(fetchImpl, now);
  const events: CalendarEvent[] = [];
  const failures: CalendarIntegrationError[] = [];
  for (const [index, calendarId] of value.calendarIds.entries()) {
    try {
      events.push(...await fetchCalendarEvents(calendarId, token, range, fetchImpl));
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
  accessTokenCache = null;
}
