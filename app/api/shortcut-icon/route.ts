import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

const STEAM_API = 'https://store.steampowered.com/api/appdetails';
const REQUEST_TIMEOUT_MS = 5000;

export async function GET(request: NextRequest) {
  const appId = request.nextUrl.searchParams.get('appId')?.trim() || '';
  if (!/^\d{1,10}$/.test(appId)) {
    return NextResponse.json({ error: 'Invalid Steam app id' }, { status: 400 });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${STEAM_API}?appids=${appId}&l=english&cc=us`, {
      headers: { Accept: 'application/json' },
      cache: 'force-cache',
      signal: controller.signal,
    });
    if (!response.ok) return NextResponse.json({ icon: null }, { status: 502 });

    const payload: unknown = await response.json();
    const entry = isRecord(payload) && isRecord(payload[appId]) ? payload[appId] : null;
    const data = entry && isRecord(entry.data) ? entry.data : null;
    const icon = data
      ? [data.header_image, data.capsule_image, data.capsule_imagev5].find(isSafeSteamIcon)
      : null;
    if (!icon) return NextResponse.json({ icon: null }, { status: 404 });

    return NextResponse.json(
      { icon },
      { headers: { 'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400' } },
    );
  } catch {
    return NextResponse.json({ icon: null }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}

function isSafeSteamIcon(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname.toLowerCase().endsWith('.steamstatic.com') && url.pathname.includes('/apps/');
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
