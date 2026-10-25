import { NextRequest, NextResponse } from 'next/server';
import { agentServerRequest } from '@/lib/agent-server';
import { decideObsidianWrite, safeNotePath } from '@/lib/obsidian-sync';
import { isRecord, noStore, p0AuthenticatedErrorResponse, P0_APP_SESSION_COOKIE, readJsonLimited, requireP0Session, sameOriginMutationError } from '@/lib/p0-server';
import { readVaultTextIfPresent, VaultConflictError, vaultWritable, writeVaultText } from '@/lib/vault-repository';

export const runtime = 'nodejs';

type Approval = { id: string; kind: string; state: string; payload: Record<string, unknown> };

/**
 * Writes an approved Obsidian change, only if the note is still exactly the
 * version that was reviewed. On any failure the memo stays in the DB and is
 * marked for retry; the approval records why.
 */
export async function POST(request: NextRequest) {
  const originError = sameOriginMutationError(request);
  if (originError) return originError;
  const authError = await requireP0Session(request);
  if (authError) return authError;
  const token = request.cookies.get(P0_APP_SESSION_COOKIE)?.value ?? '';
  try {
    const body = await readJsonLimited(request, 4 * 1024);
    if (!isRecord(body) || typeof body.approval_id !== 'string' || !/^[\w-]{1,200}$/.test(body.approval_id)) {
      return noStore(NextResponse.json({ error: '승인 ID가 필요해.' }, { status: 400 }));
    }
    const { approval } = await agentServerRequest<{ approval: Approval }>(token, `approvals/${body.approval_id}`);
    if (approval.kind !== 'obsidian_write' || (approval.state !== 'approved' && approval.state !== 'failed')) {
      return noStore(NextResponse.json({ error: '승인된 Obsidian 반영만 실행할 수 있어.' }, { status: 409 }));
    }
    const p = approval.payload;
    const path = safeNotePath(p.path);
    const memoId = typeof p.memo_id === 'string' ? p.memo_id : '';
    const finish = (outcome: 'applied' | 'failed' | 'stale', detail = '') =>
      agentServerRequest<{ approval: Approval }>(token, `approvals/${approval.id}/finish`, 'POST', { outcome, detail });
    const markMemo = async (state: 'synced' | 'pending_retry') => {
      if (memoId) await agentServerRequest(token, `memos/${memoId}/obsidian-state`, 'POST', { state }).catch(() => undefined);
    };
    if (!path || typeof p.after_text !== 'string') {
      return noStore(NextResponse.json(await finish('failed', '승인 내용이 올바르지 않아.'), { status: 422 }));
    }
    if (!vaultWritable()) {
      await markMemo('pending_retry');
      return noStore(NextResponse.json(await finish('failed', 'Vault 쓰기 권한이 설정되지 않았어. 메모는 DB에 남아 있어.'), { status: 503 }));
    }
    const decision = decideObsidianWrite(p.mode, p.base_sha, await readVaultTextIfPresent(path));
    if (decision.action === 'stale') {
      await markMemo('pending_retry');
      return noStore(NextResponse.json(await finish('stale', decision.reason), { status: 409 }));
    }
    try {
      await writeVaultText(path, p.after_text, decision.expectedSha, `docs(vault): apply approved memo to ${path}`);
    } catch (error) {
      await markMemo('pending_retry');
      if (error instanceof VaultConflictError) return noStore(NextResponse.json(await finish('stale', '쓰는 순간 노트가 바뀌었어.'), { status: 409 }));
      return noStore(NextResponse.json(await finish('failed', error instanceof Error ? error.message : 'Vault 쓰기 실패'), { status: 502 }));
    }
    await markMemo('synced');
    return noStore(NextResponse.json(await finish('applied')));
  } catch (error) {
    return p0AuthenticatedErrorResponse(error, 'Obsidian 반영에 실패했어.');
  }
}
