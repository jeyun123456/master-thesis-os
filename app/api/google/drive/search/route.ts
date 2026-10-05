import { NextRequest, NextResponse } from 'next/server';
import {
  googleDriveConfigured,
  GoogleDriveIntegrationError,
  searchGoogleDriveContent,
} from '@/lib/google-drive';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PRIVATE_RESPONSE = { 'Cache-Control': 'private, no-store' };

export async function GET(req: NextRequest) {
  const query = (req.nextUrl.searchParams.get('q') || '').trim();
  const requestedLimit = Number(req.nextUrl.searchParams.get('limit') || 10);
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(20, Math.floor(requestedLimit))) : 10;
  const base = { configured: googleDriveConfigured(), source: 'google-drive' as const };

  if (!base.configured) {
    return NextResponse.json({ ...base, state: 'unconfigured', items: [] }, { status: 503, headers: PRIVATE_RESPONSE });
  }
  if (query.length < 2 || query.length > 200) {
    return NextResponse.json({ ...base, state: 'error', errorCode: 'provider_bad_request', items: [] }, { status: 400, headers: PRIVATE_RESPONSE });
  }

  try {
    const result = await searchGoogleDriveContent(query, limit);
    return NextResponse.json({
      ...base,
      state: result.items.length ? 'ready' : 'empty',
      ...result,
    }, { headers: PRIVATE_RESPONSE });
  } catch (error) {
    const errorCode = error instanceof GoogleDriveIntegrationError ? error.code : 'network_error';
    const status = errorCode === 'provider_bad_request' ? 400 : 502;
    return NextResponse.json({ ...base, state: 'error', errorCode, items: [] }, { status, headers: PRIVATE_RESPONSE });
  }
}
