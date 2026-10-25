const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://gmail.googleapis.com/gmail/v1/users/me';
// Re-read a little before the last success so a message delivered late is
// not missed; duplicates are dropped by the inbox dedupe key.
const OVERLAP_SECONDS = 2 * 3600;
const FIRST_RUN_LOOKBACK_SECONDS = 3 * 86_400;
const MAX_MESSAGES = 50;

export class MailConfigError extends Error {}

export function gmailConfig(env = process.env) {
  const clientId = env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
  const refreshToken = env.GOOGLE_REFRESH_TOKEN?.trim();
  return clientId && clientSecret && refreshToken ? { clientId, clientSecret, refreshToken } : null;
}

/** Only allow-listed senders are queried; with no list, nothing is collected. */
export function buildQuery(senders, afterEpochSeconds) {
  if (!senders.length) throw new MailConfigError('수집할 발신자가 지정되지 않았어.');
  const quoted = senders.map((s) => (/^[a-z0-9._%+@-]+$/.test(s) ? s : `"${s.replace(/"/g, '')}"`));
  return `from:(${quoted.join(' OR ')}) after:${Math.floor(afterEpochSeconds)}`;
}

const header = (message, name) => message.payload?.headers?.find((h) => h.name?.toLowerCase() === name)?.value ?? '';

export function createGmailCollector({ store, env = process.env, fetchImpl = fetch, now = () => Date.now() }) {
  async function accessToken(config) {
    const response = await fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, refresh_token: config.refreshToken, grant_type: 'refresh_token' }),
    });
    if (!response.ok) throw new MailConfigError(`Google OAuth token refresh failed (${response.status})`);
    const data = await response.json();
    if (typeof data.access_token !== 'string') throw new MailConfigError('Google OAuth response had no access token');
    return data.access_token;
  }

  async function api(token, path) {
    const response = await fetchImpl(`${API}${path}`, { headers: { authorization: `Bearer ${token}` } });
    if (response.status === 401 || response.status === 403) throw new MailConfigError(`Gmail permission denied (${response.status})`);
    if (!response.ok) throw new Error(`Gmail request failed (${response.status})`);
    return response.json();
  }

  /** Incremental: stores new allow-listed messages in the inbox and returns their ids. */
  return async function collectMail() {
    const startedAt = new Date(now()).toISOString();
    const state = store.settings.collector('gmail');
    store.settings.setCollector('gmail', { last_checked_at: startedAt });
    try {
      const config = gmailConfig(env);
      if (!config) throw new MailConfigError('Gmail OAuth 설정(GOOGLE_CLIENT_ID/SECRET/REFRESH_TOKEN)이 없어.');
      const senders = store.settings.mailSenders();
      const since = state.cursor ? Number(state.cursor) - OVERLAP_SECONDS : now() / 1000 - FIRST_RUN_LOOKBACK_SECONDS;
      const token = await accessToken(config);
      const list = await api(token, `/messages?maxResults=${MAX_MESSAGES}&q=${encodeURIComponent(buildQuery(senders, since))}`);
      const newItemIds = [];
      for (const { id: messageId } of list.messages ?? []) {
        if (typeof messageId !== 'string' || !/^[A-Za-z0-9]+$/.test(messageId)) continue;
        const message = await api(token, `/messages/${messageId}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`);
        const received = Number(message.internalDate) || now();
        const { item, duplicate } = store.inbox.capture({
          text: `제목: ${header(message, 'subject')}\n보낸 사람: ${header(message, 'from')}\n\n${message.snippet ?? ''}`.slice(0, 20000),
          dedupe_key: `gmail:${messageId}`,
          source_ref: `gmail:${messageId}`,
          source_url: `https://mail.google.com/mail/u/0/#all/${messageId}`,
          received_at: new Date(received).toISOString(),
        }, 'gmail');
        if (!duplicate) newItemIds.push(item.id);
      }
      store.settings.setCollector('gmail', { last_success_at: startedAt, cursor: String(Math.floor(now() / 1000)), last_error: null });
      return { fetched: (list.messages ?? []).length, newItemIds };
    } catch (error) {
      store.settings.setCollector('gmail', { last_error: String(error.message).slice(0, 500) });
      throw error;
    }
  };
}
