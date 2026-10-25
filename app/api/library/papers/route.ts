import { NextRequest, NextResponse } from 'next/server';
import { readVaultText, vaultConfigured } from '@/lib/vault-repository';
import { parsePaperIndex } from '@/lib/library';
import { requireP0Session } from '@/lib/p0-server';

const DEFAULT_INDEX_PATH = '03_Knowledge/sources/literature/논문 리스트.md';

export async function GET(request: NextRequest) {
  const authError = await requireP0Session(request);
  if (authError) return authError;
  if (!vaultConfigured()) return NextResponse.json({ configured: false, sourcePath: DEFAULT_INDEX_PATH, items: [] });

  const sourcePath = process.env.GITHUB_PAPER_INDEX_PATH || DEFAULT_INDEX_PATH;
  try {
    const file = await readVaultText(sourcePath);
    return NextResponse.json({ configured: true, sourcePath, items: parsePaperIndex(file.text) });
  } catch (error) {
    return NextResponse.json({ configured: true, sourcePath, items: [], error: String(error) }, { status: 502 });
  }
}
