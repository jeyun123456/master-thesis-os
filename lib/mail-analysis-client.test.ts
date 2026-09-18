import { describe, expect, it } from 'vitest';
import {
  getMailAnalysis,
  getMailSyncStatus,
  startMailSync,
  updateMailCandidate,
} from './mail-analysis-client';

const sync = {
  ok: true,
  source: 'sqlite',
  status: 'completed',
  phase: 'completed',
  lastSyncAt: '2026-09-18T01:00:00Z',
  newCount: 1,
  analysisCompleted: 1,
  analysisFailed: 0,
  progress: { current: 1, total: 1 },
  counts: { queued: 0, processing: 0, completed: 1, failed: 0 },
  folders: [{
    folder: 'school-work',
    lastSyncAt: '2026-09-18T01:00:00Z',
    status: 'completed',
    phase: 'completed',
    processed: 1,
    total: 1,
    newCount: 1,
    analysisCompleted: 1,
    analysisFailed: 0,
  }, {
    folder: 'international-office',
    lastSyncAt: null,
    status: 'idle',
    phase: '',
    processed: 0,
    total: 0,
    newCount: 0,
    analysisCompleted: 0,
    analysisFailed: 0,
  }],
};

const item = {
  mail: {
    id: 'mail-1',
    subject: '발표 안내',
    senderName: '교수',
    senderAddress: 'professor@example.edu',
    receivedAt: '2026-09-18T00:00:00Z',
    isRead: false,
    messageId: '<mail-1@example.edu>',
  },
  folder: 'school-work',
  analysis: {
    mailId: 'mail-1',
    status: 'completed',
    summary: '발표 일정 안내다.',
    action: '자료를 준비한다.',
    error: null,
    analyzedAt: '2026-09-18T01:00:00Z',
    promptVersion: 'mail-analysis-local-v1',
    model: 'test-model',
  },
  candidates: [{
    id: 'candidate-1',
    mailId: 'mail-1',
    title: '발표',
    start: '2099-09-20',
    end: null,
    allDay: true,
    type: 'event',
    reason: '참석 일정',
    status: 'pending',
  }],
};

describe('local mail analysis bridge client', () => {
  it('reads sync status and stored analysis with the bridge header token', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchMock = async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify({ ...sync, ok: true, source: 'sqlite' }), { status: 200 });
    };
    const result = await getMailSyncStatus('token-value', fetchMock);
    expect(result.status).toBe('completed');
    expect(calls[0].init?.headers).toEqual({ 'X-Bridge-Token': 'token-value' });
  });

  it('normalizes SQLite analysis items without calling an AI endpoint', async () => {
    const calls: string[] = [];
    const fetchMock = async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return new Response(JSON.stringify({ ok: true, source: 'sqlite', items: [item], sync }), { status: 200 });
    };
    const result = await getMailAnalysis('token-value', { folder: 'school-work' }, fetchMock);
    expect(result.items[0].analysis.summary).toBe('발표 일정 안내다.');
    expect(result.items[0].candidates[0].status).toBe('pending');
    expect(calls[0]).toContain('/mail/analysis?');
    expect(calls[0]).not.toContain('/api/mail/analyze');
  });

  it('starts sync and persists candidate state through SQLite endpoints', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchMock = async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      if (String(input).endsWith('/mail/analysis/candidate')) {
        return new Response(JSON.stringify({ ok: true, source: 'sqlite', candidate: { ...item.candidates[0], status: 'ignored' } }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true, source: 'sqlite', status: 'running' }), { status: 202 });
    };
    await startMailSync('token-value', fetchMock);
    const candidate = await updateMailCandidate('token-value', {
      mailId: 'mail-1',
      candidateId: 'candidate-1',
      status: 'ignored',
      title: '발표',
      start: '2099-09-20',
      end: null,
      allDay: true,
    }, fetchMock);
    expect(candidate.status).toBe('ignored');
    expect(calls[0].url).toBe('http://127.0.0.1:38471/mail/sync');
    expect(JSON.parse(String(calls[0].init?.body))).toMatchObject({ token: 'token-value' });
    expect(calls[1].url).toBe('http://127.0.0.1:38471/mail/analysis/candidate');
  });
});
