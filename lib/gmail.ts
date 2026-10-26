import { createHash } from 'node:crypto';
import { gmailThreadUrl } from './safe-url';

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GMAIL_API_ROOT = 'https://gmail.googleapis.com/gmail/v1';

export type GmailErrorCode =
  | 'config_missing'
  | 'auth_error'
  | 'insufficient_permissions'
  | 'provider_bad_request'
  | 'quota_error'
  | 'network_error'
  | 'malformed_response';

export class GmailIntegrationError extends Error {
  constructor(
    public readonly code: GmailErrorCode,
    message: string,
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = 'GmailIntegrationError';
  }
}

export type GmailMessage = {
  id: string;
  threadId: string;
  subject: string;
  senderName: string;
  senderAddress: string;
  receivedAt: string;
  isRead: boolean;
  messageId?: string;
  snippet: string;
  webUrl: string;
};

type GmailOptions = {
  fetchImpl?: typeof fetch;
  now?: Date;
};

type OAuthConfig = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
};

type AccessTokenCache = {
  token: string;
  expiresAt: number;
  key: string;
};

let tokenCache: AccessTokenCache | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function oauthConfig(): OAuthConfig | null {
  const clientId = (process.env.GOOGLE_CLIENT_ID || '').trim();
  const clientSecret = (process.env.GOOGLE_CLIENT_SECRET || '').trim();
  const refreshToken = (process.env.GOOGLE_REFRESH_TOKEN || '').trim();
  if (!clientId || !clientSecret || !refreshToken) return null;
  return { clientId, clientSecret, refreshToken };
}

function credentialKey(config: OAuthConfig): string {
  return createHash('sha256')
    .update(config.clientId)
    .update('\0')
    .update(config.clientSecret)
    .update('\0')
    .update(config.refreshToken)
    .digest('hex');
}

export function gmailConfigured(): boolean {
  return oauthConfig() !== null;
}

function providerErrorCode(status: number): GmailErrorCode {
  if (status === 401) return 'auth_error';
  if (status === 403) return 'insufficient_permissions';
  if (status === 429) return 'quota_error';
  if (status === 400) return 'provider_bad_request';
  return status >= 500 ? 'network_error' : 'provider_bad_request';
}

async function responseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function accessToken(fetchImpl: typeof fetch, now: Date): Promise<string> {
  const config = oauthConfig();
  if (!config) throw new GmailIntegrationError('config_missing', 'Google OAuth configuration is missing.');

  const key = credentialKey(config);
  const nowMs = now.getTime();
  if (tokenCache && tokenCache.key === key && tokenCache.expiresAt > nowMs + 30_000) {
    return tokenCache.token;
  }

  let response: Response;
  try {
    response = await fetchImpl(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        refresh_token: config.refreshToken,
        grant_type: 'refresh_token',
      }).toString(),
      cache: 'no-store',
    });
  } catch {
    throw new GmailIntegrationError('network_error', 'Google OAuth token request could not be reached.');
  }

  const data = await responseJson(response);
  if (!response.ok) {
    throw new GmailIntegrationError(providerErrorCode(response.status), 'Google OAuth token request failed.', response.status);
  }
  if (!isRecord(data) || !text(data.access_token)) {
    throw new GmailIntegrationError('malformed_response', 'Google OAuth token response was malformed.', response.status);
  }

  const expiresIn = typeof data.expires_in === 'number' && Number.isFinite(data.expires_in) ? data.expires_in : 3600;
  const token = text(data.access_token);
  tokenCache = {
    token,
    key,
    expiresAt: nowMs + Math.max(60, expiresIn) * 1000,
  };
  return token;
}

