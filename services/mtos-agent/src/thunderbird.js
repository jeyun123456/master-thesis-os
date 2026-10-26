import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, join } from 'node:path';

/**
 * Read-only access to a Thunderbird profile: finds the school account from
 * prefs.js and walks its mbox folders. Thunderbird itself keeps syncing; this
 * module never writes to the profile and never touches credentials.
 */

const CHUNK = 32 * 1024 * 1024;
const FROM_LINE = /^From \S+ .{0,80}$/;
// System folders that hold mail the user sent or discarded, not incoming school mail.
const EXCLUDED_FOLDER = /^(sent|sent items|sent mail|drafts?|outbox|trash|deleted items|junk|junk e-?mail|spam|rss.*|conversation history|sync issues|templates)$|보낸|보낼|임시|삭제|정크|스팸|동기화 문제|대화 내용|RSS|送信|下書き|ごみ箱|迷惑|削除/i;
const NO_AI_FOLDER = /광고|프로모션|promo|advert/i;

const decodePref = (value) => value.replace(/\\"/g, '"').replace(/\\\\/g, '\\');

export function readPrefs(profileDir) {
  const prefs = new Map();
  const file = join(profileDir, 'prefs.js');
  if (!existsSync(file)) return prefs;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^user_pref\("([^"]+)",\s*(.*)\);\s*$/.exec(line);
    if (!m) continue;
    const raw = m[2].trim();
    prefs.set(m[1], raw.startsWith('"') ? decodePref(raw.slice(1, -1)) : raw);
  }
  return prefs;
}

/** Profile dir: explicit env, else the install's default profile from profiles.ini. */
export function resolveProfile(env = process.env) {
  if (env.MTOS_THUNDERBIRD_PROFILE) return env.MTOS_THUNDERBIRD_PROFILE;
  const root = join(env.APPDATA ?? '', 'Thunderbird');
  const ini = join(root, 'profiles.ini');
  if (!existsSync(ini)) return null;
  const sections = new Map();
  let current = null;
  for (const line of readFileSync(ini, 'utf8').split(/\r?\n/)) {
    const header = /^\[(.+)\]$/.exec(line.trim());
    if (header) { current = {}; sections.set(header[1], current); continue; }
    const kv = /^([^=]+)=(.*)$/.exec(line.trim());
    if (kv && current) current[kv[1]] = kv[2];
  }
  const profiles = [...sections.entries()].filter(([name]) => /^Profile/.test(name)).map(([, v]) => v);
  const install = [...sections.entries()].find(([name]) => /^Install/.test(name))?.[1]?.Default;
  const pick = (install && profiles.find((p) => p.Path === install)) ?? profiles.find((p) => p.Default === '1') ?? profiles[0];
  if (!pick) return null;
  return pick.IsRelative === '1' ? join(root, pick.Path) : pick.Path;
}

/**
 * Accounts whose address/host belongs to the school domain. Anything else
 * (Gmail, local folders, RSS) is ignored so only school mail is ever collected.
 */
export function findSchoolAccounts(profileDir, { domains }) {
  const prefs = readPrefs(profileDir);
  const wanted = domains.map((d) => d.trim().toLowerCase()).filter(Boolean);
  const accounts = [];
  for (const [key, type] of prefs) {
    const m = /^mail\.server\.(server\d+)\.type$/.exec(key);
    if (!m || !['graph', 'imap', 'pop3'].includes(type)) continue;
    const id = m[1];
    const get = (name) => prefs.get(`mail.server.${id}.${name}`) ?? '';
    const address = (get('name') || get('userName')).toLowerCase();
    const hostname = get('hostname').toLowerCase();
    if (/gmail|googlemail/.test(`${address} ${hostname}`)) continue;
    if (!wanted.some((d) => address.endsWith(`@${d}`) || address.endsWith(`.${d}`))) continue;
    const rel = get('directory-rel');
    const dir = rel.startsWith('[ProfD]') ? join(profileDir, rel.slice(7)) : get('directory');
    if (dir && existsSync(dir)) accounts.push({ accountId: address, serverId: id, type, dir });
  }
  return accounts;
}

