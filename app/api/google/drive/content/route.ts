import { NextRequest, NextResponse } from 'next/server';
import {
  getGoogleDriveFileContent,
  googleDriveConfigured,
  GoogleDriveIntegrationError,
} from '@/lib/google-drive';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PRIVATE_RESPONSE = { 'Cache-Control': 'private, no-store' };

export async function GET(req: NextRequest) {
  const fileId = (req.nextUrl.searchParams.get('fileId') || '').trim();
  const base = { configured: googleDriveConfigured(), source: 'google-drive' as const };

  if (!base.configured) {
    return NextResponse.json({ ...base, state: 'unconfigured' }, { status: 503, headers: PRIVATE_RESPONSE });
  }
  if (!fileId) {
    return NextResponse.json({ ...base, state: 'error', errorCode: 'provider_bad_request' }, { status: 400, headers: PRIVATE_RESPONSE });
  }

  try {
    const result = await getGoogleDriveFileContent(fileId);
    return NextResponse.json({ ...base, state: 'ready', ...result }, { headers: PRIVATE_RESPONSE });
  } catch (error) {
    const errorCode = error instanceof GoogleDriveIntegrationError ? error.code : 'network_error';
    const status = errorCode === 'unsupported_content'
      ? 415
      : errorCode === 'provider_bad_request'
        ? 400
        : 502;
    return NextResponse.json({ ...base, state: 'error', errorCode }, { status, headers: PRIVATE_RESPONSE });
  }
}
