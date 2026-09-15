import {
  InteractionRequiredAuthError,
  PublicClientApplication,
  type AccountInfo,
} from '@azure/msal-browser';

export const MICROSOFT_DEFAULT_AUTHORITY = 'https://login.microsoftonline.com/organizations';
export const MICROSOFT_GRAPH_SCOPES = ['User.Read', 'Mail.ReadBasic'] as const;
export const MICROSOFT_LOGIN_SCOPES = ['openid', 'profile', 'offline_access', ...MICROSOFT_GRAPH_SCOPES] as const;

export type MicrosoftAuthErrorCode =
  | 'unconfigured'
  | 'signed_out'
  | 'interaction_required'
  | 'consent_required'
  | 'admin_approval_required'
  | 'network_error'
  | 'auth_error';

export type MicrosoftAuthConfig = {
  clientId: string;
  authority: string;
  redirectUri: string;
  postLogoutRedirectUri: string;
};

export class MicrosoftAuthError extends Error {
  constructor(public readonly code: MicrosoftAuthErrorCode, message: string) {
    super(message);
    this.name = 'MicrosoftAuthError';
  }
}

let application: PublicClientApplication | null = null;
let applicationKey = '';
let initialization: Promise<PublicClientApplication> | null = null;
let redirectAccount: AccountInfo | null = null;

function browserOrigin(): string {
  return typeof window !== 'undefined' ? window.location.origin : '';
}

