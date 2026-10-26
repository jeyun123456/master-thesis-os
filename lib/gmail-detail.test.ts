import './network-test-safety';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearGmailTokenCacheForTests, getGmailMessageDetail, normalizeGmailDetail } from './gmail';

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const envKeys = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN'] as const;
const original = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

beforeEach(() => {
  clearGmailTokenCacheForTests();
  process.env.GOOGLE_CLIENT_ID = 'c'; process.env.GOOGLE_CLIENT_SECRET = 's'; process.env.GOOGLE_REFRESH_TOKEN = 'r';
});
afterEach(() => {
  clearGmailTokenCacheForTests();
  for (const key of envKeys) { if (original[key] === undefined) delete process.env[key]; else process.env[key] = original[key]; }
});

const b64 = (value: string) => Buffer.from(value, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const raw = {
  id: 'msg-abcdef', threadId: 'thread-abcdef', internalDate: '1793000000000', labelIds: ['INBOX', 'UNREAD'], snippet: 'preview',
  payload: {
    mimeType: 'multipart/mixed',
    headers: [{ name: 'Subject', value: 'Hi' }, { name: 'From', value: 'Kim <kim@example.com>' }, { name: 'To', value: 'me@example.com' }, { name: 'Cc', value: 'c@example.com' }],
    parts: [
      { mimeType: 'multipart/alternative', parts: [
        { mimeType: 'text/plain', filename: '', body: { data: b64('안녕 plain') } },
        { mimeType: 'text/html', filename: '', body: { data: b64('<p>안녕 <b>html</b></p>') } },
      ] },
      { mimeType: 'application/pdf', filename: 'doc.pdf', body: { size: 2048, attachmentId: 'att-1' } },
    ],
  },
};

describe('gmail detail', () => {
  it('extracts text, html and attachment metadata from nested parts', () => {
    const detail = normalizeGmailDetail(raw, 'me@example.com');
    expect(detail.bodyText).toBe('안녕 plain');
    expect(detail.bodyHtml).toBe('<p>안녕 <b>html</b></p>');
    expect(detail.to).toBe('me@example.com');
    expect(detail.cc).toBe('c@example.com');
    expect(detail.attachments).toEqual([{ filename: 'doc.pdf', mimeType: 'application/pdf', size: 2048 }]);
    expect(detail.isRead).toBe(false);
    expect(detail.webUrl).toBe('https://mail.google.com/mail/?authuser=me%40example.com#all/thread-abcdef');
  });

  it('fetches with GET only and never asks Gmail to change labels (mail stays unread)', async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? 'GET' });
      if (url === TOKEN_ENDPOINT) return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }), { status: 200 });
      if (url.endsWith('/profile')) return new Response(JSON.stringify({ emailAddress: 'me@example.com' }), { status: 200 });
      return new Response(JSON.stringify(raw), { status: 200 });
    }) as typeof fetch;
    const result = await getGmailMessageDetail('msg-abcdef', { fetchImpl: fetcher });
    expect(result.account).toBe('me@example.com');
    expect(calls.filter((c) => c.url.includes('/messages/')).map((c) => c.url)).toEqual(['https://gmail.googleapis.com/gmail/v1/users/me/messages/msg-abcdef?format=full']);
    expect(calls.every((c) => c.url === TOKEN_ENDPOINT || c.method === 'GET')).toBe(true);
    expect(calls.some((c) => /modify|markAsRead|trash|send/i.test(c.url))).toBe(false);
  });

  it('rejects ids that are not plain Gmail ids without calling Google', async () => {
    const fetcher = (async () => { throw new Error('must not be called'); }) as unknown as typeof fetch;
    await expect(getGmailMessageDetail('../profile', { fetchImpl: fetcher })).rejects.toMatchObject({ code: 'provider_bad_request' });
  });
});
