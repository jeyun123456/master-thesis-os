import { NextRequest, NextResponse } from 'next/server';
import { isRecord, noStore, p0AuthenticatedErrorResponse, p0Request, p0SessionToken, P0ApiError, readJsonLimited, sameOriginMutationError } from '../../../../../lib/p0-server';

export const runtime = 'nodejs';
const safeId = /^[A-Za-z0-9_-]{1,200}$/;

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const originError = sameOriginMutationError(request);
  if (originError) return originError;
  const token = p0SessionToken(request);
  if (!token) return noStore(NextResponse.json({ error: 'P0 로그인이 필요해.' }, { status: 401 }));
  const { id } = await context.params;
  if (!safeId.test(id)) return noStore(NextResponse.json({ error: '할 일 ID가 올바르지 않아.' }, { status: 400 }));
  let body: unknown;
  try {
    body = await readJsonLimited(request, 64 * 1024);
  } catch (error) {
    if (error instanceof P0ApiError) return p0AuthenticatedErrorResponse(error);
    return noStore(NextResponse.json({ error: '요청 본문은 JSON이어야 해.' }, { status: 400 }));
  }
  if (!isRecord(body) || !Number.isInteger(body.base_version) || !isRecord(body.changes) || !Object.keys(body.changes).length || typeof body.op_id !== 'string' || !body.op_id.trim() || body.op_id.length > 200) {
    return noStore(NextResponse.json({ error: '변경 버전, 내용, 중복 방지 키를 확인해줘.' }, { status: 400 }));
  }
  try {
    const result = await p0Request(`/api/tasks/${encodeURIComponent(id)}`, { method: 'PATCH', token, body });
    return noStore(NextResponse.json(result));
  } catch (error) {
    return p0AuthenticatedErrorResponse(error);
  }
}
