import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import {
  CALENDAR_SCOPE,
  CalendarIntegrationError,
  calendarConfigured,
  calendarRange,
  classifyCalendarEvent,
  clearCalendarCacheForTests,
  calendarEventIdForCandidate,
  createCalendarEvent,
  createServiceAccountAssertion,
  getCalendarEvents,
  normalizeCalendarEvent,
  normalizePrivateKey,
  parseCalendarIds,
} from './calendar';

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const envKeys = [
  'GOOGLE_SERVICE_ACCOUNT_EMAIL',
  'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY',
  'GOOGLE_CALENDAR_IDS',
  'GOOGLE_CALENDAR_ID',
] as const;
const original = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const baseNow = new Date('2026-09-08T01:00:00Z');

function configured(ids = 'primary') {
  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'service-account@example.iam.gserviceaccount.com';
  process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = privateKeyPem.replace(/\n/g, '\\n');
  process.env.GOOGLE_CALENDAR_IDS = ids;
  delete process.env.GOOGLE_CALENDAR_ID;
}

type CalendarResponse = { status?: number; body: unknown };
type MockFetch = typeof fetch & { calls: Array<{ url: string; init?: RequestInit }> };

function mockGoogle(
  responses: Record<string, CalendarResponse>,
  tokenResponses: CalendarResponse[] = [{ body: { access_token: 'token', expires_in: 3600 } }],
): MockFetch {
  let tokenIndex = 0;
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    fetcher.calls.push({ url, init });
    if (url === TOKEN_ENDPOINT) {
      const response = tokenResponses[Math.min(tokenIndex++, tokenResponses.length - 1)];
      return new Response(JSON.stringify(response.body), { status: response.status || 200 });
    }
    const calendarId = decodeURIComponent(url.split('/calendars/')[1].split('/events')[0]);
    const response = responses[calendarId] || { status: 404, body: { error: 'not found' } };
    return new Response(JSON.stringify(response.body), { status: response.status || 200 });
  }) as MockFetch;
  fetcher.calls = [];
  return fetcher;
}

beforeEach(() => {
  clearCalendarCacheForTests();
  configured();
});

afterEach(() => {
  clearCalendarCacheForTests();
  for (const key of envKeys) {
    original[key] === undefined ? delete process.env[key] : process.env[key] = original[key];
  }
  vi.restoreAllMocks();
});

