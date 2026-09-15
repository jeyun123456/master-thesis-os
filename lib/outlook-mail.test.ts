import { describe, expect, it } from 'vitest';
import {
  getRecentOutlookMail,
  normalizeOutlookMail,
  normalizeOutlookMailResponse,
  OutlookMailError,
} from './outlook-mail';

const newest = {
  id: 'newest',
  subject: '中間発表について',
  from: { emailAddress: { name: '松尾先生', address: 'matsuo@example.ac.jp' } },
  receivedDateTime: '2026-09-15T01:10:00Z',
  isRead: false,
  webLink: 'https://outlook.office.com/mail/id/newest',
};

describe('Outlook mail normalization', () => {
  it('normalizes blank subjects and missing senders safely', () => {
    expect(normalizeOutlookMail({
      id: 'missing-sender',
      subject: '   ',
      receivedDateTime: '2026-09-14T01:10:00Z',
      isRead: true,
    })).toMatchObject({
      subject: '(제목 없음)',
      senderName: '발신자 정보 없음',
      senderAddress: '',
      isRead: true,
      webLink: '',
    });
  });

  it('rejects an invalid Graph response or message shape', () => {
    expect(() => normalizeOutlookMailResponse({ value: null })).toThrow('학교 메일 응답 형식을 확인할 수 없어.');
    expect(() => normalizeOutlookMail({ id: 'missing-date' })).toThrow('학교 메일 응답 형식을 확인할 수 없어.');
  });

  it('sorts recent messages and limits display data to five items', async () => {
    const fetchMock = async () => new Response(JSON.stringify({
      value: [
        { ...newest, id: 'older', receivedDateTime: '2026-09-10T01:10:00Z' },
        newest,
        { ...newest, id: 'middle', receivedDateTime: '2026-09-12T01:10:00Z', isRead: true },
        { ...newest, id: 'four', receivedDateTime: '2026-09-11T01:10:00Z' },
        { ...newest, id: 'five', receivedDateTime: '2026-09-09T01:10:00Z' },
        { ...newest, id: 'six', receivedDateTime: '2026-09-08T01:10:00Z' },
      ],
    }), { status: 200 });

    const items = await getRecentOutlookMail('test-access-token', fetchMock);
    expect(items).toHaveLength(5);
    expect(items.map((item) => item.id)).toEqual(['newest', 'middle', 'four', 'older', 'five']);
    expect(items[0]).toMatchObject({ subject: '中間発表について', senderName: '松尾先生', isRead: false });
  });

  it('requests only the PoC fields and never the message body', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchMock = async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify({ value: [newest] }), { status: 200 });
    };

    await getRecentOutlookMail('test-access-token', fetchMock);
    const url = new URL(calls[0].url);
    expect(url.searchParams.get('$top')).toBe('5');
    expect(url.searchParams.get('$orderby')).toBe('receivedDateTime desc');
    expect(url.searchParams.get('$select')).toBe('id,subject,from,receivedDateTime,isRead,webLink');
    expect(url.searchParams.get('$select')).not.toContain('body');
    expect(calls[0].init?.headers).toMatchObject({ Authorization: 'Bearer test-access-token' });
  });

  it('maps a Graph permission failure to a safe consent state', async () => {
    const fetchMock = async () => new Response(JSON.stringify({ error: { code: 'Authorization_RequestDenied', message: 'raw provider details' } }), { status: 403 });
    await expect(getRecentOutlookMail('test-access-token', fetchMock)).rejects.toEqual(
      new OutlookMailError('consent_required', '학교 Microsoft 365 정책상 이 앱의 접근 승인이 필요할 수 있어.'),
    );
  });
});
