import { NextRequest, NextResponse } from 'next/server';
import { isValidStageValue, parseProjectManifest, updateProjectStageMarkdown } from '@/lib/projects';
import { VaultConflictError, readVaultText, resolveVaultProjectPath, vaultConfigured, vaultWritable, writeVaultText } from '@/lib/vault-repository';

export const runtime = 'nodejs';

export async function PATCH(request: NextRequest) {
  if (!vaultConfigured() || !vaultWritable()) return NextResponse.json({ configured: false, error: 'Vault write access is not configured' }, { status: 503 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Request body must be valid JSON' }, { status: 400 }); }
  if (!isRecord(body) || typeof body.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(body.id) || !isValidStageValue(body.stage)) {
    return NextResponse.json({ error: 'A valid project id and a single-line stage are required' }, { status: 400 });
  }
  try {
    const projectPath = await resolveVaultProjectPath(body.id, { writable: true });
    const current = await readVaultText(projectPath);
    if (typeof body.sha === 'string' && body.sha && body.sha !== current.sha) return NextResponse.json({ error: 'project.md changed. Reload the project before saving again.' }, { status: 409 });
    const markdown = updateProjectStageMarkdown(current.text, body.stage);
    const saved = await writeVaultText(projectPath, markdown, current.sha, `chore(research): update ${body.id} stage`);
    return NextResponse.json({ configured: true, source: saved.source, project: { ...parseProjectManifest(markdown, projectPath), sourceSha: saved.sha }, sha: saved.sha });
  } catch (error) {
    if (error instanceof VaultConflictError) return NextResponse.json({ error: 'project.md changed. Reload the project before saving again.' }, { status: 409 });
    return NextResponse.json({ configured: true, error: error instanceof Error ? error.message : 'Project stage update failed' }, { status: 502 });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
