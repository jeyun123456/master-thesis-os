import { NextRequest, NextResponse } from 'next/server';
import { appendProjectTaskMarkdown, parseProjectManifest } from '@/lib/projects';
import { VaultConflictError, readVaultText, resolveVaultProjectPath, vaultConfigured, vaultWritable, writeVaultText } from '@/lib/vault-repository';

export const runtime = 'nodejs';

export async function PATCH(request: NextRequest) {
  if (!vaultConfigured() || !vaultWritable()) return NextResponse.json({ configured: false, error: 'Vault write access is not configured' }, { status: 503 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Request body must be valid JSON' }, { status: 400 }); }
  if (!isRecord(body) || typeof body.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(body.id) || typeof body.title !== 'string' || !body.title.trim() || body.title.length > 1200) {
    return NextResponse.json({ error: 'A valid project id and task title are required' }, { status: 400 });
  }
  try {
    const path = await resolveVaultProjectPath(body.id, { writable: true });
    const current = await readVaultText(path);
    if (typeof body.sha === 'string' && body.sha && body.sha !== current.sha) return conflictResponse();
    const result = appendProjectTaskMarkdown(current.text, body.title);
    if (!result.added) return NextResponse.json({ configured: true, project: { ...parseProjectManifest(result.markdown, path), sourceSha: current.sha }, sha: current.sha, added: false });
    const saved = await writeVaultText(path, result.markdown, current.sha, `chore(research): add next task to ${body.id}`);
    return NextResponse.json({ configured: true, project: { ...parseProjectManifest(result.markdown, path), sourceSha: saved.sha }, sha: saved.sha, added: true });
  } catch (error) {
    if (error instanceof VaultConflictError) return conflictResponse();
    const status = error instanceof Error && error.message.includes('not found') ? 404 : error instanceof Error && error.message.includes('characters') ? 400 : 502;
    return NextResponse.json({ configured: true, error: error instanceof Error ? error.message : 'Project task update failed' }, { status });
  }
}

function conflictResponse() {
  return NextResponse.json({ error: 'project.md changed. Reload the project before adding the task again.' }, { status: 409 });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