function normalizeOrigin(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

export function getMicrosoftAuthConfig(origin = browserOrigin()): MicrosoftAuthConfig {
  const normalizedOrigin = normalizeOrigin(origin);
  return {
    clientId: process.env.NEXT_PUBLIC_MICROSOFT_CLIENT_ID?.trim() || '',
    authority: (process.env.NEXT_PUBLIC_MICROSOFT_AUTHORITY?.trim() || MICROSOFT_DEFAULT_AUTHORITY).replace(/\/+$/, ''),
    redirectUri: normalizedOrigin,
    postLogoutRedirectUri: normalizedOrigin,
  };
}

export function isMicrosoftConfigured(origin = browserOrigin()): boolean {
  const config = getMicrosoftAuthConfig(origin);
  return Boolean(config.clientId && config.authority && config.redirectUri);
}

function errorText(error: unknown): string {
  if (typeof error === 'string') return error;
  if (!error || typeof error !== 'object') return '';
  const value = error as Record<string, unknown>;
  return [value.errorCode, value.subError, value.name, value.message]
    .filter((item): item is string => typeof item === 'string')
    .join(' ');
}

export function classifyMicrosoftAuthError(error: unknown): MicrosoftAuthErrorCode {
  if (error instanceof MicrosoftAuthError) return error.code;
  if (error instanceof InteractionRequiredAuthError) return 'interaction_required';
  const text = errorText(error).toLocaleLowerCase();
  if (/aadsts90094|admin.?consent|admin.?approval|authorization_requestdenied/.test(text)) return 'admin_approval_required';
  if (/aadsts65001|consent.?required|consent required/.test(text)) return 'consent_required';
  if (/interaction.?required|login.?required|no.?tokens.?found|refresh.?token.?expired/.test(text)) return 'interaction_required';
  if (/network|failed to fetch|timeout|offline/.test(text)) return 'network_error';
  return 'auth_error';
}

export function microsoftAuthErrorMessage(code: MicrosoftAuthErrorCode): string {
  switch (code) {
    case 'unconfigured':
      return 'Microsoft 365 연결 설정이 아직 없어.';
    case 'signed_out':
      return 'Microsoft 365 계정을 먼저 연결해줘.';
    case 'consent_required':
    case 'admin_approval_required':
      return '학교 Microsoft 365 정책상 이 앱의 접근 승인이 필요할 수 있어.';
    case 'interaction_required':
      return 'Microsoft 365 로그인을 다시 확인해줘.';
    case 'network_error':
      return 'Microsoft 로그인 서비스에 연결하지 못했어. 잠시 후 다시 시도해줘.';
    default:
      return 'Microsoft 365 연결에 실패했어. 설정과 권한을 확인해줘.';
  }
}

function toMicrosoftAuthError(error: unknown): MicrosoftAuthError {
  if (error instanceof MicrosoftAuthError) return error;
  const code = classifyMicrosoftAuthError(error);
  return new MicrosoftAuthError(code, microsoftAuthErrorMessage(code));
}

function requireConfig(): MicrosoftAuthConfig {
  const config = getMicrosoftAuthConfig();
  if (!isMicrosoftConfigured()) {
    throw new MicrosoftAuthError('unconfigured', microsoftAuthErrorMessage('unconfigured'));
  }
  return config;
}

function getApplication(config: MicrosoftAuthConfig): PublicClientApplication {
  const key = `${config.clientId}\u0000${config.authority}\u0000${config.redirectUri}`;
  if (!application || applicationKey !== key) {
    application = new PublicClientApplication({
      auth: {
        clientId: config.clientId,
        authority: config.authority,
        redirectUri: config.redirectUri,
        postLogoutRedirectUri: config.postLogoutRedirectUri,
      },
      // MSAL owns this browser cache. sessionStorage keeps the PoC scoped to
      // the current browser tab/session; the app never persists tokens itself.
      cache: { cacheLocation: 'sessionStorage' },
    });
    applicationKey = key;
    initialization = null;
    redirectAccount = null;
  }
  return application;
}

async function initializedApplication(): Promise<PublicClientApplication> {
  const config = requireConfig();
  const current = getApplication(config);
  if (!initialization) {
    initialization = (async () => {
      await current.initialize();
      const result = await current.handleRedirectPromise();
      redirectAccount = result?.account || null;
      if (redirectAccount) current.setActiveAccount(redirectAccount);
      return current;
    })().catch((error: unknown) => {
      initialization = null;
      throw toMicrosoftAuthError(error);
    });
  }
  return initialization;
}

export async function initializeMicrosoftAuth(): Promise<AccountInfo | null> {
  if (!isMicrosoftConfigured()) return null;
  const current = await initializedApplication();
  const account = redirectAccount || current.getActiveAccount() || current.getAllAccounts()[0] || null;
  if (account) current.setActiveAccount(account);
  return account;
}

export function getMicrosoftAccount(): AccountInfo | null {
  if (!application) return null;
  return redirectAccount || application.getActiveAccount() || application.getAllAccounts()[0] || null;
}

export async function loginMicrosoft(): Promise<void> {
  const config = requireConfig();
  const current = await initializedApplication();
  try {
    await current.loginRedirect({
      scopes: [...MICROSOFT_LOGIN_SCOPES],
      redirectUri: config.redirectUri,
    });
  } catch (error) {
    throw toMicrosoftAuthError(error);
  }
}

function isInteractionRequired(error: unknown): boolean {
  return classifyMicrosoftAuthError(error) === 'interaction_required'
    || classifyMicrosoftAuthError(error) === 'consent_required'
    || classifyMicrosoftAuthError(error) === 'admin_approval_required';
}

export async function acquireMicrosoftGraphToken(account?: AccountInfo): Promise<string> {
  const config = requireConfig();
  const current = await initializedApplication();
  const selectedAccount = account || getMicrosoftAccount();
  if (!selectedAccount) {
    throw new MicrosoftAuthError('signed_out', microsoftAuthErrorMessage('signed_out'));
  }

  try {
    const result = await current.acquireTokenSilent({
      account: selectedAccount,
      redirectUri: config.redirectUri,
      scopes: [...MICROSOFT_GRAPH_SCOPES],
    });
    if (!result.accessToken) {
      throw new MicrosoftAuthError('auth_error', microsoftAuthErrorMessage('auth_error'));
    }
    return result.accessToken;
  } catch (error) {
    if (isInteractionRequired(error)) {
      try {
        await current.acquireTokenRedirect({
          account: selectedAccount,
          redirectUri: config.redirectUri,
          scopes: [...MICROSOFT_GRAPH_SCOPES],
        });
      } catch (redirectError) {
        throw toMicrosoftAuthError(redirectError);
      }
      throw new MicrosoftAuthError('interaction_required', microsoftAuthErrorMessage('interaction_required'));
    }
    throw toMicrosoftAuthError(error);
  }
}

export async function logoutMicrosoft(): Promise<void> {
  const config = requireConfig();
  const current = await initializedApplication();
  const account = getMicrosoftAccount();
  current.setActiveAccount(null);
  redirectAccount = null;
  try {
    await current.logoutRedirect({ account, postLogoutRedirectUri: config.postLogoutRedirectUri });
  } catch (error) {
    throw toMicrosoftAuthError(error);
  }
}
