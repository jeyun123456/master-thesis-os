import { NextRequest, NextResponse } from 'next/server';
import { noStore, p0AuthenticatedErrorResponse, p0Request, p0SessionToken } from '../../../../lib/p0-server';

export const runtime = 'nodejs';

type P0SessionList = {
  current: string;
  sessions: Array<{ id: string; device_label: string; created_at: string; expires_at: string; revoked: boolean }>;
};

export async function GET(request: NextRequest) {
  const token = p0SessionToken(request);
  if (!token) return noStore(NextResponse.json({ error: 'P0 로그인이 필요해.' }, { status: 401 }));
  try {
    const sessions = await p0Request<P0SessionList>('/api/sessions', { token });
    return noStore(NextResponse.json({
      ...sessions,
      sessions: sessions.sessions.map((session) => ({ ...session, revoked: Boolean(session.revoked) })),
    }));
  } catch (error) {
    return p0AuthenticatedErrorResponse(error, 'P0 기기 세션을 불러오지 못했어.');
  }
}
