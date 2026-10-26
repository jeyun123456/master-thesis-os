// "원본 열기" only ever navigates the user's own browser/app to a URL on an allow-listed host.
// Nothing here builds a link for a specific mail from guesses: callers pass the URL the source stored.

export type SourceKind = 'gmail' | 'school-notice' | 'outlook-web';

const ALLOWED_HOSTS: Record<SourceKind, string[]> = {
  gmail: ['mail.google.com'],
  'school-notice': ['sp.ritsumei.ac.jp'],
  // Only used for the explicit "Outlook 웹 열기" fallback; it never points at a specific message.
  'outlook-web': ['outlook.office.com', 'outlook.office365.com', 'outlook.live.com'],
};

/** Returns a normalized https URL if it is well formed, credential-free and on the allow-list for `kind`; otherwise null. */
export function safeSourceUrl(value: unknown, kind: SourceKind): string | null {
  if (typeof value !== 'string' || !value || value.length > 2000) return null;
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
  if (!ALLOWED_HOSTS[kind].includes(url.hostname.toLowerCase())) return null;
  return url.toString();
}

/** Gmail deep link pinned to one account so a browser signed into several Google accounts opens the right mailbox. */
export function gmailThreadUrl(threadId: string, account: string): string | null {
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(threadId)) return null;
  const thread = encodeURIComponent(threadId);
  if (/^[^@\s]+@[^@\s]+$/.test(account)) return `https://mail.google.com/mail/?authuser=${encodeURIComponent(account)}#all/${thread}`;
  return `https://mail.google.com/mail/u/0/#all/${thread}`;
}

export const OUTLOOK_WEB_HOME = 'https://outlook.office.com/mail/';

/** Fixed app link (no user input): opens the Outlook app at its mailbox. It cannot point at one specific mail. */
export const OUTLOOK_APP_HOME = 'ms-outlook://emails';

/**
 * Hosts that render this page inside their own web view (e.g. a wallpaper app) open normal links inside that view.
 * For them, "microsoft-edge:<https url>" is handed to the OS, which starts Edge outside the view. Only already
 * verified https URLs are wrapped.
 */
export function edgeLaunchUrl(verifiedHttpsUrl: string | null): string | null {
  if (!verifiedHttpsUrl) return null;
  try { if (new URL(verifiedHttpsUrl).protocol !== 'https:') return null; } catch { return null; }
  return `microsoft-edge:${verifiedHttpsUrl}`;
}

export const isEmbeddedWebView = (userAgent: string) => /Sucrose/i.test(userAgent);

/**
 * "chocomint-open:<url>" is a per-user protocol the PC owner installs once (ops/open-in-chrome). Its handler opens only the
 * school portal in Chrome, so the link is offered for that host alone.
 */
export function chromeLaunchUrl(verifiedPortalUrl: string | null): string | null {
  if (!verifiedPortalUrl) return null;
  try { const u = new URL(verifiedPortalUrl); if (u.protocol !== 'https:' || u.hostname !== 'sp.ritsumei.ac.jp') return null; } catch { return null; }
  return `chocomint-open:${verifiedPortalUrl}`;
}
