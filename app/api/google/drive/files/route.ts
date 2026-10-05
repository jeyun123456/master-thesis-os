import { NextRequest, NextResponse } from 'next/server';
import {
  getGoogleDriveFiles,
  googleDriveConfigured,
  GoogleDriveIntegrationError,
} from '@/lib/google-drive';

export const runtime = 'nodejs';\nexport const dynamic = 'force-dynamic';\n\nconst PRIVATE_RESPONSE = { 'Cache-Control': 'private, no-store' };

export async function GET(req: NextRequest) {
  const requestedLimit = Number(req.nextUrl.searchParams.get('limit') || 30);
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(100, Math.floor(requestedLimit))) : 30;
  const base = { configured: googleDriveConfigured(), source: 'google-drive' as const };

  if (!base.configured) {
    return NextResponse.json({ ...base, state: 'unconfigured', items: [] }, { headers: PRIVATE_RESPONSE });
  }

  try {
    const items = await getGoogleDriveFiles(limit);
    return NextResponse.json({ ...base, state: items.length ? 'ready' : 'empty', items }, { headers: PRIVATE_RESPONSE });
  } catch (error) {
    const errorCode = error instanceof GoogleDriveIntegrationError ? error.code : 'network_error';
    return NextResponse.json({ ...base, state: 'error', errorCode, items: [] }, { status: 502, headers: PRIVATE_RESPONSE });
  }
}
