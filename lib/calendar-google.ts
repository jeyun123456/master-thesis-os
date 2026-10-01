import { createSign } from 'node:crypto';

export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const CALENDAR_API_ROOT = 'https://www.googleapis.com/calendar/v3/calendars';
const TOKEN_CACHE_SKEW_MS = 60 * 1000;

export type CalendarErrorCode = 'auth_error' | 'insufficient_permissions' | 'provider_bad_request' | 'quota_error' | 'network_error' | 'malformed_response' | 'invalid_calendar' | 'conflict' | 'invalid_request';

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

type CalendarConfig = { serviceAccountEmail: string; privateKey: string; calendarIds: string[] };
type FetchLike = typeof fetch;
type AccessTokenEntry = { token: string; expiresAt: number };
type ProviderErrorDetails = { providerReason?: string; providerMessage?: string; providerBody: string };
type GoogleCalendarRequest = {
  path: string;
  operation: string;
  calendarId?: string;
  method?: 'POST';
  query?: URLSearchParams;
  body?: unknown;
  acceptConflict?: boolean;
};

let accessTokenCache: AccessTokenEntry | null = null;

export function normalizePrivateKey(value: string): string {
  return value.replace(/\\n/g, '\n');
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

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

async function responseJson(response: Response): Promise<unknown> {
  try {
    return await response.json() as unknown;
  } catch {
    throw new CalendarIntegrationError('malformed_response', 'Google returned malformed JSON.');
  }
}

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

function calendarErrorCode(status: number, body: unknown): CalendarErrorCode {
  if (status === 404) return 'invalid_calendar';
  if (status === 409) return 'conflict';
  if (status === 429) return 'quota_error';
  const serialized = JSON.stringify(body);
  if (status === 403 && /quotaExceeded|rateLimitExceeded|userRateLimitExceeded/.test(serialized)) return 'quota_error';
  if (status === 403 && /insufficientPermissions|insufficient permissions/i.test(serialized)) return 'insufficient_permissions';
  if (status === 400) return 'provider_bad_request';
  if (status === 400 || status === 401 || status === 403) return 'auth_error';
  return 'network_error';
}

function tokenErrorCode(status: number): CalendarErrorCode {
  if (status === 429) return 'quota_error';
  if (status === 400 || status === 401 || status === 403) return 'auth_error';
  return 'network_error';
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

async function accessToken(value: CalendarConfig, fetchImpl: FetchLike, now: Date): Promise<string> {
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

export async function createGoogleCalendarSession(
  value: CalendarConfig,
  options: {
    fetchImpl?: FetchLike;
    now?: Date;
    logOperation?: { operation: string; calendarId?: string };
  } = {},
) {
  const fetchImpl = options.fetchImpl || fetch;
  const now = options.now || new Date();
  if (options.logOperation) {
    logRuntimeConfig(options.logOperation.operation, value, options.logOperation.calendarId);
  }
  const token = await accessToken(value, fetchImpl, now);

  return async function requestGoogleCalendar(request: GoogleCalendarRequest): Promise<{ status: number; data: unknown }> {
    const url = `${CALENDAR_API_ROOT}${request.path}${request.query ? `?${request.query}` : ''}`;
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    const init: RequestInit = { headers, cache: 'no-store' };
    if (request.method) {
      init.method = request.method;
      if (request.body !== undefined) {
        headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(request.body);
      }
    }

    let response: Response;
    try {
      response = await fetchImpl(url, init);
    } catch {
      throw new CalendarIntegrationError('network_error', 'Google Calendar request could not be reached.');
    }

    const data = await responseJson(response);
    if (!response.ok) {
      if (request.acceptConflict && response.status === 409) {
        const details = providerErrorDetails(data);
        console.warn('[calendar] events.insert conflict; checking deterministic event', JSON.stringify({
          operation: 'events.insert',
          status: response.status,
          code: 'conflict',
          serviceAccountEmail: value.serviceAccountEmail,
          calendarId: request.calendarId,
          scope: CALENDAR_SCOPE,
          providerReason: details.providerReason || null,
          providerMessage: details.providerMessage || null,
          providerBody: details.providerBody,
        }));
      } else {
        throw providerFailure(request.operation, response.status, data, value, request.calendarId);
      }
    }
    return { status: response.status, data };
  };
}

export function clearGoogleTokenCacheForTests(): void {
  accessTokenCache = null;
}
