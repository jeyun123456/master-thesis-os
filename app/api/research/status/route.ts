import { NextRequest, NextResponse } from 'next/server';
import { getTextFile, githubConfigured } from '@/lib/github';
import { parseResearchStatus } from '@/lib/research-status';
import { requireP0Session } from '@/lib/p0-server';

const STATUS_PATH = 'wiki/current_status.md';

export async function GET(request: NextRequest) {
  const authError = await requireP0Session(request);
  if (authError) return authError;
  if (!githubConfigured()) {
    return NextResponse.json({ configured: false, status: null });
  }

  try {
    const markdown = await getTextFile(STATUS_PATH);
    return NextResponse.json({ configured: true, status: parseResearchStatus(markdown, STATUS_PATH) });
  } catch (error) {
    return NextResponse.json(
      { configured: true, status: null, error: String(error) },
      { status: 502 },
    );
  }
}
