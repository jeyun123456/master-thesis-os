import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  classifyMicrosoftAuthError,
  getMicrosoftAuthConfig,
  isMicrosoftConfigured,
  microsoftAuthErrorMessage,
} from './microsoft-auth';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Microsoft auth configuration', () => {
  it('reports unconfigured when the public client ID is missing', () => {
    vi.stubEnv('NEXT_PUBLIC_MICROSOFT_CLIENT_ID', '');
    expect(isMicrosoftConfigured('http://localhost:3000')).toBe(false);
  });

  it('uses the organizations authority and the current app origin', () => {
    vi.stubEnv('NEXT_PUBLIC_MICROSOFT_CLIENT_ID', 'public-client-id');
    vi.stubEnv('NEXT_PUBLIC_MICROSOFT_AUTHORITY', 'https://login.microsoftonline.com/organizations/');
    expect(getMicrosoftAuthConfig('https://master-thesis-os.vercel.app/')).toEqual({
      clientId: 'public-client-id',
      authority: 'https://login.microsoftonline.com/organizations',
      redirectUri: 'https://master-thesis-os.vercel.app',
      postLogoutRedirectUri: 'https://master-thesis-os.vercel.app',
    });
    expect(isMicrosoftConfigured('https://master-thesis-os.vercel.app')).toBe(true);
  });

  it('keeps consent errors user-facing without exposing raw provider errors', () => {
    expect(classifyMicrosoftAuthError(new Error('AADSTS90094: admin consent is required'))).toBe('admin_approval_required');
    expect(classifyMicrosoftAuthError(new Error('AADSTS65001: consent_required'))).toBe('consent_required');
    expect(microsoftAuthErrorMessage('admin_approval_required')).toContain('접근 승인이 필요할 수 있어');
    expect(microsoftAuthErrorMessage('admin_approval_required')).not.toContain('AADSTS');
  });
});
