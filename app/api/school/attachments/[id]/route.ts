import { NextResponse, type NextRequest } from 'next/server';
import { agentBaseUrl } from '../../../../../lib/agent-server';
import { noStore, P0_APP_SESSION_COOKIE, serviceFetch } from '../../../../../lib/p0-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Streams a stored mail/notice attachment from the server, only for a signed-in user. Always a download, never rendered. */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!/^[A-Za-z0-9-]{1,64}$/.test(id)) return noStore(NextResponse.json({ error: '알 수 없는 첨부파일이야.' }, { status: 404 }));
  const token = request.cookies.get(P0_APP_SESSION_COOKIE)?.value || '';
  if (!token) return noStore(NextResponse.json({ error: '로그인이 필요해.' }, { status: 401 }));
  let base: URL | null;
  try { base = agentBaseUrl(); } catch { base = null; }
  if (!base) return noStore(NextResponse.json({ error: 'AI·연구 데이터 서버(MTOS_AGENT_URL)가 설정되지 않았어.' }, { status: 503 }));
  let response: Response;
  try {
    response = await serviceFetch(new URL(`/agent/api/school/attachments/${id}`, base), { method: 'GET', headers: new Headers({ authorization: `Bearer ${token}` }) }, 'AI·연구 데이터 서버에 연결할 수 없어.');
  } catch {
    return noStore(NextResponse.json({ error: 'AI·연구 데이터 서버에 연결할 수 없어.' }, { status: 503 }));
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({})) as { error?: string };
    return noStore(NextResponse.json({ error: data.error ?? '첨부파일을 가져오지 못했어.' }, { status: response.status === 500 ? 502 : response.status }));
  }
  return new NextResponse(response.body, {
    status: 200,
    headers: {
      'content-type': 'application/octet-stream',
      'content-disposition': response.headers.get('content-disposition') ?? 'attachment',
      'x-content-type-options': 'nosniff',
      'cache-control': 'no-store',
    },
  });
}
