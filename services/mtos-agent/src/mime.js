/**
 * Minimal RFC 5322 / MIME reader for Thunderbird mbox messages (no dependencies).
 * Reads bytes only; nothing here writes to or changes the mailbox.
 */

const decoderFor = (charset) => {
  const label = String(charset || 'utf-8').trim().toLowerCase().replace(/^"|"$/g, '');
  try { return new TextDecoder(label === 'unicode-1-1-utf-7' ? 'utf-8' : label); } catch { return new TextDecoder('utf-8'); }
};
const decode = (buffer, charset) => decoderFor(charset).decode(buffer);

export function splitHeaderBody(buffer) {
  const crlf = buffer.indexOf('\r\n\r\n');
  const lf = buffer.indexOf('\n\n');
  let end = -1;
  let gap = 0;
  if (crlf !== -1 && (lf === -1 || crlf < lf)) { end = crlf; gap = 4; } else if (lf !== -1) { end = lf; gap = 2; }
  if (end === -1) return { header: buffer, body: Buffer.alloc(0) };
  return { header: buffer.subarray(0, end), body: buffer.subarray(end + gap) };
}

/** Header name (lowercase) -> list of unfolded raw values, in order. */
export function parseHeaders(headerBuffer) {
  const text = headerBuffer.toString('latin1').replace(/\r?\n[ \t]+/g, ' ');
  const out = new Map();
  for (const line of text.split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const name = line.slice(0, idx).trim().toLowerCase();
    if (!/^[a-z0-9-]+$/.test(name)) continue;
    const list = out.get(name) ?? [];
    list.push(line.slice(idx + 1).trim());
    out.set(name, list);
  }
  return out;
}

const first = (headers, name) => headers.get(name)?.[0] ?? '';

/** RFC 2047 encoded-word decoding; raw header values are latin1 byte strings. */
export function decodeWords(raw) {
  const bytes = Buffer.from(raw, 'latin1');
  const asText = bytes.toString('latin1');
  if (!/=\?[^?]+\?[bBqQ]\?[^?]*\?=/.test(asText)) {
    // Bare 8-bit header: most mail clients send UTF-8.
    const utf8 = bytes.toString('utf8');
    return utf8.includes('�') ? asText : utf8;
  }
  const merged = asText.replace(/(\?=)\s+(=\?)/g, '$1$2');
  return merged.replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g, (_, charset, enc, data) => {
    const chunk = enc.toLowerCase() === 'b'
      ? Buffer.from(data, 'base64')
      : Buffer.from(data.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (__, h) => String.fromCharCode(parseInt(h, 16))), 'latin1');
    return decode(chunk, charset.split('*')[0]);
  });
}

function params(value) {
  const [main, ...rest] = value.split(';');
  const out = {};
  const star = {};
  for (const part of rest.join(';').match(/[A-Za-z0-9*-]+\s*=\s*(?:"[^"]*"|[^;]*)/g) ?? []) {
    const eq = part.indexOf('=');
    const key = part.slice(0, eq).trim().toLowerCase();
    const val = part.slice(eq + 1).trim().replace(/^"|"$/g, '');
    if (key.endsWith('*') || /\*\d+\*?$/.test(key)) {
      const base = key.replace(/\*\d*\*?$/, '');
      (star[base] ??= []).push([key, val]);
    } else out[key] = val;
  }
  for (const [base, parts] of Object.entries(star)) {
    const joined = parts.sort((a, b) => a[0].localeCompare(b[0], 'en', { numeric: true })).map(([, v]) => v).join('');
    const m = /^([^']*)'[^']*'(.*)$/.exec(joined);
    out[base] = m ? decode(Buffer.from(m[2].replace(/%([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))), 'latin1'), m[1]) : joined;
  }
  return { value: main.trim().toLowerCase(), params: out };
}

function decodeTransfer(body, encoding) {
  switch (String(encoding).trim().toLowerCase()) {
    case 'base64': return Buffer.from(body.toString('latin1').replace(/[^A-Za-z0-9+/=]/g, ''), 'base64');
    case 'quoted-printable': {
      const text = body.toString('latin1').replace(/=\r?\n/g, '');
      return Buffer.from(text.replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))), 'latin1');
    }
    default: return body;
  }
}

const htmlToText = (html) => html
  .replace(/<(style|script)[\s\S]*?<\/\1>/gi, '')
  .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, '\n')
  .replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
  .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

