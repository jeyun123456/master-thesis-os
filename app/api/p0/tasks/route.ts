import { NextRequest, NextResponse } from 'next/server';
import { isRecord, noStore, p0AuthenticatedErrorResponse, p0Request, p0SessionToken, P0ApiError, readJsonLimited, sameOriginMutationError } from '../../../../lib/p0-server';

export const runtime = 'nodejs';
const categories = new Set(['research', 'school', 'personal']);
const safeId = /^[A-Za-z0-9_-]{1,200}$/;

export async function GET(request: NextRequest) {
  const token = p0SessionToken(request);
  if (!token) return noStore(NextResponse.json({ error: 'P0 로그인이 필요해.' }, { status: 401 }));
  try {
    const result = await p0Request('/api/tasks', { token });
    return noStore(NextResponse.json(result));
  } catch (error) {
    return p0AuthenticatedErrorResponse(error);
  }
}

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
  if (!isRecord(body) || typeof body.id !== 'string' || !safeId.test(body.id) || typeof body.op_id !== 'string' || !body.op_id.trim() || body.op_id.length > 200 || !isRecord(body.fields) || typeof body.fields.title !== 'string' || !body.fields.title.trim() || body.fields.title.length > 500) {
    return noStore(NextResponse.json({ error: '할 일 ID, 중복 방지 키, 제목을 확인해줘.' }, { status: 400 }));
  }
  if (body.fields.category !== undefined && !categories.has(String(body.fields.category))) {
    return noStore(NextResponse.json({ error: '할 일 분류가 올바르지 않아.' }, { status: 400 }));
  }
  if (body.fields.due_date !== undefined && body.fields.due_date !== null && (typeof body.fields.due_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.fields.due_date))) {
    return noStore(NextResponse.json({ error: '기한은 YYYY-MM-DD 형식이어야 해.' }, { status: 400 }));
  }
  try {
    const result = await p0Request('/api/tasks', { method: 'POST', token, body });
    return noStore(NextResponse.json(result, { status: 201 }));
  } catch (error) {
    return p0AuthenticatedErrorResponse(error);
  }
}
