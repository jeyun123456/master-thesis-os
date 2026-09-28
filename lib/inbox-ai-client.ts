import { INBOX_AI_BATCH_SIZE, INBOX_CATEGORIES, type InboxEntry, type InboxSuggestion } from './inbox';
import { BridgeApiVersionMismatchError } from './bridge-status';

const REQUEST_TIMEOUT_MS = 210_000;
const MAX_REQUEST_BYTES = 15_000;
type BridgeRequestInit = RequestInit & { targetAddressSpace?: 'loopback' };

function readBridgeToken() {
  try {
    return localStorage.getItem('thesisBridgeToken') || '';
  } catch {
    return '';
  }
}

function bridgeUrl() {
  return process.env.NEXT_PUBLIC_LOCAL_BRIDGE_URL || 'http://127.0.0.1:38471';
}

function isCategory(value: unknown): value is InboxSuggestion['category'] {
  return INBOX_CATEGORIES.includes(value as InboxSuggestion['category']);
}

export async function organizeInboxEntries(
  entries: InboxEntry[],
  token = readBridgeToken(),
  fetchImpl: typeof fetch = fetch,
): Promise<InboxSuggestion[]> {
  if (!token.trim()) throw new Error('Local Bridge token이 없습니다. Settings > 로컬 브리지에서 token을 저장해야 GPT 정리를 사용할 수 있어요.');
  const batch = entries.filter((entry) => !entry.processed).slice(0, INBOX_AI_BATCH_SIZE);
  if (!batch.length) throw new Error('GPT로 정리할 새 항목이 없어.');

  const body = JSON.stringify({
    token,
    entries: batch.map(({ id, rawText }) => ({ id, rawText })),
  });
  if (new TextEncoder().encode(body).length > MAX_REQUEST_BYTES) {
    throw new Error('선택한 항목이 요청 한도를 넘었어. 내용을 짧게 나눠서 다시 정리해줘.');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const init: BridgeRequestInit = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    signal: controller.signal,
  };
  if (typeof navigator !== 'undefined' && navigator.userAgent.startsWith('Sucrose')) {
    init.targetAddressSpace = 'loopback';
  }

  try {
    const response = await fetchImpl(`${bridgeUrl()}/inbox/organize`, init);
    const data = await response.json().catch(() => ({} as Record<string, unknown>)) as Record<string, unknown>;
    if (!response.ok) {
      if (response.status === 404) {
        throw new BridgeApiVersionMismatchError(null);
      }
      throw new Error(typeof data.error === 'string' ? data.error : 'AI 정리 요청을 처리하지 못했어.');
    }
    if (data.ok !== true || !Array.isArray(data.entries)) throw new Error('AI 정리 응답 형식을 확인해줘.');
    const results = data.entries.flatMap((raw): InboxSuggestion[] => {
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return [];
      const item = raw as Record<string, unknown>;
      if (typeof item.entryId !== 'string' || !batch.some((entry) => entry.id === item.entryId) || !isCategory(item.category)) return [];
      return [{
        entryId: item.entryId,
        category: item.category,
        title: typeof item.title === 'string' ? item.title : '',
        summary: typeof item.summary === 'string' ? item.summary : '',
        nextAction: typeof item.nextAction === 'string' ? item.nextAction : '',
        dueDate: typeof item.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.dueDate) ? item.dueDate : null,
        relatedEntryIds: Array.isArray(item.relatedEntryIds) ? item.relatedEntryIds.filter((id): id is string => typeof id === 'string' && batch.some((entry) => entry.id === id && id !== item.entryId)) : [],
      }];
    });
    if (results.length !== batch.length) throw new Error('AI가 모든 항목을 정리하지 못했어. 다시 시도해줘.');
    return results;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error('AI 응답 시간이 초과됐어. 잠시 후 다시 시도해줘.');
    if (error instanceof TypeError) throw new Error('Local Bridge에 연결할 수 없어. 브리지가 실행 중인지 확인해줘.');
    if (error instanceof BridgeApiVersionMismatchError) throw error;
    throw error instanceof Error ? error : new Error('AI 정리 요청을 처리하지 못했어.');
  } finally {
    clearTimeout(timeoutId);
  }
}
