import '../app/inbox-workflow-test-safety';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearGmailTokenCacheForTests,
  getGmailMessages,
  gmailConfigured,
  normalizeGmailMessage,
} from './gmail';

const envKeys = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN'] as const;
const original = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

function configured() {
  process.env.GOOGLE_CLIENT_ID = 'gmail-client';
  process.env.GOOGLE_CLIENT_SECRET = 'gmail-secret';
  process.env.GOOGLE_REFRESH_TOKEN = 'gmail-refresh';
}

beforeEach(() => {
  clearGmailTokenCacheForTests();
  configured();
});

afterEach(() => {
  clearGmailTokenCacheForTests();
  for (const key of envKeys) {
    original[key] === undefined ? delete process.env[key] : process.env[key] = original[key];
  }
  vi.restoreAllMocks();
});

describe('gmail configuration and normalization', () => {
  it('requires a complete Google OAuth configuration', () => {
    expect(gmailConfigured()).toBe(true);
    delete process.env.GOOGLE_REFRESH_TOKEN;
    expect(gmailConfigured()).toBe(false);
  });

  it('normalizes Gmail metadata into the shared mail shape', () => {
    expect(normalizeGmailMessage({
      id: 'msg-1',
      threadId: 'thread-1',
      labelIds: ['INBOX', 'UNREAD'],
      internalDate: '1791180000000',
      snippet: 'preview',
      payload: {
        headers: [
          { name: 'Subject', value: '논문 일정 확인' },
          { name: 'From', value: 'Advisor <advisor@example.com>' },
          { name: 'Message-ID', value: '<msg-1@example.com>' },
        ],
      },
    })).toMatchObject({
      id: 'msg-1',
      threadId: 'thread-1',
      subject: '논문 일정 확인',
      senderName: 'Advisor',
      senderAddress: 'advisor@example.com',
      isRead: false,
      messageId: '<msg-1@example.com>',
      snippet: 'preview',
      webUrl: 'https://mail.google.com/mail/u/0/#all/thread-1',
    });
  });
});

describe('gmail requests', () => {
  it('refreshes OAuth and reads profile plus inbox metadata', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url === TOKEN_ENDPOINT) {
        return new Response(JSON.stringify({ access_token: 'gmail-access', expires_in: 3600 }), { status: 200 });
      }
      if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/profile') {
        return new Response(JSON.stringify({ emailAddress: 'user@example.com' }), { status: 200 });
      }
      if (url.includes('/gmail/v1/users/me/messages?')) {
        return new Response(JSON.stringify({ messages: [{ id: 'm1', threadId: 't1' }] }), { status: 200 });
      }
      if (url.includes('/gmail/v1/users/me/messages/m1?')) {
        return new Response(JSON.stringify({
          id: 'm1',
          threadId: 't1',
          labelIds: ['INBOX'],
          internalDate: '1791180000000',
          snippet: 'hello',
          payload: { headers: [
            { name: 'Subject', value: 'Hello' },
            { name: 'From', value: 'Sender <sender@example.com>' },
          ] },
        }), { status: 200 });
      }
      throw new Error(`Unexpected Gmail fake request: ${url}`);
    }) as typeof fetch;

    const result = await getGmailMessages(20, { fetchImpl: fetcher, now: new Date('2026-10-05T00:00:00Z') });
    expect(result.account).toBe('user@example.com');
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ id: 'm1', subject: 'Hello', isRead: true });

    const tokenCall = calls.find((call) => call.url === TOKEN_ENDPOINT);
    const body = new URLSearchParams(String(tokenCall?.init?.body || ''));
    expect(body.get('client_id')).toBe('gmail-client');
    expect(body.get('client_secret')).toBe('gmail-secret');
    expect(body.get('refresh_token')).toBe('gmail-refresh');
    expect(body.get('grant_type')).toBe('refresh_token');

    const apiCalls = calls.filter((call) => call.url.startsWith('https://gmail.googleapis.com/'));
    expect(apiCalls.every((call) => (call.init?.headers as Record<string, string>)?.Authorization === 'Bearer gmail-access')).toBe(true);
  });

  it('maps Gmail permission failures without exposing provider bodies', async () => {
    const fetcher = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === TOKEN_ENDPOINT) {
        return new Response(JSON.stringify({ access_token: 'gmail-access', expires_in: 3600 }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: { message: 'forbidden detail' } }), { status: 403 });
    }) as typeof fetch;

    await expect(getGmailMessages(5, { fetchImpl: fetcher })).rejects.toMatchObject({
      code: 'insufficient_permissions',
      httpStatus: 403,
    });
  });
});