function walk(buffer, ctx, depth = 0) {
  const { header, body } = splitHeaderBody(buffer);
  const headers = parseHeaders(header);
  const type = params(first(headers, 'content-type') || 'text/plain');
  const disposition = params(first(headers, 'content-disposition'));
  if (type.value.startsWith('multipart/') && type.params.boundary && depth < 8) {
    const marker = `--${type.params.boundary}`;
    const text = body.toString('latin1');
    let pos = text.indexOf(marker);
    while (pos !== -1) {
      const afterMarker = pos + marker.length;
      if (text.startsWith('--', afterMarker)) break;
      const lineEnd = text.indexOf('\n', afterMarker);
      if (lineEnd === -1) break;
      const next = text.indexOf(`\n${marker}`, lineEnd);
      let end = next === -1 ? text.length : next;
      if (text[end - 1] === '\r') end -= 1;
      if (end >= lineEnd + 1) walk(body.subarray(lineEnd + 1, end), ctx, depth + 1);
      pos = next === -1 ? -1 : next + 1;
    }
    return;
  }
  const data = decodeTransfer(body, first(headers, 'content-transfer-encoding'));
  const filename = disposition.params.filename ?? type.params.name;
  const isAttachment = disposition.value === 'attachment' || Boolean(filename) || type.value === 'message/rfc822' || !/^text\/(plain|html)$/.test(type.value);
  if (!isAttachment) {
    const text = decode(data, type.params.charset);
    if (type.value === 'text/html') ctx.html.push(text); else ctx.text.push(text);
    return;
  }
  if (type.value.startsWith('multipart/')) return;
  ctx.attachments.push({
    filename: filename ? decodeWords(Buffer.from(filename, 'utf8').toString('latin1')) : `attachment-${ctx.attachments.length + 1}`,
    mime: type.value, data, inline: disposition.value === 'inline', contentId: first(headers, 'content-id').replace(/[<>]/g, '') || null,
  });
}

/** Delivery time from the topmost Received header (the receiving server's own stamp), or null. */
function receivedAtOf(headers) {
  const top = headers.get('received')?.[0] ?? '';
  const ms = Date.parse(top.slice(top.lastIndexOf(';') + 1).trim().replace(/\s*\([^)]*\)\s*$/, ''));
  return top.includes(';') && !Number.isNaN(ms) ? new Date(ms).toISOString() : null;
}

const addresses = (raw) => decodeWords(raw).replace(/\s+/g, ' ').trim();

/** Parse a raw RFC822 message into the fields the school mail store keeps. */
export function parseMessage(raw) {
  const { header } = splitHeaderBody(raw);
  const headers = parseHeaders(header);
  const ctx = { text: [], html: [], attachments: [] };
  walk(raw, ctx);
  const html = ctx.html.join('\n');
  const text = ctx.text.join('\n').trim() || (html ? htmlToText(html) : '');
  const dateHeader = first(headers, 'date');
  const parsed = dateHeader ? Date.parse(dateHeader.replace(/\s*\([^)]*\)\s*$/, '')) : NaN;
  const mozStatus = parseInt(first(headers, 'x-mozilla-status') || '0', 16) || 0;
  return {
    messageId: first(headers, 'message-id').replace(/[<>\s]/g, '') || null,
    subject: decodeWords(first(headers, 'subject')),
    from: addresses(first(headers, 'from')),
    to: addresses((headers.get('to') ?? []).join(', ')),
    cc: addresses((headers.get('cc') ?? []).join(', ')),
    sentAt: Number.isNaN(parsed) ? null : new Date(parsed).toISOString(),
    receivedAt: receivedAtOf(headers),
    bodyText: text,
    bodyHtml: html || null,
    attachments: ctx.attachments,
    read: Boolean(mozStatus & 1),
    unsubscribe: Boolean(first(headers, 'list-unsubscribe')),
  };
}

/** Date header only, from the first bytes of a message (cheap age check before a full parse). */
export function headerDate(head) {
  const headers = parseHeaders(splitHeaderBody(head).header);
  const raw = first(headers, 'date');
  const ms = raw ? Date.parse(raw.replace(/\s*\([^)]*\)\s*$/, '')) : NaN;
  return Number.isNaN(ms) ? null : ms;
}
