import { describe, expect, it, vi } from 'vitest';
import { startAndWaitForDailySync, type DailySyncStatus } from './daily-checklist-actions';

describe('daily checklist sync action', () => {
  it('starts an idle sync and resolves only after a successful result', async () => {
    const start = vi.fn(async () => {});
    const states: DailySyncStatus[] = [
      { status: 'completed', jobRunning: false, lastSyncAt: '2026-09-27T08:00:00Z' },
      { status: 'running', jobRunning: true, lastSyncAt: '2026-09-27T08:00:00Z' },
      { status: 'completed', jobRunning: false, lastSyncAt: '2026-09-28T08:00:00Z' },
    ];
    const readStatus = vi.fn(async () => states.shift() || { status: 'completed', jobRunning: false, lastSyncAt: '2026-09-28T08:00:00Z' });

    const result = await startAndWaitForDailySync({ start, readStatus, delay: async () => {} });

    expect(start).toHaveBeenCalledOnce();
    expect(result.lastSyncAt).toBe('2026-09-28T08:00:00Z');
  });

  it('waits for an already-running sync without starting a duplicate job', async () => {
    const start = vi.fn(async () => {});
    const states: DailySyncStatus[] = [
      { status: 'running', jobRunning: true, lastSyncAt: null },
      { status: 'completed', jobRunning: false, lastSyncAt: '2026-09-28T08:00:00Z' },
    ];
    const readStatus = vi.fn(async () => states.shift() || { status: 'completed', jobRunning: false, lastSyncAt: null });

    await startAndWaitForDailySync({ start, readStatus, delay: async () => {} });

    expect(start).not.toHaveBeenCalled();
  });

  it('leaves failure handling to the caller without marking a success', async () => {
    const readStatus = vi.fn()
      .mockResolvedValueOnce({ status: 'idle', jobRunning: false, lastSyncAt: null })
      .mockResolvedValueOnce({ status: 'failed', jobRunning: false, jobError: 'profile unavailable' });

    await expect(startAndWaitForDailySync({ start: async () => {}, readStatus, delay: async () => {} }))
      .rejects.toThrow('profile unavailable');
  });
});
