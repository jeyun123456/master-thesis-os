import { NextRequest, NextResponse } from 'next/server';
import { isRecord, noStore, p0AuthenticatedErrorResponse, p0Request, p0SessionToken, readJsonLimited, sameOriginMutationError } from '../../../../../../lib/p0-server';

export const runtime = 'nodejs';

/** Final user choice for a P0 field conflict: keep the server value or apply the preserved device value. */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const originError = sameOriginMutationError(request);
  if (originError) return originError;
  const token = p0SessionToken(request);
  if (!token) return noStore(NextResponse.json({ error: 'P0 로그인이 필요해.' }, { status: 401 }));
  const { id } = await context.params;
  if (!/^\d{1,12}$/.test(id)) return noStore(NextResponse.json({ error: '충돌 ID가 올바르지 않아.' }, { status: 400 }));
  try {
    const body = await readJsonLimited(request, 1024);
    if (!isRecord(body) || (body.choice !== 'server' && body.choice !== 'client')) {
      return noStore(NextResponse.json({ error: '선택은 server 또는 client여야 해.' }, { status: 400 }));
    }
    return noStore(NextResponse.json(await p0Request(`/api/conflicts/${id}/resolve`, { method: 'POST', token, body: { choice: body.choice } })));
  } catch (error) {
    return p0AuthenticatedErrorResponse(error, '충돌을 해결하지 못했어.');
  }
}
