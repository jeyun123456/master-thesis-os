import { NextRequest, NextResponse } from 'next/server';
import { projectStatusValues, parseProjectManifest, updateProjectStatusMarkdown } from '@/lib/projects';
import { VaultConflictError, readVaultText, vaultConfigured, vaultWritable, writeVaultText } from '@/lib/vault-repository';

export const runtime = 'nodejs';

const allowedStatuses = new Set<string>(projectStatusValues);

export async function PATCH(request: NextRequest) {
  if (!vaultConfigured()) return NextResponse.json({ configured: false, error: 'Vault repository is not configured' }, { status: 503 });
  if (!vaultWritable()) return NextResponse.json({ configured: true, error: 'Vault write access is not configured' }, { status: 503 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON' }, { status: 400 });
  }
  if (!isRecord(body) || typeof body.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(body.id)) {
    return NextResponse.json({ error: 'A valid project id is required' }, { status: 400 });
  }
  if (typeof body.status !== 'string' || !allowedStatuses.has(body.status)) {
    return NextResponse.json({ error: 'Unsupported project status' }, { status: 400 });
  }
  const projectPath = `projects/${body.id}/project.md`;
  const requestedSha = typeof body.sha === 'string' && body.sha ? body.sha : undefined;

  try {
    const current = await readVaultText(projectPath);
    if (requestedSha && requestedSha !== current.sha) return conflictResponse();
    const markdown = updateProjectStatusMarkdown(current.text, body.status);
    const saved = await writeVaultText(projectPath, markdown, current.sha, `chore(research): update ${body.id} project status`);
    return NextResponse.json({ configured: true, source: saved.source, project: { ...parseProjectManifest(markdown, projectPath), sourceSha: saved.sha }, sha: saved.sha });
  } catch (error) {
    if (error instanceof VaultConflictError) return conflictResponse();
    const status = error instanceof Error && error.message.includes('not found') ? 404 : 502;
    return NextResponse.json({ configured: true, error: errorMessage(error) }, { status });
  }
}

function conflictResponse() {
  return NextResponse.json({ error: 'project.md changed. Reload the project before saving again.' }, { status: 409 });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Project status update failed';
}
