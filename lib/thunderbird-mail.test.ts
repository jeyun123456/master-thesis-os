import { describe, expect, it } from 'vitest';
import {
  getRecentThunderbirdMail,
  normalizeThunderbirdMail,
  normalizeThunderbirdMailResponse,
  openThunderbird,
  ThunderbirdMailError,
} from './thunderbird-mail';

const newest = {
  id: 'newest',
  subject: '中間発表について',
  senderName: '松尾先生',
  senderAddress: 'matsuo@example.ac.jp',
  receivedAt: '2026-09-15T01:10:00Z',
  isRead: false,
  messageId: '<newest@example.ac.jp>',
};

describe('Thunderbird mail normalization', () => {
  it('normalizes blank subjects and missing senders safely', () => {
    expect(normalizeThunderbirdMail({
      id: 'missing-sender',
      subject: '   ',
      receivedAt: '2026-09-14T01:10:00Z',
      isRead: true,
    })).toMatchObject({
      subject: '(제목 없음)',
      senderName: '(발신자 알 수 없음)',
      senderAddress: '',
      isRead: true,
    });
  });

  it('rejects invalid response and message shapes', () => {
    expect(() => normalizeThunderbirdMailResponse({ ok: true, source: 'thunderbird', items: null })).toThrow('Local Bridge 메일 응답 형식을 확인할 수 없어.');
    expect(() => normalizeThunderbirdMail({ id: 'missing-date' })).toThrow('Local Bridge 메일 응답 형식을 확인할 수 없어.');
  });

  it('sorts and limits normalized metadata to twenty items', () => {
    const rawItems = Array.from({ length: 25 }, (_, index) => ({
      ...newest,
      id: `item-${index}`,
      receivedAt: new Date(Date.parse(newest.receivedAt) - index * 60_000).toISOString(),
    }));
    const result = normalizeThunderbirdMailResponse({ ok: true, source: 'thunderbird', account: 'sc***@example.ac.jp', items: rawItems.reverse() });
    expect(result.items).toHaveLength(20);
    expect(result.items[0].id).toBe('item-0');
    expect(result.account).toBe('sc***@example.ac.jp');
  });

  it('requests the bridge endpoint without exposing body or token in logs', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchMock = async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify({ ok: true, source: 'thunderbird', account: 'sc***@example.ac.jp', items: [newest] }), { status: 200 });
    };

    const result = await getRecentThunderbirdMail('bridge-secret-for-test', fetchMock, 5);
    expect(result.items[0]).toMatchObject({ subject: '中間発表について', isRead: false });
    expect(calls[0].url).toContain('/mail/recent');
    expect(calls[0].init?.headers).toMatchObject({ 'Content-Type': 'application/json' });
    expect(String(calls[0].init?.body)).toContain('"limit":5');
  });

  it('maps bridge source errors to safe UI codes', async () => {
    const fetchMock = async () => new Response(JSON.stringify({ ok: false, source: 'thunderbird', error: 'local_sync_required' }), { status: 503 });
    await expect(getRecentThunderbirdMail('bridge-secret-for-test', fetchMock)).rejects.toEqual(
      new ThunderbirdMailError('local_sync_required', 'Thunderbird에서 이 계정의 메시지를 이 컴퓨터에 보관해줘.'),
    );
  });

  it('opens Thunderbird only through the authenticated bridge endpoint', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchMock = async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify({ ok: true, source: 'thunderbird' }), { status: 200 });
    };
    await openThunderbird('bridge-secret-for-test', fetchMock);
    expect(calls[0].url).toContain('/mail/open');
  });
});
