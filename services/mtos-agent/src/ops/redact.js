// Command lines and paths are shown to the admin dashboard, never stored raw:
// anything that looks like a credential is masked and the result is length-capped.
const MASK = '***';
const SECRET_WORD = '(?:token|secret|password|passwd|pwd|passphrase|api[-_]?key|apikey|access[-_]?key|auth(?:orization)?|cookie|credential|bearer|session)';

const FLAG_VALUE = new RegExp(`(--?[\\w-]*${SECRET_WORD}[\\w-]*)(\\s*[=:]\\s*|\\s+)("[^"]*"|'[^']*'|\\S+)`, 'gi');
const KEY_VALUE = new RegExp(`\\b([\\w-]*${SECRET_WORD}[\\w-]*)=("[^"]*"|'[^']*'|[^\\s;&]+)`, 'gi');
const BEARER = /\b(Bearer|Basic)\s+[\w.~+/=-]{8,}/gi;
const URL_USERINFO = /(\b[a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+:[^/\s@]+@/gi;
const URL_QUERY = /(\bhttps?:\/\/[^\s"'?#]+)\?[^\s"']*/gi;
const URL_PATH_TOKEN = /(\bhttps?:\/\/[^\s"'/]+\/(?:[^\s"'/]+\/)*?)([A-Za-z0-9_-]{24,})(?=[/\s"']|$)/gi;
const ENCODED_COMMAND = /(-e(?:nc(?:odedcommand)?)?\s+)[A-Za-z0-9+/=]{20,}/gi;
const OPAQUE = /\b(?:[A-Fa-f0-9]{32,}|[A-Za-z0-9_+/=-]{40,})\b/g;
// "C:\Users\<name>" and the MSYS form "/c/Users/<name>"
const USER_DIR = /((?:[A-Za-z]:|\/[A-Za-z])[\\/]Users[\\/])[^\\/\s"']+/gi;

export function redactCommandLine(input, max = 220, { maskUser = true } = {}) {
  if (typeof input !== 'string' || !input) return '';
  let out = input
    .replace(ENCODED_COMMAND, `$1${MASK}`)
    .replace(URL_USERINFO, `$1${MASK}@`)
    .replace(URL_QUERY, `$1?${MASK}`)
    .replace(URL_PATH_TOKEN, `$1${MASK}`)
    .replace(BEARER, `$1 ${MASK}`)
    .replace(FLAG_VALUE, `$1$2${MASK}`)
    .replace(KEY_VALUE, `$1=${MASK}`)
    .replace(OPAQUE, MASK)
    .replace(/\s+/g, ' ')
    .trim();
  if (maskUser) out = out.replace(USER_DIR, '$1~');
  if (out.length > max) out = `${out.slice(0, max - 1)}…`;
  return out;
}

/** Paths are kept as-is except the Windows user folder name, which is not needed to identify a program. */
export function safePath(input, max = 200) {
  if (typeof input !== 'string' || !input) return null;
  const out = input.replace(USER_DIR, '$1~');
  return out.length > max ? `${out.slice(0, max - 1)}…` : out;
}
