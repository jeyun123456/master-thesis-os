import { describe, expect, it } from 'vitest';
import { BRIDGE_OFFLINE_MESSAGE, bridgeResponseMessage } from './bridge-status';

describe('bridge status messages', () => {
  it('distinguishes offline and response errors', () => {
    expect(BRIDGE_OFFLINE_MESSAGE).toContain('Bridge offline');
    expect(bridgeResponseMessage(403, 'origin not allowed')).toContain('Origin blocked');
    expect(bridgeResponseMessage(403, 'invalid token')).toContain('Invalid token');
    expect(bridgeResponseMessage(404, 'local file not found')).toContain('Local file not found');
    expect(bridgeResponseMessage(400, 'Path escapes master_path')).toContain('Bridge request failed');
  });
});
