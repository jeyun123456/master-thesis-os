import type { GoogleDriveFile, GoogleDriveFileContent } from './google-drive';

export type GoogleDriveClientState = 'ready' | 'empty' | 'unconfigured' | 'error';

export type GoogleDriveClientResponse = {
  configured: boolean;
  source: 'google-drive';
  state: GoogleDriveClientState;
  items: GoogleDriveFile[];
  errorCode?: string;
};

export class GoogleDriveClientError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'GoogleDriveClientError';
  }
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    throw new GoogleDriveClientError('malformed_response', 'Google Drive 응답 형식을 읽지 못했어.');
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new GoogleDriveClientError('malformed_response', 'Google Drive 응답 형식을 읽지 못했어.');
  }
  return raw as Record<string, unknown>;
}

export async function getRecentGoogleDriveFiles(fetchImpl: typeof fetch = fetch, limit = 30): Promise<GoogleDriveClientResponse> {
  let response: Response;
  try {
    response = await fetchImpl(`/api/google/drive/files?limit=${Math.max(1, Math.min(100, Math.floor(limit) || 30))}`, {
      cache: 'no-store',
    });
  } catch {
    throw new GoogleDriveClientError('network_error', 'Google Drive API에 연결하지 못했어.');
  }

  const value = await readJson(response);
  if (!response.ok || value.state === 'error') {
    throw new GoogleDriveClientError(typeof value.errorCode === 'string' ? value.errorCode : 'network_error', 'Google Drive를 읽지 못했어.');
  }

  const items = Array.isArray(value.items) ? value.items as GoogleDriveFile[] : [];
  return {
    configured: value.configured === true,
    source: 'google-drive',
    state: value.state === 'ready' || value.state === 'empty' || value.state === 'unconfigured' ? value.state : 'error',
    items,
  };
}

export async function getGoogleDriveContent(fileId: string, fetchImpl: typeof fetch = fetch): Promise<GoogleDriveFileContent> {
  let response: Response;
  try {
    response = await fetchImpl(`/api/google/drive/content?fileId=${encodeURIComponent(fileId)}`, {
      cache: 'no-store',
    });
  } catch {
    throw new GoogleDriveClientError('network_error', 'Google Drive 파일 내용을 읽지 못했어.');
  }

  const value = await readJson(response);
  if (!response.ok || value.state !== 'ready') {
    throw new GoogleDriveClientError(typeof value.errorCode === 'string' ? value.errorCode : 'network_error', 'Google Drive 파일 내용을 읽지 못했어.');
  }
  if (!value.file || typeof value.content !== 'string' || (value.format !== 'text' && value.format !== 'csv')) {
    throw new GoogleDriveClientError('malformed_response', 'Google Drive 내용 응답 형식을 읽지 못했어.');
  }

  return {
    file: value.file as GoogleDriveFile,
    format: value.format,
    content: value.content,
    charCount: typeof value.charCount === 'number' ? value.charCount : value.content.length,
    truncated: value.truncated === true,
  };
}
