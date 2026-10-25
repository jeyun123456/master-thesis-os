import { NextRequest, NextResponse } from 'next/server';
import { isRecord, noStore, p0AuthenticatedErrorResponse, p0Request, p0SessionToken, P0ApiError, readJsonLimited, sameOriginMutationError } from '../../../../../lib/p0-server';

export const runtime = 'nodejs';
const safeId = /^[A-Za-z0-9_-]{1,200}$/;

export async function POST(request: NextRequest) {
  const originError = sameOriginMutationError(request);
  if (originError) return originError;
  const token = p0SessionToken(request);
  if (!token) return noStore(NextResponse.json({ error: 'P0 로그인이 필요해.' }, { status: 401 }));

  let body: unknown;
  try {
    body = await readJsonLimited(request, 64 * 1024);
  } catch (error) {
    if (error instanceof P0ApiError) return p0AuthenticatedErrorResponse(error);
    return noStore(NextResponse.json({ error: '요청 본문은 JSON이어야 해.' }, { status: 400 }));
  }
  if (!isRecord(body) || (body.all !== true && (!Array.isArray(body.ids) || body.ids.length > 500 || body.ids.some((id) => typeof id !== 'string' || !safeId.test(id))))) {
    return noStore(NextResponse.json({ error: '읽음 처리할 할 일 목록을 확인해줘.' }, { status: 400 }));
  }
  try {
    const result = await p0Request('/api/tasks/seen', { method: 'POST', token, body });
    return noStore(NextResponse.json(result));
  } catch (error) {
    return p0AuthenticatedErrorResponse(error);
  }
}
