import { NextRequest, NextResponse } from 'next/server';
import { mobileBearerToken, mobileErrorResponse, mobileUnauthorized } from '../../../../../lib/mobile-api';
import { isRecord, noStore, p0Request, P0ApiError, readJsonLimited } from '../../../../../lib/p0-server';

export const runtime = 'nodejs';
const safeId = /^[A-Za-z0-9_-]{1,200}$/;
const opId = /^[A-Za-z0-9._:-]{1,200}$/;

/** Android's HttpURLConnection cannot send PATCH, so the app POSTs with an explicit override header. */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (request.headers.get('x-http-method-override')?.toUpperCase() !== 'PATCH') {
    return noStore(NextResponse.json({ error: '지원하지 않는 요청이야.' }, { status: 405 }));
  }
  return PATCH(request, context);
}

/** The widget may only complete a task; every other field stays web-only. */
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const token = mobileBearerToken(request);
  if (!token) return mobileUnauthorized();
  const { id } = await context.params;
  if (!safeId.test(id)) return noStore(NextResponse.json({ error: '할 일 ID가 올바르지 않아.' }, { status: 400 }));
  let body: unknown;
  try {
    body = await readJsonLimited(request, 4 * 1024);
  } catch (error) {
    return mobileErrorResponse(error, '요청 본문은 JSON이어야 해.');
  }
  if (!isRecord(body) || !Number.isInteger(body.base_version) || typeof body.op_id !== 'string' || !opId.test(body.op_id)
    || !isRecord(body.changes) || Object.keys(body.changes).length !== 1 || body.changes.status !== 'done') {
    return noStore(NextResponse.json({ error: '완료 처리 요청 형식을 확인해줘.' }, { status: 400 }));
  }
  try {
    const result = await p0Request(`/api/tasks/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      token,
      body: { base_version: body.base_version, op_id: body.op_id, changes: { status: 'done' } },
    });
    return noStore(NextResponse.json(result));
  } catch (error) {
    if (error instanceof P0ApiError && error.status === 409) {
      return noStore(NextResponse.json({ error: '다른 기기에서 변경됨', conflict: true }, { status: 409 }));
    }
    return mobileErrorResponse(error, '할 일을 완료하지 못했어.');
  }
}
