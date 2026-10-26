import { NextRequest, NextResponse } from 'next/server';
import { GmailIntegrationError, getGmailMessageDetail, gmailConfigured } from '@/lib/gmail';
import { requireP0Session } from '@/lib/p0-server';

export const runtime = 'nodejs';

/** One Gmail message for the detail drawer. Read-only: it never touches labels, so Gmail's unread state stays as it was. */
export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const authError = await requireP0Session(req);
  if (authError) return authError;
  const { id } = await context.params;
  if (!gmailConfigured()) return NextResponse.json({ state: 'unconfigured' }, { status: 503, headers: { 'cache-control': 'no-store' } });
  try {
    const { account, message } = await getGmailMessageDetail(id);
    return NextResponse.json({ account, message }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    const errorCode = error instanceof GmailIntegrationError ? error.code : 'network_error';
    const status = errorCode === 'provider_bad_request' ? 400 : errorCode === 'config_missing' ? 503 : 502;
    return NextResponse.json({ state: 'error', errorCode }, { status, headers: { 'cache-control': 'no-store' } });
  }
}
