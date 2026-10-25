import { NextRequest, NextResponse } from 'next/server';
import { getProjectResultsBundle } from '@/lib/project-results-loader';
import { isSafeRepositoryPath } from '@/lib/repository';
import { requireP0Session } from '@/lib/p0-server';

export async function GET(request: NextRequest) {
  const authError = await requireP0Session(request);
  if (authError) return authError;
  const requestedPath = request.nextUrl.searchParams.get('path') || '';
  const normalizedPath = requestedPath.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!normalizedPath || !isSafeRepositoryPath(normalizedPath)) {
    return NextResponse.json({ error: 'Invalid project results path' }, { status: 400 });
  }
  return NextResponse.json(await getProjectResultsBundle(normalizedPath));
}
