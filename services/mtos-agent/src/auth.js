import { createHash } from 'node:crypto';

export class AuthError extends Error {}

const CACHE_MS = 60_000;

/**
 * P0 stays the only session authority: a bearer token is valid here exactly
 * when P0 accepts it. Successful checks are cached briefly by token hash so a
 * page load does not hit P0 once per request; failures are never cached.
 */
export function createSessionVerifier({ p0Url = 'http://127.0.0.1:8787', fetchImpl = fetch, now = () => Date.now() } = {}) {
  const base = new URL(p0Url);
  const host = base.hostname.replace(/^\[|\]$/g, '');
  if (base.protocol !== 'http:' || !(host === 'localhost' || host === '::1' || /^127(?:\.\d{1,3}){3}$/.test(host))) {
    throw new Error('MTOS_P0_URL must be a loopback http URL');
  }
  const cache = new Map();
  return async function verify(token) {
    if (typeof token !== 'string' || token.length < 20 || token.length > 500) throw new AuthError('missing token');
    const key = createHash('sha256').update(token).digest('hex');
    const hit = cache.get(key);
    if (hit && hit > now()) return true;
    let response;
    try {
      response = await fetchImpl(new URL('/api/sessions', base), { headers: { authorization: `Bearer ${token}` }, redirect: 'error' });
    } catch {
      throw new AuthError('P0 session service unavailable');
    }
    if (!response.ok) throw new AuthError('invalid session');
    if (cache.size > 100) cache.clear();
    cache.set(key, now() + CACHE_MS);
    return true;
  };
}
