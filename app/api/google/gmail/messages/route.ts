import { NextRequest, NextResponse } from 'next/server';
import { GmailIntegrationError, getGmailMessages, gmailConfigured } from '@/lib/gmail';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const requestedLimit = Number(req.nextUrl.searchParams.get('limit') || 20);
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(50, Math.floor(requestedLimit))) : 20;
  const base = { configured: gmailConfigured(), source: 'gmail' as const };
  if (!base.configured) {
    return NextResponse.json({ ...base, state: 'unconfigured', account: '', items: [] });
  }
  try {
    const result = await getGmailMessages(limit);
    return NextResponse.json({
      ...base,
      state: result.items.length ? 'ready' : 'empty',
      account: result.account,
      items: result.items,
    });
  } catch (error) {
    const errorCode = error instanceof GmailIntegrationError ? error.code : 'network_error';
    const status = errorCode === 'config_missing' ? 503 : 502;
    return NextResponse.json({ ...base, state: 'error', errorCode, account: '', items: [] }, { status });
  }
}
