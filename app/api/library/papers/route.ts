import { NextRequest, NextResponse } from 'next/server';
import { getFile, githubConfigured } from '@/lib/github';
import { parsePaperIndex } from '@/lib/library';
import { requireP0Session } from '@/lib/p0-server';

const DEFAULT_INDEX_PATH = '연구/문헌/논문 리스트.md';

export async function GET(request: NextRequest) {
  const authError = await requireP0Session(request);
  if (authError) return authError;
  if (!githubConfigured()) return NextResponse.json({ configured: false, sourcePath: DEFAULT_INDEX_PATH, items: [] });

  const sourcePath = process.env.GITHUB_PAPER_INDEX_PATH || DEFAULT_INDEX_PATH;
  try {
    const file = await getFile(sourcePath);
    if (Array.isArray(file) || !('decoded' in file) || typeof file.decoded !== 'string') {
      throw new Error('논문 인덱스를 텍스트로 읽을 수 없습니다.');
    }
    return NextResponse.json({ configured: true, sourcePath, items: parsePaperIndex(file.decoded) });
  } catch (error) {
    return NextResponse.json({ configured: true, sourcePath, items: [], error: String(error) }, { status: 502 });
  }
}
