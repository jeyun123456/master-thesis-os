import '../app/inbox-workflow-test-safety';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearGoogleDriveTokenCacheForTests,
  getGoogleDriveFileContent,
  getGoogleDriveFiles,
  googleDriveConfigured,
  googleDriveContentReadable,
  normalizeGoogleDriveFile,
  searchGoogleDriveContent,
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


  it('exports Google Docs as plain text content', async () => {
    const calls: string[] = [];
    const fetcher = (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url === TOKEN_ENDPOINT) {
        return new Response(JSON.stringify({ access_token: 'drive-access', expires_in: 3600 }), { status: 200 });
      }
      if (url.includes('/drive/v3/files/doc-1?fields=')) {
        return new Response(JSON.stringify({
          id: 'doc-1',
          name: '논문 메모',
          mimeType: 'application/vnd.google-apps.document',
          modifiedTime: '2026-10-05T08:00:00.000Z',
          webViewLink: 'https://docs.google.com/document/d/doc-1/edit',
        }), { status: 200 });
      }
      if (url.includes('/drive/v3/files/doc-1/export?') && url.includes('mimeType=text%2Fplain')) {
        return new Response('첫 문단\n둘째 문단', { status: 200, headers: { 'Content-Type': 'text/plain' } });
      }
      throw new Error(`Unexpected Drive fake request: ${url}`);
    }) as typeof fetch;

    const result = await getGoogleDriveFileContent('doc-1', { fetchImpl: fetcher, now: new Date('2026-10-05T00:00:00Z') });
    expect(result).toMatchObject({
      format: 'text',
      content: '첫 문단\n둘째 문단',
      charCount: 10,
      truncated: false,
      file: { id: 'doc-1', kind: 'document' },
    });
    expect(calls.some((url) => url.includes('/export?'))).toBe(true);
    expect(googleDriveContentReadable(result.file)).toBe(true);
  });

  it('downloads plain text files with alt=media', async () => {
    const fetcher = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === TOKEN_ENDPOINT) {
        return new Response(JSON.stringify({ access_token: 'drive-access', expires_in: 3600 }), { status: 200 });
      }
      if (url.includes('/drive/v3/files/txt-1?fields=')) {
        return new Response(JSON.stringify({
          id: 'txt-1',
          name: 'notes.md',
          mimeType: 'text/markdown',
          modifiedTime: '2026-10-05T08:00:00.000Z',
        }), { status: 200 });
      }
      if (url.endsWith('/drive/v3/files/txt-1?alt=media')) {
        return new Response('# 제목\n내용', { status: 200, headers: { 'Content-Type': 'text/markdown' } });
      }
      throw new Error(`Unexpected Drive fake request: ${url}`);
    }) as typeof fetch;

    const result = await getGoogleDriveFileContent('txt-1', { fetchImpl: fetcher });
    expect(result).toMatchObject({ format: 'text', content: '# 제목\n내용' });
  });

  it('rejects PDFs for text extraction while keeping them listable', async () => {
    const fetcher = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === TOKEN_ENDPOINT) {
        return new Response(JSON.stringify({ access_token: 'drive-access', expires_in: 3600 }), { status: 200 });
      }
      if (url.includes('/drive/v3/files/pdf-1?fields=')) {
        return new Response(JSON.stringify({
          id: 'pdf-1',
          name: 'paper.pdf',
          mimeType: 'application/pdf',
          modifiedTime: '2026-10-05T08:00:00.000Z',
        }), { status: 200 });
      }
      throw new Error(`Unexpected Drive fake request: ${url}`);
    }) as typeof fetch;

    await expect(getGoogleDriveFileContent('pdf-1', { fetchImpl: fetcher })).rejects.toMatchObject({
      code: 'unsupported_content',
      httpStatus: 415,
    });
  });


  it('uses Drive fullText index and returns context snippets for readable research files', async () => {
    const calls: string[] = [];
    const fetcher = (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url === TOKEN_ENDPOINT) {
        return new Response(JSON.stringify({ access_token: 'drive-access', expires_in: 3600 }), { status: 200 });
      }

      const requestUrl = new URL(url);
      if (requestUrl.origin === 'https://www.googleapis.com' && requestUrl.pathname === '/drive/v3/files' && requestUrl.searchParams.has('q')) {
        const q = requestUrl.searchParams.get('q') || '';
        expect(q).toContain("fullText contains '전환'");
        expect(q).toContain("fullText contains '신해석'");
        expect(q).toContain("name contains '전환'");
        return new Response(JSON.stringify({
          files: [
            {
              id: 'doc-search',
              name: '전환 문제 메모',
              mimeType: 'application/vnd.google-apps.document',
              modifiedTime: '2026-10-05T08:00:00.000Z',
              webViewLink: 'https://docs.google.com/document/d/doc-search/edit',
            },
            {
              id: 'pdf-search',
              name: 'reference.pdf',
              mimeType: 'application/pdf',
              modifiedTime: '2026-10-04T08:00:00.000Z',
              webViewLink: 'https://drive.google.com/file/d/pdf-search/view',
            },
          ],
        }), { status: 200 });
      }

      if (requestUrl.pathname === '/drive/v3/files/doc-search/export') {
        return new Response('전환 문제에 대한 기존 해석\n신해석 학파의 화폐적 표현을 검토한다.', { status: 200 });
      }

      throw new Error(`Unexpected Drive fake request: ${url}`);
    }) as typeof fetch;

    const result = await searchGoogleDriveContent('전환 신해석', 10, {
      fetchImpl: fetcher,
      now: new Date('2026-10-05T00:00:00Z'),
    });

    expect(result).toMatchObject({
      query: '전환 신해석',
      terms: ['전환', '신해석'],
      candidates: 2,
      contentInspected: 1,
    });
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({
      file: { id: 'doc-search' },
      contentReadable: true,
      contentMatched: true,
      indexedMatch: true,
    });
    expect(result.items[0].matchedTerms).toEqual(expect.arrayContaining(['전환', '신해석']));
    expect(result.items[0].snippets.length).toBeGreaterThan(0);
    expect(result.items[1]).toMatchObject({
      file: { id: 'pdf-search', kind: 'pdf' },
      contentReadable: false,
      contentMatched: false,
      indexedMatch: true,
    });
    expect(calls.some((url) => url.includes('/drive/v3/files/doc-search/export?'))).toBe(true);
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
