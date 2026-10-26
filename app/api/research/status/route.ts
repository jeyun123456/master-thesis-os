import { NextRequest, NextResponse } from 'next/server';
import { GitHubApiError, getTextFile, getTree, githubConfigured } from '@/lib/github';
import { parseResearchStatus } from '@/lib/research-status';
import { requireP0Session } from '@/lib/p0-server';

const STATUS_PATH = '02_Projects/Master_필요노동과_노동력재생산/project.md';

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
    // GitHub also answers 404 for a private repo the token cannot read, so only treat
    // it as "file missing" when the repository tree itself is readable.
    if (error instanceof GitHubApiError && error.status === 404 && await getTree().then(() => true, () => false)) {
      return NextResponse.json({ configured: true, status: null });
    }
    return NextResponse.json(
      { configured: true, status: null, error: String(error) },
      { status: 502 },
    );
  }
}
