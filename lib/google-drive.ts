import { createHash } from 'node:crypto';

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const DRIVE_API_ROOT = 'https://www.googleapis.com/drive/v3';

export type GoogleDriveErrorCode =
  | 'config_missing'
  | 'auth_error'
  | 'insufficient_permissions'
  | 'provider_bad_request'
  | 'quota_error'
  | 'network_error'
  | 'malformed_response'
  | 'unsupported_content';

export class GoogleDriveIntegrationError extends Error {
  constructor(
    public readonly code: GoogleDriveErrorCode,
    message: string,
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = 'GoogleDriveIntegrationError';
  }
}

export type GoogleDriveFile = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  webViewLink: string;
  size: number | null;
  isFolder: boolean;
  kind: 'folder' | 'document' | 'spreadsheet' | 'presentation' | 'pdf' | 'file';
};

export type GoogleDriveFileContent = {
  file: GoogleDriveFile;
  format: 'text' | 'csv';
  content: string;
  charCount: number;
  truncated: boolean;
};

const MAX_CONTENT_CHARS = 200_000;

type DriveOptions = {
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

function stringValue(value: unknown): string {
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

export function googleDriveConfigured(): boolean {
  return oauthConfig() !== null;
}

function providerErrorCode(status: number): GoogleDriveErrorCode {
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
  if (!config) throw new GoogleDriveIntegrationError('config_missing', 'Google OAuth configuration is missing.');

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
    throw new GoogleDriveIntegrationError('network_error', 'Google OAuth token request could not be reached.');
  }

  const data = await responseJson(response);
  if (!response.ok) {
    throw new GoogleDriveIntegrationError(providerErrorCode(response.status), 'Google OAuth token request failed.', response.status);
  }
  if (!isRecord(data) || !stringValue(data.access_token)) {
    throw new GoogleDriveIntegrationError('malformed_response', 'Google OAuth token response was malformed.', response.status);
  }

  const expiresIn = typeof data.expires_in === 'number' && Number.isFinite(data.expires_in) ? data.expires_in : 3600;
  const token = stringValue(data.access_token);
  tokenCache = {
    token,
    key,
    expiresAt: nowMs + Math.max(60, expiresIn) * 1000,
  };
  return token;
}

function kindForMimeType(mimeType: string): GoogleDriveFile['kind'] {
  if (mimeType === 'application/vnd.google-apps.folder') return 'folder';
  if (mimeType === 'application/vnd.google-apps.document') return 'document';
  if (mimeType === 'application/vnd.google-apps.spreadsheet') return 'spreadsheet';
  if (mimeType === 'application/vnd.google-apps.presentation') return 'presentation';
  if (mimeType === 'application/pdf') return 'pdf';
  return 'file';
}

export function normalizeGoogleDriveFile(raw: unknown): GoogleDriveFile {
  if (!isRecord(raw)) throw new GoogleDriveIntegrationError('malformed_response', 'Google Drive file was malformed.');
  const id = stringValue(raw.id);
  const name = stringValue(raw.name);
  const mimeType = stringValue(raw.mimeType);
  const modifiedTime = stringValue(raw.modifiedTime);
  const webViewLink = stringValue(raw.webViewLink) || (id ? `https://drive.google.com/open?id=${encodeURIComponent(id)}` : '');
  if (!id || !name || !mimeType) {
    throw new GoogleDriveIntegrationError('malformed_response', 'Google Drive file metadata was incomplete.');
  }
  const numericSize = typeof raw.size === 'string' ? Number(raw.size) : typeof raw.size === 'number' ? raw.size : Number.NaN;
  return {
    id,
    name,
    mimeType,
    modifiedTime,
    webViewLink,
    size: Number.isFinite(numericSize) && numericSize >= 0 ? numericSize : null,
    isFolder: mimeType === 'application/vnd.google-apps.folder',
    kind: kindForMimeType(mimeType),
  };
}

async function driveFetch(path: string, token: string, fetchImpl: typeof fetch): Promise<Response> {
  let response: Response;
  try {
    response = await fetchImpl(`${DRIVE_API_ROOT}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
  } catch {
    throw new GoogleDriveIntegrationError('network_error', 'Google Drive API request could not be reached.');
  }
  if (!response.ok) {
    console.warn('[drive] Google API failure', JSON.stringify({
      status: response.status,
      code: providerErrorCode(response.status),
      path: path.split('?')[0],
    }));
    throw new GoogleDriveIntegrationError(providerErrorCode(response.status), 'Google Drive API request failed.', response.status);
  }
  return response;
}

async function driveRequest(path: string, token: string, fetchImpl: typeof fetch): Promise<unknown> {
  return responseJson(await driveFetch(path, token, fetchImpl));
}

async function driveTextRequest(path: string, token: string, fetchImpl: typeof fetch): Promise<string> {
  const response = await driveFetch(path, token, fetchImpl);
  try {
    return await response.text();
  } catch {
    throw new GoogleDriveIntegrationError('malformed_response', 'Google Drive text response was malformed.', response.status);
  }
}

function readableTextMimeType(mimeType: string): boolean {
  return mimeType.startsWith('text/')
    || mimeType === 'application/json'
    || mimeType === 'application/xml'
    || mimeType === 'application/javascript'
    || mimeType === 'application/x-javascript';
}

function contentExport(file: GoogleDriveFile): { path: string; format: 'text' | 'csv' } | null {
  const id = encodeURIComponent(file.id);
  if (file.kind === 'document' || file.kind === 'presentation') {
    return { path: `/files/${id}/export?mimeType=${encodeURIComponent('text/plain')}`, format: 'text' };
  }
  if (file.kind === 'spreadsheet') {
    return { path: `/files/${id}/export?mimeType=${encodeURIComponent('text/csv')}`, format: 'csv' };
  }
  if (readableTextMimeType(file.mimeType)) {
    return { path: `/files/${id}?alt=media`, format: file.mimeType === 'text/csv' ? 'csv' : 'text' };
  }
  return null;
}

export function googleDriveContentReadable(file: GoogleDriveFile): boolean {
  return contentExport(file) !== null;
}

export async function getGoogleDriveFileContent(fileId: string, options: DriveOptions = {}): Promise<GoogleDriveFileContent> {
  const normalizedId = fileId.trim();
  if (!normalizedId || normalizedId.length > 256 || normalizedId.includes('/')) {
    throw new GoogleDriveIntegrationError('provider_bad_request', 'Google Drive file id was invalid.', 400);
  }

  const fetchImpl = options.fetchImpl || fetch;
  const token = await accessToken(fetchImpl, options.now || new Date());
  const id = encodeURIComponent(normalizedId);
  const metadataRaw = await driveRequest(
    `/files/${id}?fields=id,name,mimeType,modifiedTime,webViewLink,size`,
    token,
    fetchImpl,
  );
  const file = normalizeGoogleDriveFile(metadataRaw);
  const selected = contentExport(file);
  if (!selected) {
    throw new GoogleDriveIntegrationError('unsupported_content', 'This Drive file does not have a text-readable export.', 415);
  }

  const raw = await driveTextRequest(selected.path, token, fetchImpl);
  const charCount = raw.length;
  const truncated = charCount > MAX_CONTENT_CHARS;
  return {
    file,
    format: selected.format,
    content: truncated ? raw.slice(0, MAX_CONTENT_CHARS) : raw,
    charCount,
    truncated,
  };
}

export async function getGoogleDriveFiles(limit = 30, options: DriveOptions = {}): Promise<GoogleDriveFile[]> {
  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit) || 30));
  const fetchImpl = options.fetchImpl || fetch;
  const token = await accessToken(fetchImpl, options.now || new Date());

  const params = new URLSearchParams({
    pageSize: String(safeLimit),
    orderBy: 'modifiedTime desc',
    q: 'trashed = false',
    fields: 'files(id,name,mimeType,modifiedTime,webViewLink,size)',
    spaces: 'drive',
  });

  const raw = await driveRequest(`/files?${params.toString()}`, token, fetchImpl);
  if (!isRecord(raw) || !Array.isArray(raw.files)) {
    throw new GoogleDriveIntegrationError('malformed_response', 'Google Drive files response was malformed.');
  }
  return raw.files.map(normalizeGoogleDriveFile);
}

export function clearGoogleDriveTokenCacheForTests(): void {
  tokenCache = null;
}
