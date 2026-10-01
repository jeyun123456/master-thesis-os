import '../app/inbox-workflow-test-safety';
import { describe, expect, it, vi } from 'vitest';
import { createInboxEntry } from './inbox';
import { deletePersistedInboxEntry, loadPersistedInbox, savePersistedInbox } from './inbox-persistence-client';

function jsonResponse(status: number, value: unknown) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('Inbox Vault persistence client', () => {
  it('loads the Vault inbox through the existing local bridge with its token header', async () => {
    const entry = createInboxEntry('Vault entry', new Date('2026-09-28T08:00:00.000Z'), 'vault-1');
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(200, {
      ok: true,
      apiVersion: 2,
      source: 'vault',
      version: 1,
      entries: [entry],
    }));

    await expect(loadPersistedInbox('bridge-secret', fetchImpl)).resolves.toEqual([entry]);
    expect(fetchImpl.mock.calls[0][0]).toBe('http://127.0.0.1:38471/inbox');
    expect(fetchImpl.mock.calls[0][1]?.headers).toEqual({ 'X-Bridge-Token': 'bridge-secret' });
  });

  it('saves entries without exposing raw content in the URL', async () => {
    const entry = createInboxEntry('raw text', new Date('2026-09-28T08:00:00.000Z'), 'vault-2');
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(200, {
      ok: true,
      apiVersion: 2,
      source: 'vault',
      version: 1,
      entries: [entry],
    }));

    await expect(savePersistedInbox([entry], 'bridge-secret', fetchImpl)).resolves.toEqual([entry]);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:38471/inbox');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toMatchObject({ token: 'bridge-secret', entries: [entry] });
  });

  it('deletes one persistent entry through the Bridge delete endpoint', async () => {
    const remaining = createInboxEntry('keep this entry', new Date('2026-09-28T08:00:00.000Z'), 'keep-1');
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(200, {
      ok: true,
      apiVersion: 5,
      source: 'vault',
      version: 1,
      entries: [remaining],
    }));

    await expect(deletePersistedInboxEntry('remove-1', 'bridge-secret', fetchImpl)).resolves.toEqual([remaining]);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:38471/inbox/delete');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ token: 'bridge-secret', entryId: 'remove-1' });
  });

  it('explains that a 404 leaves the Bridge API version unknown', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(404, { error: 'not found' }));

    await expect(loadPersistedInbox('bridge-secret', fetchImpl)).rejects.toMatchObject({ code: 'bridge_unknown' });
  });

  it('keeps bridge authentication failures distinct from persistence failures', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(403, { error: 'invalid token' }));

    await expect(loadPersistedInbox('bad-token', fetchImpl)).rejects.toMatchObject({ code: 'bridge_auth' });
  });

  it('explains how to set a missing token without making a bridge request', async () => {
    const fetchImpl = vi.fn<typeof fetch>();

    await expect(loadPersistedInbox('', fetchImpl)).rejects.toThrow('Settings > 로컬 브리지');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
