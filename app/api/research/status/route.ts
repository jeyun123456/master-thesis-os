import { NextResponse } from 'next/server';
import { readVaultText, vaultConfigured } from '@/lib/vault-repository';
import { parseResearchStatus } from '@/lib/research-status';

const STATUS_PATH = '02_Projects/thesis/project.md';

export async function GET() {
  if (!vaultConfigured()) {
    return NextResponse.json({ configured: false, status: null });
  }

  try {
    const file = await readVaultText(STATUS_PATH);
    const markdown = file.text;
    return NextResponse.json({ configured: true, status: parseResearchStatus(markdown, STATUS_PATH) });
  } catch (error) {
    return NextResponse.json(
      { configured: true, status: null, error: String(error) },
      { status: 502 },
    );
  }
}
