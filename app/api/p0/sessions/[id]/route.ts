import { NextRequest, NextResponse } from 'next/server';
import { noStore, p0AuthenticatedErrorResponse, p0Request, p0SessionToken, sameOriginMutationError } from '../../../../../lib/p0-server';

export const runtime = 'nodejs';
const safeSessionId = /^[A-Za-z0-9_-]{1,100}$/;

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const originError = sameOriginMutationError(request);
  if (originError) return originError;
  const token = p0SessionToken(request);
  if (!token) return noStore(NextResponse.json({ error: 'P0 로그인이 필요해.' }, { status: 401 }));
  const { id } = await context.params;
  if (!safeSessionId.test(id)) return noStore(NextResponse.json({ error: '기기 세션 ID가 올바르지 않아.' }, { status: 400 }));
  try {
    const result = await p0Request<{ revoked: boolean }>(`/api/sessions/${encodeURIComponent(id)}`, { method: 'DELETE', token });
    return noStore(NextResponse.json(result));
  } catch (error) {
    return p0AuthenticatedErrorResponse(error, '기기 세션을 폐기하지 못했어.');
  }
}
