import { NextRequest, NextResponse } from 'next/server';
import { mobileBearerToken, mobileUnauthorized } from '../../../../../lib/mobile-api';
import { noStore, p0Request } from '../../../../../lib/p0-server';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const token = mobileBearerToken(request);
  if (!token) return mobileUnauthorized();
  try {
    await p0Request('/api/auth/logout', { method: 'POST', token, body: {} });
    return noStore(NextResponse.json({ authenticated: false, serverRevoked: true }));
  } catch {
    // The app wipes its local session regardless; tell it the server copy may still be valid.
    return noStore(NextResponse.json({ authenticated: false, serverRevoked: false }, { status: 502 }));
  }
}
