import { NextRequest, NextResponse } from 'next/server';
import { parseShortcutMarkdown, serializeShortcutMarkdown } from '@/lib/shortcut-markdown';
import { parseShortcuts, shortcuts } from '@/lib/shortcuts';
import { VaultConflictError, readVaultTextIfPresent, vaultConfigured, vaultWritable, writeVaultText } from '@/lib/vault-repository';

export const runtime = 'nodejs';

const SHORTCUTS_PATH = 'shared/shortcuts.md';

export async function GET() {
  if (!vaultConfigured()) {
    return NextResponse.json({ configured: false, source: 'fallback', path: SHORTCUTS_PATH, items: shortcuts, writable: false });
  }

  try {
    const file = await readVaultTextIfPresent(SHORTCUTS_PATH);
    if (!file) {
      return NextResponse.json({ configured: true, source: 'fallback', path: SHORTCUTS_PATH, items: shortcuts, writable: canWriteVault(), missing: true });
    }
    if (!file.text.includes('master-thesis-os:shortcuts:start') || !file.text.includes('master-thesis-os:shortcuts:end')) {
      throw new Error(`Shortcut Markdown markers are missing: ${SHORTCUTS_PATH}`);
    }
    const items = parseShortcutMarkdown(file.text);
    return NextResponse.json({ configured: true, source: file.source, path: SHORTCUTS_PATH, items, sha: file.sha, writable: canWriteVault() });
  } catch (error) {
    return NextResponse.json({ configured: true, source: 'error', path: SHORTCUTS_PATH, items: [], writable: canWriteVault(), error: errorMessage(error) }, { status: 502 });
  }
}

export async function PUT(request: NextRequest) {
  if (!vaultConfigured()) return NextResponse.json({ configured: false, error: 'Vault repository is not configured' }, { status: 503 });
  if (!canWriteVault()) return NextResponse.json({ configured: true, error: 'Vault write access is not configured' }, { status: 503 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON' }, { status: 400 });
  }
  if (!isRecord(body) || !Array.isArray(body.items)) {
    return NextResponse.json({ error: 'items must be an array' }, { status: 400 });
  }

  const items = parseShortcuts(body.items);
  if (items.length !== body.items.length) {
    return NextResponse.json({ error: 'items contains an invalid shortcut' }, { status: 400 });
  }
  const requestedSha = typeof body.sha === 'string' && body.sha ? body.sha : undefined;

  try {
    const current = await readVaultTextIfPresent(SHORTCUTS_PATH);
    if (current && requestedSha !== current.sha) return conflictResponse();
    if (!current && requestedSha) return conflictResponse();
    const markdown = serializeShortcutMarkdown(items, current?.text || '');
    const saved = await writeVaultText(SHORTCUTS_PATH, markdown, current?.sha, 'chore(shortcuts): update Master Thesis OS shortcuts');
    return NextResponse.json({ configured: true, source: saved.source, path: SHORTCUTS_PATH, items, sha: saved.sha, writable: true });
  } catch (error) {
    if (error instanceof VaultConflictError) return conflictResponse();
    return NextResponse.json({ configured: true, error: errorMessage(error) }, { status: 502 });
  }
}

function canWriteVault() {
  return vaultWritable();
}

function conflictResponse() {
  return NextResponse.json({ error: 'Shortcut file changed. Reload it before saving again.' }, { status: 409 });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Shortcut request failed';
}
