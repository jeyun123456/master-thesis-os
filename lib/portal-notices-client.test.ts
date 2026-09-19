import { describe, expect, it, vi } from 'vitest';
import {
  getPortalNotice,
  openPortalUrl,
  startPortalNoticeAnalysis,
  startPortalLogin,
  updatePortalNoticeCandidate,
} from './portal-notices-client';

function fetchResponse(payload: unknown, status = 200): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })) as unknown as typeof fetch;
}

describe('portal notice AI client', () => {
  it('normalizes stored AI output and candidates from notice detail', async () => {
    const fetchImpl = fetchResponse({
      ok: true,
      source: 'sqlite',
      item: {
        noticeId: 'I-1',
        type: 'ALL',
        title: '공지',
        ai: {
          status: 'completed',
          summary: '요약',
          translation: '번역',
          model: 'test-model',
        },
        calendarCandidates: [{
          id: 'portal-calendar:1',
          noticeId: 'I-1',
          title: '설명회',
          start: '2099-09-20',
          end: null,
          allDay: true,
          type: 'event',
          reason: '참석 일정',
          status: 'pending',
        }],
      },
    });

    const notice = await getPortalNotice('I-1', 'token', fetchImpl);
    expect(notice.ai).toMatchObject({ status: 'completed', summary: '요약', translation: '번역', model: 'test-model' });
    expect(notice.calendarCandidates).toHaveLength(1);
    expect(notice.calendarCandidates[0]).toMatchObject({ id: 'portal-calendar:1', type: 'event', status: 'pending' });
  });

  it('posts analysis and candidate actions to the local bridge', async () => {
    const analysisFetch = fetchResponse({ ok: true, source: 'sqlite', status: 'queued', jobKind: 'ai' });
    await startPortalNoticeAnalysis('I-1', true, 'token', analysisFetch);
    expect(analysisFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:38471/portal/notices/I-1/analyze',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ token: 'token', force: true }) }),
    );

    const candidateFetch = fetchResponse({
      ok: true,
      source: 'sqlite',
      candidate: {
        id: 'portal-calendar:1',
        noticeId: 'I-1',
        title: '설명회',
        start: '2099-09-20',
        end: null,
        allDay: true,
        type: 'event',
        reason: '참석 일정',
        status: 'ignored',
      },
    });
    const candidate = await updatePortalNoticeCandidate('I-1', { candidateId: 'portal-calendar:1', status: 'ignored' }, 'token', candidateFetch);
    expect(candidate.status).toBe('ignored');
    expect(candidateFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:38471/portal/notices/I-1/candidate',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('opens portal URLs through the default browser bridge endpoint', async () => {
    const fetchImpl = fetchResponse({ ok: true, source: 'default_browser' });
    await openPortalUrl(' https://sp.ritsumei.ac.jp/studentportal/s/ ', 'token', fetchImpl);
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:38471/portal/open-url',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ token: 'token', url: 'https://sp.ritsumei.ac.jp/studentportal/s/' }),
      }),
    );
  });

  it('starts portal login through the persistent-profile bridge job', async () => {
    const fetchImpl = fetchResponse({ ok: true, source: 'sqlite', status: 'running', jobKind: 'login' }, 202);
    await startPortalLogin('token', fetchImpl);
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:38471/portal/login',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ token: 'token' }),
      }),
    );
  });
});
