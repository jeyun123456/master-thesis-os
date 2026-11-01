import { NextRequest, NextResponse } from 'next/server';
import { isRecord, noStore, p0ErrorResponse, p0Request, P0ApiError, readJsonLimited } from '../../../../../lib/p0-server';

export const runtime = 'nodejs';

type P0Login = { token?: string; session_id?: string };

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await readJsonLimited(request, 16 * 1024);
  } catch (error) {
    return p0ErrorResponse(error, 'Google 로그인 응답을 읽지 못했어.');
  }
  if (!isRecord(body) || typeof body.id_token !== 'string' || body.id_token.length < 20 || body.id_token.length > 12000) {
    return noStore(NextResponse.json({ error: '유효한 Google 로그인 응답이 필요해.' }, { status: 400 }));
  }
  const deviceLabel = typeof body.device_label === 'string'
    ? body.device_label.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 100) || 'Chocomint Lab · Android'
    : 'Chocomint Lab · Android';
  try {
    const result = await p0Request<P0Login>('/api/auth/google', {
      method: 'POST',
      body: { id_token: body.id_token, device_label: deviceLabel },
    });
    if (!result.token) throw new P0ApiError(502, 'P0 로그인 응답에 세션이 없어.');
    return noStore(NextResponse.json({
      authenticated: true,
      token: result.token,
      ...(result.session_id ? { sessionId: result.session_id } : {}),
    }));
  } catch (error) {
    return p0ErrorResponse(error, 'P0 로그인에 실패했어.');
  }
}