describe('calendar configuration and JWT helpers', () => {
  it('parses, trims, ignores empty values, and deduplicates calendar IDs', () => {
    expect(parseCalendarIds(' primary, research , ,primary ')).toEqual(['primary', 'research']);
    expect(parseCalendarIds('   ', 'legacy@example.com')).toEqual(['legacy@example.com']);
    expect(parseCalendarIds(undefined)).toEqual([]);
  });

  it('uses the legacy single calendar ID as a temporary fallback', () => {
    delete process.env.GOOGLE_CALENDAR_IDS;
    process.env.GOOGLE_CALENDAR_ID = 'legacy@example.com';
    expect(calendarConfigured()).toBe(true);
  });

  it('detects missing service account configuration', () => {
    delete process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
    expect(calendarConfigured()).toBe(false);
    delete process.env.GOOGLE_CALENDAR_IDS;
    expect(parseCalendarIds(process.env.GOOGLE_CALENDAR_IDS, process.env.GOOGLE_CALENDAR_ID)).toEqual([]);
  });

  it('normalizes escaped private-key newlines', () => {
    expect(normalizePrivateKey('first\\nsecond')).toBe('first\nsecond');
  });

  it('creates an RS256 JWT with the Calendar read/write claims', () => {
    const assertion = createServiceAccountAssertion('service@example.com', privateKeyPem, baseNow);
    const [encodedHeader, encodedClaim, encodedSignature] = assertion.split('.');
    const decode = (value: string) => JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<string, unknown>;
    expect(decode(encodedHeader)).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(decode(encodedClaim)).toMatchObject({
      iss: 'service@example.com',
      scope: CALENDAR_SCOPE,
      aud: TOKEN_ENDPOINT,
      iat: Math.floor(baseNow.getTime() / 1000),
      exp: Math.floor(baseNow.getTime() / 1000) + 3600,
    });
    expect(encodedSignature).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe('calendar normalization and ranges', () => {
  it('normalizes an all-day event', () => {
    const item = normalizeCalendarEvent({ id: 'a', summary: '논문 마감', start: { date: '2026-09-10' }, end: { date: '2026-09-11' } }, 'primary');
    expect(item).toMatchObject({ allDay: true, start: '2026-09-10', end: '2026-09-11', category: 'Deadline', calendarId: 'primary' });
  });

  it('normalizes a timed event and classifies it', () => {
    const item = normalizeCalendarEvent({ id: 'b', summary: '지도교수 미팅', start: { dateTime: '2026-09-10T14:00:00+09:00' }, end: { dateTime: '2026-09-10T15:00:00+09:00' } }, 'research');
    expect(item).toMatchObject({ allDay: false, category: 'Meeting', start: '2026-09-10T14:00:00+09:00' });
    expect(classifyCalendarEvent('중간발표')).toBe('Presentation');
  });

  it('uses Seoul midnight and clamps the range', () => {
    expect(calendarRange(14, baseNow)).toEqual({ days: 14, timeMin: '2026-09-07T15:00:00.000Z', timeMax: '2026-09-21T15:00:00.000Z' });
    expect(calendarRange(999, baseNow).days).toBe(365);
  });
});

describe('service account Calendar requests', () => {
  it('rejects a date-only value for a timed candidate', async () => {
    await expect(createCalendarEvent({
      mailId: 'mail-date-only',
      candidateId: 'candidate-date-only',
      title: '날짜만 있는 후보',
      start: '2026-09-20',
      end: null,
      allDay: false,
    }, { fetchImpl: (async () => new Response()) as typeof fetch, now: baseNow })).rejects.toMatchObject({ code: 'invalid_request' });
  });

  it('inserts a reviewed all-day candidate with a deterministic event ID', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url === TOKEN_ENDPOINT) return new Response(JSON.stringify({ access_token: 'token', expires_in: 3600 }), { status: 200 });
      const payload = JSON.parse(String(init?.body)) as { id: string; summary: string; start: { date: string }; end: { date: string }; extendedProperties: { private: Record<string, string> } };
      return new Response(JSON.stringify({
        id: payload.id,
        summary: payload.summary,
        start: payload.start,
        end: payload.end,
        extendedProperties: payload.extendedProperties,
      }), { status: 200 });
    }) as typeof fetch;
    const result = await createCalendarEvent({
      mailId: 'mail-1',
      candidateId: 'mail-calendar:abcd1234',
      title: '발표',
      start: '2026-09-20',
      end: null,
      allDay: true,
      type: 'event',
      reason: '실제 참석 일정',
    }, { fetchImpl: fetcher, now: baseNow });
    expect(result.created).toBe(true);
    expect(result.eventId).toBe(calendarEventIdForCandidate('mail-1', 'mail-calendar:abcd1234'));
    const insert = calls.find((call) => call.init?.method === 'POST' && call.url.includes('/events?'));
    const payload = JSON.parse(String(insert?.init?.body)) as Record<string, unknown>;
    expect(payload.id).toBe(result.eventId);
    expect(payload.start).toEqual({ date: '2026-09-20' });
    expect(payload.end).toEqual({ date: '2026-09-21' });
    expect(payload.extendedProperties).toMatchObject({ private: { masterThesisOsMailId: 'mail-1', masterThesisOsCandidateId: 'mail-calendar:abcd1234' } });
  });

  it('treats a deterministic event ID conflict as an already-added event', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const event = { id: calendarEventIdForCandidate('mail-2', 'candidate-2'), summary: '면담', start: { dateTime: '2026-09-20T14:00:00+09:00' }, end: { dateTime: '2026-09-20T15:00:00+09:00' } };
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url === TOKEN_ENDPOINT) return new Response(JSON.stringify({ access_token: 'token', expires_in: 3600 }), { status: 200 });
      if (init?.method === 'POST') return new Response(JSON.stringify({ error: 'already exists' }), { status: 409 });
      return new Response(JSON.stringify(event), { status: 200 });
    }) as typeof fetch;
    const result = await createCalendarEvent({
      mailId: 'mail-2', candidateId: 'candidate-2', title: '면담', start: '2026-09-20T14:00', end: '2026-09-20T15:00', allDay: false, type: 'event',
    }, { fetchImpl: fetcher, now: baseNow });
    expect(result).toMatchObject({ created: false, eventId: event.id, event: { title: '면담' } });
    expect(calls.some((call) => call.url.includes(`/events/${event.id}`))).toBe(true);
  });

  it('sends a JWT bearer request and returns an empty calendar', async () => {
    const fetcher = mockGoogle({ primary: { body: { items: [] } } });
    expect(await getCalendarEvents(14, { fetchImpl: fetcher, now: baseNow, bypassCache: true })).toEqual([]);
    const tokenRequest = fetcher.calls.find((call) => call.url === TOKEN_ENDPOINT);
    expect(tokenRequest?.init?.method).toBe('POST');
    expect(String(tokenRequest?.init?.body)).toContain('grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer');
    expect(String(tokenRequest?.init?.body)).toContain('assertion=');
  });

  it('supports multiple calendars, recurring instances, deduplication, and global ordering', async () => {
    configured('research, primary, research');
    const fetcher = mockGoogle({
      research: {
        body: {
          items: [
            { id: 'same', summary: '연구 미팅', start: { dateTime: '2026-09-10T14:00:00+09:00' }, end: { dateTime: '2026-09-10T15:00:00+09:00' } },
            { id: 'same', summary: '연구 미팅', start: { dateTime: '2026-09-10T14:00:00+09:00' }, end: { dateTime: '2026-09-10T15:00:00+09:00' } },
            { id: 'rec_1', summary: '반복 연구 1', start: { dateTime: '2026-09-11T10:00:00+09:00' }, end: { dateTime: '2026-09-11T11:00:00+09:00' } },
            { id: 'rec_2', summary: '반복 연구 2', start: { dateTime: '2026-09-12T10:00:00+09:00' }, end: { dateTime: '2026-09-12T11:00:00+09:00' } },
          ],
        },
      },
      primary: { body: { items: [{ id: 'day', summary: '하루 일정', start: { date: '2026-09-09' }, end: { date: '2026-09-10' } }] } },
    });
    const events = await getCalendarEvents(14, { fetchImpl: fetcher, now: baseNow, bypassCache: true });
    expect(events.map((event) => `${event.calendarId}:${event.id}`)).toEqual(['primary:day', 'research:same', 'research:rec_1', 'research:rec_2']);
    expect(fetcher.calls.filter((call) => call.url === TOKEN_ENDPOINT)).toHaveLength(1);
  });

  it('keeps successful calendars when another calendar fails', async () => {
    configured('good,bad');
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fetcher = mockGoogle({
      good: { body: { items: [{ id: 'good', summary: '정상 일정', start: { dateTime: '2026-09-10T10:00:00+09:00' }, end: { dateTime: '2026-09-10T11:00:00+09:00' } }] } },
      bad: { status: 404, body: { error: { message: 'not found' } } },
    });
    await expect(getCalendarEvents(14, { fetchImpl: fetcher, now: baseNow, bypassCache: true })).resolves.toHaveLength(1);
  });

  it('returns an error when every configured calendar fails', async () => {
    configured('missing');
    const fetcher = mockGoogle({ missing: { status: 404, body: { error: 'not found' } } });
    await expect(getCalendarEvents(14, { fetchImpl: fetcher, now: baseNow, bypassCache: true })).rejects.toMatchObject({ code: 'invalid_calendar' });
  });

  it('refreshes a near-expiry token instead of reusing it', async () => {
    const fetcher = mockGoogle(
      { primary: { body: { items: [] } } },
      [{ body: { access_token: 'short-lived', expires_in: 30 } }, { body: { access_token: 'refreshed', expires_in: 3600 } }],
    );
    await getCalendarEvents(14, { fetchImpl: fetcher, now: baseNow, bypassCache: true });
    await getCalendarEvents(14, { fetchImpl: fetcher, now: new Date(baseNow.getTime() + 1_000), bypassCache: true });
    expect(fetcher.calls.filter((call) => call.url === TOKEN_ENDPOINT)).toHaveLength(2);
  });

  it('handles malformed, auth, quota, and network responses without exposing secrets', async () => {
    const malformed = mockGoogle({ primary: { body: { events: [] } } });
    await expect(getCalendarEvents(14, { fetchImpl: malformed, now: baseNow, bypassCache: true })).rejects.toMatchObject({ code: 'malformed_response' });
    const auth = mockGoogle({ primary: { status: 403, body: { error: 'permission denied' } } });
    await expect(getCalendarEvents(14, { fetchImpl: auth, now: baseNow, bypassCache: true })).rejects.toMatchObject({ code: 'auth_error' });
    const quota = mockGoogle({ primary: { status: 403, body: { error: { errors: [{ reason: 'quotaExceeded' }] } } } });
    await expect(getCalendarEvents(14, { fetchImpl: quota, now: baseNow, bypassCache: true })).rejects.toMatchObject({ code: 'quota_error' });
    clearCalendarCacheForTests();
    const offline = async () => { throw new Error('offline'); };
    await expect(getCalendarEvents(14, { fetchImpl: offline as typeof fetch, now: baseNow, bypassCache: true })).rejects.toEqual(new CalendarIntegrationError('network_error', 'Google service account token request could not be reached.'));
  });
});
