import { describe, expect, it } from 'vitest';
import { BRIDGE_OFFLINE_MESSAGE, BRIDGE_TIMEOUT_MESSAGE, bridgeApiVersionMismatchMessage, bridgeResponseMessage, checkLocalBridgeApiVersion } from './bridge-status';

describe('bridge status messages', () => {
  it('distinguishes offline and response errors', () => {
    expect(BRIDGE_OFFLINE_MESSAGE).toContain('Bridge offline');
    expect(BRIDGE_TIMEOUT_MESSAGE).toContain('Bridge timeout');
    expect(bridgeResponseMessage(403, 'origin not allowed')).toContain('Origin blocked');
    expect(bridgeResponseMessage(403, 'invalid token')).toContain('Invalid token');
    expect(bridgeResponseMessage(404, 'local file not found')).toContain('Local file not found');
    expect(bridgeResponseMessage(400, 'Path escapes master_path')).toContain('Bridge request failed');
  });

  it('accepts the supported bridge API version', async () => {
    const fetchImpl = async () => new Response(JSON.stringify({ ok: true, apiVersion: 2 }), { status: 200 });

    await expect(checkLocalBridgeApiVersion(fetchImpl)).resolves.toEqual({ state: 'current', apiVersion: 2 });
  });

  it('warns when the health route is missing or reports a different API version', async () => {
    const missingVersion = async () => new Response(JSON.stringify({ ok: true }), { status: 200 });
    const differentVersion = async () => new Response(JSON.stringify({ ok: true, apiVersion: 3 }), { status: 200 });
    const missingRoute = async () => new Response('', { status: 404 });

    await expect(checkLocalBridgeApiVersion(missingVersion)).resolves.toEqual({ state: 'mismatch', apiVersion: null });
    await expect(checkLocalBridgeApiVersion(differentVersion)).resolves.toEqual({ state: 'mismatch', apiVersion: 3 });
    await expect(checkLocalBridgeApiVersion(missingRoute)).resolves.toEqual({ state: 'mismatch', apiVersion: null });
    expect(bridgeApiVersionMismatchMessage(3)).toContain('Bridge: v3');
  });

  it('keeps an unreachable health endpoint distinct from an API mismatch', async () => {
    const fetchImpl = async () => { throw new TypeError('network unavailable'); };

    await expect(checkLocalBridgeApiVersion(fetchImpl)).resolves.toEqual({ state: 'unavailable' });
  });
});
