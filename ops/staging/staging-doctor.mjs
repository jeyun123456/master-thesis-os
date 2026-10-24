#!/usr/bin/env node
import { resolve, relative, isAbsolute, dirname } from 'node:path';
import { isIP } from 'node:net';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const p0Root = resolve(repoRoot, '..', 'master-thesis-os-p0', 'tools', 'master-thesis-os-p0');
const mode = process.argv.includes('--p0') ? 'p0' : 'next';
const preflight = process.argv.includes('--preflight');
const failures = [];

function report(label, ok, detail = '') {
  const state = ok ? 'PASS' : 'BLOCK';
  console.log(`${state} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(label);
}

function isInside(root, candidate) {
  const rel = relative(resolve(root), resolve(candidate));
  return rel === '' || (!rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && rel !== '..' && !isAbsolute(rel));
}

function validOrigin(value) {
  if (!value) return false;
  try {
    const url = new URL(value);
    const placeholder = /(^|\.)example\.(?:com|net|org)$/i.test(url.hostname) || /\.(?:invalid|test)$/i.test(url.hostname);
    return url.protocol === 'https:' && isIP(url.hostname) === 0 && !placeholder
      && !url.username && !url.password && !url.search && !url.hash
      && (url.pathname === '/' || url.pathname === '')
      && (value === url.origin || value === `${url.origin}/`);
  } catch {
    return false;
  }
}

function validLocalP0Url(value) {
  try {
    const url = new URL(value || 'http://127.0.0.1:8787');
    return url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.port === '8787'
      && (url.pathname === '/' || url.pathname === '') && !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
}

async function checkP0Endpoint(base) {
  try {
    const response = await fetch(new URL('/api/config', base), { signal: AbortSignal.timeout(3000), cache: 'no-store' });
    const data = await response.json().catch(() => null);
    const configured = Boolean(data && typeof data.google_client_id === 'string' && data.google_client_id);
    report('P0 loopback API responds', response.ok);
    report('P0 Google Web client is configured', response.ok && configured);
  } catch {
    report('P0 loopback API responds', false, 'start P0 separately on 127.0.0.1:8787');
  }
}

if (mode === 'next') {
  report('Next.js Node runtime is 22.x', /^v22\./.test(process.version), `current major ${process.versions.node.split('.')[0]}`);
  report('MTOS_PUBLIC_ORIGIN is a non-placeholder HTTPS origin', validOrigin(process.env.MTOS_PUBLIC_ORIGIN?.trim()));
  const p0Base = process.env.P0_API_URL?.trim() || 'http://127.0.0.1:8787';
  report('P0_API_URL is restricted to 127.0.0.1:8787', validLocalP0Url(p0Base));
  if (validLocalP0Url(p0Base)) await checkP0Endpoint(p0Base);
  if (!preflight) {
    const port = process.env.PORT?.trim() || '3000';
    const localUrl = `http://127.0.0.1:${port}`;
    try {
      const response = await fetch(`${localUrl}/api/p0/session`, { signal: AbortSignal.timeout(3000), cache: 'no-store' });
      const data = await response.json().catch(() => null);
      report('Next.js P0 session route responds locally', response.ok && Boolean(data && typeof data.configured === 'boolean'));
      report('Next.js sees P0 OAuth configured', response.ok && data?.configured === true);
    } catch {
      report('Next.js P0 session route responds locally', false, 'start the local production server first');
    }
  }
} else {
  report('P0 Node runtime is 24 or newer', Number(process.versions.node.split('.')[0]) >= 24, `current major ${process.versions.node.split('.')[0]}`);
  report('P0 binds to its loopback service port', (process.env.PORT?.trim() || '8787') === '8787');
  report('Google Web client ID is present', Boolean(process.env.GOOGLE_CLIENT_ID?.trim()));
  report('Allowed Google sub is present', Boolean(process.env.ALLOWED_GOOGLE_SUB?.trim()));
  report('Backup key has 32-byte hex shape', /^[0-9a-fA-F]{64}$/.test(process.env.MTOS_BACKUP_KEY || ''));
  const dbPath = process.env.MTOS_DB_PATH?.trim() || '';
  const backupDir = process.env.MTOS_BACKUP_DIR?.trim() || '';
  const pathsAreAbsolute = Boolean(dbPath && backupDir && isAbsolute(dbPath) && isAbsolute(backupDir));
  const pathsAreConcrete = !/replace|example/i.test(`${dbPath} ${backupDir}`);
  report('P0 database path is explicit, concrete, and outside both repositories', pathsAreAbsolute && pathsAreConcrete
    && !isInside(p0Root, dbPath) && !isInside(repoRoot, dbPath));
  const backupIsSeparate = pathsAreAbsolute && pathsAreConcrete
    && !isInside(p0Root, backupDir) && !isInside(repoRoot, backupDir)
    && !isInside(dirname(dbPath), backupDir) && !isInside(backupDir, dirname(dbPath));
  report('Encrypted backup directory is outside repositories and separate from the DB', backupIsSeparate);
}

console.log(`Summary: ${failures.length ? `${failures.length} blocker(s)` : 'all checks passed'}`);
process.exitCode = failures.length ? 1 : 0;