/** mbox folder files under an account directory (recursing into `.sbd` subfolders). */
export function listFolders(accountDir) {
  const folders = [];
  const visit = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.endsWith('.sbd')) {
        visit(join(dir, entry.name), `${prefix}${entry.name.slice(0, -4)}/`);
        continue;
      }
      if (!entry.isFile() || /\.(msf|dat|json|bak)$/i.test(entry.name)) continue;
      const name = `${prefix}${entry.name}`;
      if (EXCLUDED_FOLDER.test(entry.name) || EXCLUDED_FOLDER.test(prefix.replace(/\/$/, '').split('/').pop() ?? '')) continue;
      folders.push({ folderId: name, file: join(dir, entry.name), noAi: NO_AI_FOLDER.test(name) });
    }
  };
  visit(accountDir, '');
  return folders;
}

export function fileFingerprint(file) {
  const fd = openSync(file, 'r');
  try {
    const buf = Buffer.alloc(512);
    const n = readSync(fd, buf, 0, 512, 0);
    return { size: statSync(file).size, head: createHash('sha1').update(buf.subarray(0, n)).digest('hex') };
  } finally { closeSync(fd); }
}

/**
 * Calls `onMessage(rawMessage, startOffset)` for each mbox message at or after
 * `fromOffset`. Returns the start offset of the last message (re-read next time
 * so a half-written message is completed) as { aligned, lastStart }; aligned is
 * false when `fromOffset` is not on a message boundary (caller rescans from 0).
 */
export function scanMbox(file, fromOffset, onMessage) {
  const fd = openSync(file, 'r');
  try {
    const size = statSync(file).size;
    let pos = fromOffset;
    let carry = Buffer.alloc(0);
    let carryStart = fromOffset;
    let lastStart = null;
    let first = true;
    const startsIn = (buf) => {
      const starts = [];
      const isFrom = (at) => {
        const eol = buf.indexOf(0x0a, at);
        return eol !== -1 && FROM_LINE.test(buf.toString('latin1', at, eol).replace(/\r$/, ''));
      };
      if (buf.length > 5 && buf.toString('latin1', 0, 5) === 'From ' && isFrom(0)) starts.push(0);
      let at = buf.indexOf('\nFrom ');
      while (at !== -1) {
        if (isFrom(at + 1)) starts.push(at + 1);
        at = buf.indexOf('\nFrom ', at + 1);
      }
      return starts;
    };
    const emit = (buf, starts, finalChunk) => {
      const complete = finalChunk ? starts.length : starts.length - 1;
      for (let i = 0; i < complete; i += 1) {
        const bodyStart = buf.indexOf(0x0a, starts[i]) + 1;
        const end = i + 1 < starts.length ? starts[i + 1] - 1 : buf.length;
        onMessage(buf.subarray(bodyStart, Math.max(bodyStart, end)), carryStart + starts[i]);
      }
      lastStart = starts.length ? carryStart + starts[starts.length - 1] : lastStart;
      return complete;
    };
    for (;;) {
      const len = Math.min(CHUNK, size - pos);
      const chunk = Buffer.alloc(Math.max(len, 0));
      if (len > 0) readSync(fd, chunk, 0, len, pos);
      pos += Math.max(len, 0);
      const buf = carry.length ? Buffer.concat([carry, chunk]) : chunk;
      const starts = startsIn(buf);
      if (first) {
        first = false;
        if (fromOffset > 0 && buf.length && starts[0] !== 0) return { aligned: false, lastStart: null };
      }
      const finalChunk = pos >= size;
      const done = emit(buf, starts, finalChunk);
      if (finalChunk) return { aligned: true, lastStart };
      if (done === 0) { carry = buf; continue; }
      carry = buf.subarray(starts[done]);
      carryStart += starts[done];
    }
  } finally { closeSync(fd); }
}

export const folderLabel = (file) => basename(file);
