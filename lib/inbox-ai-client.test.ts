import '../app/inbox-workflow-test-safety';
import { describe, expect, it, vi } from 'vitest';
import { createInboxEntry } from './inbox';
import { organizeInboxEntries } from './inbox-ai-client';

describe('Inbox AI bridge client', () => {
  it('explains how to set a missing token before GPT organization', async () => {
    const entry = createInboxEntry('연구 메모', new Date('2026-09-28T08:00:00.000Z'), 'ai-token');
    const fetchImpl = vi.fn<typeof fetch>();

    await expect(organizeInboxEntries([entry], '', fetchImpl)).rejects.toThrow('Settings > 로컬 브리지');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reports a missing Local Bridge organize route without claiming its version is outdated', async () => {
    const entry = createInboxEntry('연구 아이디어', new Date('2026-09-28T08:00:00.000Z'), 'ai-1');
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      JSON.stringify({ error: 'not found' }),
      { status: 404, headers: { 'Content-Type': 'application/json' } },
    ));

    await expect(organizeInboxEntries([entry], 'bridge-secret', fetchImpl)).rejects.toThrow('Bridge AI 정리 API를 찾을 수 없어');
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:38471/inbox/organize');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toMatchObject({
      token: 'bridge-secret',
      entries: [{ id: 'ai-1', rawText: '연구 아이디어' }],
    });
  });

  it('rejects incomplete provider results before they reach the preview', async () => {
    const entry = createInboxEntry('오늘 연구 메모', new Date('2026-09-28T08:00:00.000Z'), 'ai-invalid');
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      JSON.stringify({ ok: true, apiVersion: 2, entries: [] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));

    await expect(organizeInboxEntries([entry], 'bridge-secret', fetchImpl)).rejects.toThrow('모든 항목을 정리하지 못했어');
  });

  it('explains when the Local Bridge is unavailable', async () => {
    const entry = createInboxEntry('연구 메모', new Date('2026-09-28T08:00:00.000Z'), 'ai-offline');
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('fetch failed'));

    await expect(organizeInboxEntries([entry], 'bridge-secret', fetchImpl)).rejects.toThrow('Local Bridge에 연결할 수 없어');
  });

  it('aborts a provider request that exceeds the AI timeout', async () => {
    const entry = createInboxEntry('연구 메모', new Date('2026-09-28T08:00:00.000Z'), 'ai-timeout');
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn<typeof fetch>((_input, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      }));
      const timeoutExpectation = expect(organizeInboxEntries([entry], 'bridge-secret', fetchImpl))
        .rejects.toThrow('AI 응답 시간이 초과됐어');
      await vi.advanceTimersByTimeAsync(210_000);

      await timeoutExpectation;
    } finally {
      vi.useRealTimers();
    }
  });
});
