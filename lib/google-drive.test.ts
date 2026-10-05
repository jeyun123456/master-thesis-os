import '../app/inbox-workflow-test-safety';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearGoogleDriveTokenCacheForTests,
  getGoogleDriveFiles,
  googleDriveConfigured,
  normalizeGoogleDriveFile,
} from './google-drive';

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const envKeys = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN'] as const;
const original = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

function configured() {
  process.env.GOOGLE_CLIENT_ID = 'drive-client';
  process.env.GOOGLE_CLIENT_SECRET = 'drive-secret';
  process.env.GOOGLE_REFRESH_TOKEN = 'drive-refresh';
}

beforeEach(() => {
  clearGoogleDriveTokenCacheForTests();
  configured();
});

afterEach(() => {
  clearGoogleDriveTokenCacheForTests();
  for (const key of envKeys) {
    original[key] === undefined ? delete process.env[key] : process.env[key] = original[key];
  }
  vi.restoreAllMocks();
});

describe('Google Drive configuration and normalization', () => {
  it('requires complete Google OAuth credentials', () => {
    expect(googleDriveConfigured()).toBe(true);
    delete process.env.GOOGLE_CLIENT_SECRET;
    expect(googleDriveConfigured()).toBe(false);
  });

  it('normalizes Google-native files and binary files', () => {
    expect(normalizeGoogleDriveFile({
      id: 'doc-1',
      name: '논문 메모',
      mimeType: 'application/vnd.google-apps.document',
      modifiedTime: '2026-10-05T08:00:00.000Z',
      webViewLink: 'https://docs.google.com/document/d/doc-1/edit',
    })).toMatchObject({
      id: 'doc-1',
      name: '논문 메모',
      kind: 'document',
      isFolder: false,
      size: null,
    });

    expect(normalizeGoogleDriveFile({
      id: 'pdf-1',
      name: 'paper.pdf',
      mimeType: 'application/pdf',
      modifiedTime: '2026-10-04T08:00:00.000Z',
      size: '2048',
    })).toMatchObject({
      kind: 'pdf',
      size: 2048,
      webViewLink: 'https://drive.google.com/open?id=pdf-1',
    });
  });
});

describe('Google Drive requests', () => {
  it('refreshes OAuth and lists recent Drive files', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url === TOKEN_ENDPOINT) {
        return new Response(JSON.stringify({ access_token: 'drive-access', expires_in: 3600 }), { status: 200 });
      }
      const requestUrl = new URL(url);
      if (requestUrl.origin === 'https://www.googleapis.com' && requestUrl.pathname === '/drive/v3/files') {
        expect(requestUrl.searchParams.get('pageSize')).toBe('30');
        expect(requestUrl.searchParams.get('orderBy')).toBe('modifiedTime desc');
        expect(requestUrl.searchParams.get('q')).toBe('trashed = false');
        expect(requestUrl.searchParams.get('spaces')).toBe('drive');
        return new Response(JSON.stringify({
          files: [
            {
              id: 'sheet-1',
              name: '분석표',
              mimeType: 'application/vnd.google-apps.spreadsheet',
              modifiedTime: '2026-10-05T08:00:00.000Z',
              webViewLink: 'https://docs.google.com/spreadsheets/d/sheet-1/edit',
            },
          ],
        }), { status: 200 });
      }
      throw new Error(`Unexpected Drive fake request: ${url}`);
    }) as typeof fetch;

    const result = await getGoogleDriveFiles(30, { fetchImpl: fetcher, now: new Date('2026-10-05T00:00:00Z') });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: 'sheet-1', kind: 'spreadsheet' });

    const tokenCall = calls.find((call) => call.url === TOKEN_ENDPOINT);
    const body = new URLSearchParams(String(tokenCall?.init?.body || ''));
    expect(body.get('client_id')).toBe('drive-client');
    expect(body.get('client_secret')).toBe('drive-secret');
    expect(body.get('refresh_token')).toBe('drive-refresh');
    expect(body.get('grant_type')).toBe('refresh_token');

    const driveCall = calls.find((call) => call.url.includes('/drive/v3/files?'));
    expect((driveCall?.init?.headers as Record<string, string>)?.Authorization).toBe('Bearer drive-access');
  });

  it('maps Drive permission failures', async () => {
    const fetcher = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === TOKEN_ENDPOINT) {
        return new Response(JSON.stringify({ access_token: 'drive-access', expires_in: 3600 }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: { message: 'forbidden detail' } }), { status: 403 });
    }) as typeof fetch;

    await expect(getGoogleDriveFiles(5, { fetchImpl: fetcher })).rejects.toMatchObject({
      code: 'insufficient_permissions',
      httpStatus: 403,
    });
  });
});
