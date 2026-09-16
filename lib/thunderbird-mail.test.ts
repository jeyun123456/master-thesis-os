import { describe, expect, it } from 'vitest';
import {
  getRecentThunderbirdMail,
  getThunderbirdFolders,
  normalizeThunderbirdMail,
  normalizeThunderbirdFolderResponse,
  normalizeThunderbirdMailResponse,
  openThunderbird,
  openThunderbirdMessage,
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

  it('sorts and limits normalized metadata to one hundred items', () => {
    const rawItems = Array.from({ length: 105 }, (_, index) => ({
      ...newest,
      id: `item-${index}`,
      receivedAt: new Date(Date.parse(newest.receivedAt) - index * 60_000).toISOString(),
    }));
    const result = normalizeThunderbirdMailResponse({ ok: true, source: 'thunderbird', account: 'sc***@example.ac.jp', items: rawItems.reverse() });
    expect(result.items).toHaveLength(100);
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

  it('sends only a logical folder id for folder-specific recent mail', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchMock = async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify({ ok: true, source: 'thunderbird', account: 'sc***@example.ac.jp', folder: 'school-work', items: [] }), { status: 200 });
    };

    await getRecentThunderbirdMail('bridge-secret-for-test', fetchMock, 20, 'school-work');
    expect(calls[0].url).toContain('/mail/recent');
    expect(String(calls[0].init?.body)).toContain('"folder":"school-work"');
    expect(String(calls[0].init?.body)).not.toContain('school.example');
  });

  it('allows the list fetch to request at most one hundred messages', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchMock = async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify({ ok: true, source: 'thunderbird', account: 'sc***@example.ac.jp', items: [] }), { status: 200 });
    };

    await getRecentThunderbirdMail('bridge-secret-for-test', fetchMock, 500);
    expect(String(calls[0].init?.body)).toContain('"limit":100');
  });

  it('normalizes the logical folder list without accepting path data', () => {
    expect(normalizeThunderbirdFolderResponse({
      ok: true,
      source: 'thunderbird',
      account: 'sc***@example.ac.jp',
      folders: [
        { id: 'school-work', label: '학교 업무', available: true },
        { id: 'international-office', label: '국제과', available: false },
        { id: 'inbox', label: '받은 편지함', available: true },
      ],
    }).folders).toEqual([
      { id: 'school-work', label: '학교 업무', available: true },
      { id: 'international-office', label: '국제과', available: false },
      { id: 'inbox', label: '받은 편지함', available: true },
    ]);
    expect(() => normalizeThunderbirdFolderResponse({
      ok: true,
      source: 'thunderbird',
      folders: [{ id: 'C:\\profile\\Mail\\학교 업무', label: '학교 업무', available: true }],
    })).toThrow('Local Bridge 메일 응답 형식을 확인할 수 없어.');
  });

  it('maps folder endpoint errors to safe folder codes', async () => {
    const fetchMock = async () => new Response(JSON.stringify({ ok: false, source: 'thunderbird', error: 'folder_not_found' }), { status: 404 });
    await expect(getThunderbirdFolders('bridge-secret-for-test', fetchMock)).rejects.toEqual(
      new ThunderbirdMailError('folder_not_found', 'Thunderbird 메일 폴더를 찾지 못했어.'),
    );
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

  it('opens a specific message through the authenticated bridge without a filesystem path', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchMock = async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify({ ok: true, source: 'thunderbird' }), { status: 200 });
    };

    await openThunderbirdMessage('bridge-secret-for-test', '<message@example.edu>', fetchMock);

    expect(calls[0].url).toContain('/mail/open');
    expect(String(calls[0].init?.body)).toContain('"messageId":"<message@example.edu>"');
    expect(String(calls[0].init?.body)).not.toContain('profile');
  });
});
