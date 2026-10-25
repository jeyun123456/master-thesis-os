import { NextRequest, NextResponse } from 'next/server';
import { agentServerRequest } from '@/lib/agent-server';
import { safeNotePath } from '@/lib/obsidian-sync';
import { isRecord, noStore, p0AuthenticatedErrorResponse, P0_APP_SESSION_COOKIE, readJsonLimited, requireP0Session, sameOriginMutationError } from '@/lib/p0-server';
import { readVaultTextIfPresent, vaultConfigured } from '@/lib/vault-repository';

export const runtime = 'nodejs';

/**
 * Reads the target note server-side (text + SHA) and queues an AI merge job.
 * Nothing is written here; the job produces an approval to review.
 */
export async function POST(request: NextRequest) {
  const originError = sameOriginMutationError(request);
  if (originError) return originError;
  const authError = await requireP0Session(request);
  if (authError) return authError;
  if (!vaultConfigured()) return noStore(NextResponse.json({ error: 'Vault 연결이 설정되지 않았어.', code: 'vault_unconfigured' }, { status: 503 }));
  try {
    const body = await readJsonLimited(request, 64 * 1024);
    const path = isRecord(body) ? safeNotePath(body.path) : null;
    const mode = isRecord(body) ? body.mode : null;
    if (!isRecord(body) || !path || typeof body.memo_id !== 'string' || !['append', 'section', 'new'].includes(String(mode))) {
      return noStore(NextResponse.json({ error: '메모, 노트 경로(.md), 반영 방식을 확인해줘.' }, { status: 400 }));
    }
    const token = request.cookies.get(P0_APP_SESSION_COOKIE)?.value ?? '';
    const { memos } = await agentServerRequest<{ memos: Array<{ id: string; body: string }> }>(token, 'memos');
    const memo = memos.find((m) => m.id === body.memo_id);
    if (!memo) return noStore(NextResponse.json({ error: '메모를 찾을 수 없어.' }, { status: 404 }));
    const current = await readVaultTextIfPresent(path);
    if (mode === 'new' && current) return noStore(NextResponse.json({ error: '같은 경로에 노트가 이미 있어. 추가나 수정 방식을 골라줘.' }, { status: 409 }));
    if (mode !== 'new' && !current) return noStore(NextResponse.json({ error: '기존 노트를 찾을 수 없어. 새 노트 만들기를 골라줘.' }, { status: 404 }));
    const result = await agentServerRequest(token, 'jobs', 'POST', {
      type: 'obsidian_merge',
      input: { path, base_sha: current?.sha ?? null, current_text: current?.text ?? '', memo_id: memo.id, memo_text: memo.body, mode },
    });
    return noStore(NextResponse.json(result, { status: 201 }));
  } catch (error) {
    return p0AuthenticatedErrorResponse(error, 'Obsidian 반영 제안을 만들지 못했어.');
  }
}
