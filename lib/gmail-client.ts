import type { GmailMessage } from './gmail';

export type GmailClientState = 'ready' | 'empty' | 'unconfigured' | 'error';

export type GmailClientResponse = {
  configured: boolean;
  source: 'gmail';
  state: GmailClientState;
  account: string;
  items: GmailMessage[];
  errorCode?: string;
};

export class GmailClientError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'GmailClientError';
  }
}

export async function getRecentGmail(fetchImpl: typeof fetch = fetch, limit = 20): Promise<GmailClientResponse> {
  let response: Response;
  try {
    response = await fetchImpl(`/api/google/gmail/messages?limit=${Math.max(1, Math.min(50, Math.floor(limit) || 20))}`, {
      cache: 'no-store',
    });
  } catch {
    throw new GmailClientError('network_error', 'Gmail API에 연결하지 못했어.');
  }

  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    throw new GmailClientError('malformed_response', 'Gmail 응답 형식을 읽지 못했어.');
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new GmailClientError('malformed_response', 'Gmail 응답 형식을 읽지 못했어.');
  }
  const value = raw as Record<string, unknown>;
  if (!response.ok || value.state === 'error') {
    throw new GmailClientError(typeof value.errorCode === 'string' ? value.errorCode : 'network_error', 'Gmail을 읽지 못했어.');
  }
  const items = Array.isArray(value.items) ? value.items as GmailMessage[] : [];
  return {
    configured: value.configured === true,
    source: 'gmail',
    state: value.state === 'ready' || value.state === 'empty' || value.state === 'unconfigured' ? value.state : 'error',
    account: typeof value.account === 'string' ? value.account : '',
    items,
  };
}