async function gmailRequest(path: string, token: string, fetchImpl: typeof fetch): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(`${GMAIL_API_ROOT}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
  } catch {
    throw new GmailIntegrationError('network_error', 'Gmail API request could not be reached.');
  }
  const data = await responseJson(response);
  if (!response.ok) {
    console.warn('[gmail] Google API failure', JSON.stringify({
      status: response.status,
      code: providerErrorCode(response.status),
      path: path.split('?')[0],
    }));
    throw new GmailIntegrationError(providerErrorCode(response.status), 'Gmail API request failed.', response.status);
  }
  return data;
}

function headerValue(headers: unknown, name: string): string {
  if (!Array.isArray(headers)) return '';
  const lowerName = name.toLowerCase();
  for (const header of headers) {
    if (!isRecord(header)) continue;
    if (text(header.name).toLowerCase() === lowerName) return text(header.value);
  }
  return '';
}

function parseSender(value: string): { name: string; address: string } {
  const trimmed = value.trim();
  const match = trimmed.match(/^(.*?)\s*<([^>]+)>\s*$/);
  if (!match) {
    const addressOnly = trimmed.includes('@') ? trimmed : '';
    return { name: addressOnly ? '' : trimmed, address: addressOnly };
  }
  return {
    name: match[1].trim().replace(/^["']|["']$/g, ''),
    address: match[2].trim(),
  };
}

export function normalizeGmailMessage(raw: unknown, account = ''): GmailMessage {
  if (!isRecord(raw)) throw new GmailIntegrationError('malformed_response', 'Gmail message was malformed.');
  const id = text(raw.id);
  const threadId = text(raw.threadId) || id;
  const payload = isRecord(raw.payload) ? raw.payload : {};
  const headers = payload.headers;
  if (!id) throw new GmailIntegrationError('malformed_response', 'Gmail message id was missing.');

  const subject = headerValue(headers, 'Subject') || '(제목 없음)';
  const from = parseSender(headerValue(headers, 'From'));
  const messageId = headerValue(headers, 'Message-ID');
  const internalDate = Number(text(raw.internalDate));
  const dateHeader = headerValue(headers, 'Date');
  const receivedAt = Number.isFinite(internalDate) && internalDate > 0
    ? new Date(internalDate).toISOString()
    : new Date(dateHeader).toISOString();
  const labelIds = Array.isArray(raw.labelIds) ? raw.labelIds.filter((value): value is string => typeof value === 'string') : [];

  return {
    id,
    threadId,
    subject,
    senderName: from.name,
    senderAddress: from.address,
    receivedAt,
    isRead: !labelIds.includes('UNREAD'),
    ...(messageId ? { messageId } : {}),
    snippet: text(raw.snippet),
    webUrl: gmailThreadUrl(threadId, account) ?? 'https://mail.google.com/mail/u/0/',
  };
}

export async function getGmailMessages(limit = 20, options: GmailOptions = {}): Promise<{ account: string; items: GmailMessage[] }> {
  const safeLimit = Math.max(1, Math.min(50, Math.floor(limit) || 20));
  const fetchImpl = options.fetchImpl || fetch;
  const now = options.now || new Date();
  const token = await accessToken(fetchImpl, now);

  const [profileRaw, listRaw] = await Promise.all([
    gmailRequest('/users/me/profile', token, fetchImpl),
    gmailRequest(`/users/me/messages?maxResults=${safeLimit}&labelIds=INBOX`, token, fetchImpl),
  ]);
  if (!isRecord(profileRaw) || !isRecord(listRaw)) {
    throw new GmailIntegrationError('malformed_response', 'Gmail response was malformed.');
  }

  const account = text(profileRaw.emailAddress);
  const refs = Array.isArray(listRaw.messages)
    ? listRaw.messages.filter((value): value is Record<string, unknown> => isRecord(value) && Boolean(text(value.id)))
    : [];

  const items = await Promise.all(refs.map(async (value) => {
    const id = text(value.id);
    const raw = await gmailRequest(
      `/users/me/messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date&metadataHeaders=Message-ID`,
      token,
      fetchImpl,
    );
    return normalizeGmailMessage(raw, account);
  }));

  return { account, items };
}

export type GmailAttachmentInfo = { filename: string; mimeType: string; size: number | null };
export type GmailMessageDetail = GmailMessage & { to: string; cc: string; bodyText: string; bodyHtml: string | null; attachments: GmailAttachmentInfo[] };

const MAX_BODY_CHARS = 300_000;

function decodePartData(data: string): string {
  try { return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'); } catch { return ''; }
}

function collectParts(part: unknown, out: { text: string[]; html: string[]; attachments: GmailAttachmentInfo[] }, depth = 0): void {
  if (!isRecord(part) || depth > 12) return;
  const mime = text(part.mimeType).toLowerCase();
  const filename = text(part.filename);
  const body = isRecord(part.body) ? part.body : {};
  if (filename) {
    out.attachments.push({ filename, mimeType: mime, size: typeof body.size === 'number' ? body.size : null });
  } else if (mime === 'text/plain' && text(body.data)) {
    out.text.push(decodePartData(text(body.data)));
  } else if (mime === 'text/html' && text(body.data)) {
    out.html.push(decodePartData(text(body.data)));
  }
  if (Array.isArray(part.parts)) for (const child of part.parts) collectParts(child, out, depth + 1);
}

/** Read-only full message fetch (format=full never changes labels, so the mail stays unread in Gmail). */
export function normalizeGmailDetail(raw: unknown, account = ''): GmailMessageDetail {
  const base = normalizeGmailMessage(raw, account);
  const payload = isRecord(raw) && isRecord(raw.payload) ? raw.payload : {};
  const parts = { text: [] as string[], html: [] as string[], attachments: [] as GmailAttachmentInfo[] };
  collectParts(payload, parts);
  return {
    ...base,
    to: headerValue(payload.headers, 'To'),
    cc: headerValue(payload.headers, 'Cc'),
    bodyText: parts.text.join('\n\n').slice(0, MAX_BODY_CHARS),
    bodyHtml: parts.html.length ? parts.html.join('\n').slice(0, MAX_BODY_CHARS) : null,
    attachments: parts.attachments,
  };
}

export async function getGmailMessageDetail(id: string, options: GmailOptions = {}): Promise<{ account: string; message: GmailMessageDetail }> {
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(id)) throw new GmailIntegrationError('provider_bad_request', 'Invalid Gmail message id.');
  const fetchImpl = options.fetchImpl || fetch;
  const token = await accessToken(fetchImpl, options.now || new Date());
  const [profileRaw, raw] = await Promise.all([
    gmailRequest('/users/me/profile', token, fetchImpl),
    gmailRequest(`/users/me/messages/${encodeURIComponent(id)}?format=full`, token, fetchImpl),
  ]);
  const account = isRecord(profileRaw) ? text(profileRaw.emailAddress) : '';
  return { account, message: normalizeGmailDetail(raw, account) };
}

export function clearGmailTokenCacheForTests(): void {
  tokenCache = null;
}
