import { afterEach, describe, expect, it, vi } from 'vitest';
import { askResearchQuestion } from './research-qa-client';
import type { GoogleDriveSearchResult } from './google-drive';

const result: GoogleDriveSearchResult = {
  file: {
    id: 'doc-1',
    name: '전환 문제 메모',
    mimeType: 'application/vnd.google-apps.document',
    modifiedTime: '2026-10-05T08:00:00.000Z',
    webViewLink: 'https://docs.google.com/document/d/doc-1/edit',
    size: null,
    isFolder: false,
    kind: 'document',
  },
  score: 10,
  matchedTerms: ['전환'],
  snippets: [
    { lineNumber: 12, text: '전환 문제에 대한 신해석의 핵심 논점이다.' },
  ],
  contentReadable: true,
  contentMatched: true,
  indexedMatch: true,
};

function installStorage(token = 'bridge-token') {
  const getItem = vi.fn((key: string) => key === 'thesisBridgeToken' ? token : null);
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem },
  });
  return getItem;
}

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(globalThis, 'localStorage');
});

describe('research Q&A client', () => {
  it('sends bounded Drive evidence to Luna by default selection', async () => {
    installStorage();
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || '{}'));
      expect(body).toMatchObject({
        token: 'bridge-token',
        question: '이 논점을 요약해줘',
        mode: 'luna',
      });
      expect(body.sources).toEqual([
        {
          sourceId: 'S1',
          name: '전환 문제 메모',
          indexedOnly: false,
          snippets: ['전환 문제에 대한 신해석의 핵심 논점이다.'],
        },
      ]);
      return new Response(JSON.stringify({
        ok: true,
        model: 'gpt-6-luna',
        mode: 'luna',
        answer: '자료에 따르면 핵심 논점은 다음과 같아. [S1]',
        sourceIds: ['S1'],
        insufficientEvidence: false,
      }), { status: 200 });
    });

    await expect(askResearchQuestion('이 논점을 요약해줘', 'luna', [result], fetcher as typeof fetch)).resolves.toMatchObject({
      model: 'gpt-6-luna',
      mode: 'luna',
      sourceIds: ['S1'],
      insufficientEvidence: false,
    });
  });

  it('routes the precision action to Sol', async () => {
    installStorage();
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || '{}'));
      expect(body.mode).toBe('sol');
      return new Response(JSON.stringify({
        ok: true,
        model: 'gpt-6.1-sol',
        mode: 'sol',
        answer: '정밀 분석 결과 [S1]',
        sourceIds: ['S1'],
        insufficientEvidence: false,
      }), { status: 200 });
    });

    const answer = await askResearchQuestion('논증을 비판적으로 검토해줘', 'sol', [result], fetcher as typeof fetch);
    expect(answer.model).toBe('gpt-6.1-sol');
    expect(answer.mode).toBe('sol');
  });

  it('requires a local bridge token before sending research evidence', async () => {
    installStorage('');
    const fetcher = vi.fn();
    await expect(askResearchQuestion('질문', 'luna', [result], fetcher as typeof fetch)).rejects.toMatchObject({
      code: 'bridge_auth',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
