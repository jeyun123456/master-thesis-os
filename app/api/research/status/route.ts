import { NextResponse } from 'next/server';
import { getTextFile, githubConfigured } from '@/lib/github';
import { parseResearchStatus } from '@/lib/research-status';

const STATUS_PATH = 'wiki/current_status.md';

export async function GET() {
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
