import type { GoogleDriveSearchResult } from './google-drive';

type BridgeRequestInit = RequestInit & { targetAddressSpace?: 'loopback' };

export type ResearchQAMode = 'luna' | 'sol';

export type ResearchQAAnswer = {
  answer: string;
  sourceIds: string[];
  insufficientEvidence: boolean;
  model: string;
  mode: ResearchQAMode;
};

export class ResearchQAClientError extends Error {
  constructor(
    public readonly code:
      | 'bridge_offline'
      | 'bridge_auth'
      | 'invalid_request'
      | 'provider_error'
      | 'malformed_response',
    message: string,
  ) {
    super(message);
    this.name = 'ResearchQAClientError';
  }
}

function bridgeUrl(): string {
  return (process.env.NEXT_PUBLIC_LOCAL_BRIDGE_URL || 'http://127.0.0.1:38471').replace(/\/+$/, '');
}

function bridgeToken(): string {
  try {
    return localStorage.getItem('thesisBridgeToken') || '';
  } catch {
    return '';
  }
}

function buildSources(results: GoogleDriveSearchResult[]) {
  return results.slice(0, 8).map((result, index) => ({
    sourceId: `S${index + 1}`,
    name: result.file.name,
    indexedOnly: result.snippets.length === 0,
    snippets: result.snippets.slice(0, 4).map((snippet) => snippet.text),
  }));
}

export async function askResearchQuestion(
  question: string,
  mode: ResearchQAMode,
  results: GoogleDriveSearchResult[],
  fetchImpl: typeof fetch = fetch,
): Promise<ResearchQAAnswer> {
  const normalizedQuestion = question.trim();
  if (normalizedQuestion.length < 2) {
    throw new ResearchQAClientError('invalid_request', '질문을 2자 이상 입력해줘.');
  }
  if (!results.length) {
    throw new ResearchQAClientError('invalid_request', '먼저 Drive 연구자료 검색을 실행해줘.');
  }

  const token = bridgeToken();
  if (!token) {
    throw new ResearchQAClientError('bridge_auth', 'Settings에서 Local Bridge token을 확인해줘.');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 220_000);
  const init: BridgeRequestInit = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token,
      question: normalizedQuestion,
      mode,
      sources: buildSources(results),
    }),
    signal: controller.signal,
  };
  if (typeof navigator !== 'undefined' && navigator.userAgent.startsWith('Sucrose')) {
    init.targetAddressSpace = 'loopback';
  }

  try {
    const response = await fetchImpl(`${bridgeUrl()}/research/answer`, init);
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw new ResearchQAClientError('malformed_response', '연구 Q&A 응답 형식을 읽지 못했어.');
    }

    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new ResearchQAClientError('malformed_response', '연구 Q&A 응답 형식을 읽지 못했어.');
    }
    const value = data as Record<string, unknown>;

    if (!response.ok || value.ok !== true) {
      if (response.status === 403) {
        throw new ResearchQAClientError('bridge_auth', 'Local Bridge token을 확인해줘.');
      }
      if (response.status === 400) {
        throw new ResearchQAClientError('invalid_request', typeof value.error === 'string' ? value.error : '연구 Q&A 요청을 확인해줘.');
      }
      throw new ResearchQAClientError('provider_error', typeof value.error === 'string' ? value.error : 'Codex 연구 Q&A 요청에 실패했어.');
    }

    if (
      typeof value.answer !== 'string'
      || !Array.isArray(value.sourceIds)
      || typeof value.model !== 'string'
      || (value.mode !== 'luna' && value.mode !== 'sol')
      || typeof value.insufficientEvidence !== 'boolean'
    ) {
      throw new ResearchQAClientError('malformed_response', '연구 Q&A 응답 형식을 읽지 못했어.');
    }

    return {
      answer: value.answer,
      sourceIds: value.sourceIds.filter((item): item is string => typeof item === 'string'),
      insufficientEvidence: value.insufficientEvidence,
      model: value.model,
      mode: value.mode,
    };
  } catch (error) {
    if (error instanceof ResearchQAClientError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ResearchQAClientError('provider_error', 'Codex 연구 Q&A 응답 시간이 초과됐어.');
    }
    throw new ResearchQAClientError('bridge_offline', 'Local Bridge에 연결할 수 없어.');
  } finally {
    clearTimeout(timeoutId);
  }
}
