import { NextRequest, NextResponse } from 'next/server';
import { buildMobileWidget, mobileBearerToken, mobileErrorResponse, mobileUnauthorized } from '../../../../lib/mobile-api';
import { noStore } from '../../../../lib/p0-server';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const token = mobileBearerToken(request);
  if (!token) return mobileUnauthorized();
  try {
    return noStore(NextResponse.json(await buildMobileWidget(token)));
  } catch (error) {
    return mobileErrorResponse(error, '위젯 데이터를 불러오지 못했어.');
  }
}
