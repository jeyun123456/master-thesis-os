import { NextRequest, NextResponse } from 'next/server';
import {
  clearP0SessionCookie,
  noStore,
  p0ErrorResponse,
  p0Request,
  p0SessionToken,
  setP0SessionCookie,
  P0ApiError,
  readJsonLimited,
  sameOriginMutationError,
} from '../../../../lib/p0-server';

export const runtime = 'nodejs';

type P0Config = { google_client_id?: string };
type P0Login = { token?: string; session_id?: string };

export async function GET(request: NextRequest) {
  try {
    const config = await p0Request<P0Config>('/api/config');
    const token = p0SessionToken(request);
    let authenticated = false;
    let staleToken = false;
    if (token) {
      try {
        await p0Request('/api/tasks', { token });
        authenticated = true;
      } catch (error) {
        if (!(error instanceof P0ApiError) || error.status !== 401) throw error;
        staleToken = true;
      }
    }
    const response = NextResponse.json({
      configured: typeof config.google_client_id === 'string' && Boolean(config.google_client_id),
      googleClientId: config.google_client_id || null,
      authenticated,
    });
    return staleToken ? clearP0SessionCookie(response) : noStore(response);
  } catch (error) {
    return p0ErrorResponse(error, 'P0 인증 상태를 확인하지 못했어.');
  }
}

export async function POST(request: NextRequest) {
  const originError = sameOriginMutationError(request);
  if (originError) return originError;
  let body: unknown;
  try {
    body = await readJsonLimited(request, 16 * 1024);
  } catch (error) {
    if (error instanceof P0ApiError) return p0ErrorResponse(error);
    return noStore(NextResponse.json({ error: 'Google 로그인 응답을 읽지 못했어.' }, { status: 400 }));
  }
  if (!body || typeof body !== 'object' || Array.isArray(body) || typeof (body as Record<string, unknown>).id_token !== 'string' || ((body as Record<string, string>).id_token.length < 20 || (body as Record<string, string>).id_token.length > 12000)) {
    return noStore(NextResponse.json({ error: '유효한 Google 로그인 응답이 필요해.' }, { status: 400 }));
  }
  try {
    const result = await p0Request<P0Login>('/api/auth/google', {
      method: 'POST',
      body: { id_token: (body as Record<string, string>).id_token, device_label: 'Master Thesis OS' },
    });
    if (!result.token) throw new P0ApiError(502, 'P0 로그인 응답에 세션이 없어.');
    return setP0SessionCookie(NextResponse.json({ authenticated: true }), result.token);
  } catch (error) {
    return p0ErrorResponse(error, 'P0 로그인에 실패했어.');
  }
}

export async function DELETE(request: NextRequest) {
  const originError = sameOriginMutationError(request);
  if (originError) return originError;
  const token = p0SessionToken(request);
  let revoked = false;
  if (token) {
    try {
      await p0Request('/api/auth/logout', { method: 'POST', token, body: {} });
      revoked = true;
    } catch {
      // Always clear the browser cookie; a server outage must not strand the UI session.
    }
  }
  return clearP0SessionCookie(NextResponse.json({ authenticated: false, serverRevoked: revoked }));
}
