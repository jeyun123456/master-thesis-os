import { NextResponse } from 'next/server';
import { parseProjectManifest } from '@/lib/projects';
import { readVaultText, vaultConfigured, vaultProjectManifestPaths } from '@/lib/vault-repository';

export async function GET() {
  if (!vaultConfigured()) {
    return NextResponse.json({ configured: false, items: [] });
  }

  try {
    const paths = await vaultProjectManifestPaths();
    const items = await Promise.all(paths.map(async (path) => {
      const file = await readVaultText(path);
      return { ...parseProjectManifest(file.text, path), sourceSha: file.sha };
    }));
    items.sort((a, b) => {
      const statusRank = (value: string) => value === 'writing' ? 0 : value === 'active' ? 1 : value === 'blocked' ? 2 : value === 'waiting' ? 3 : value === 'paused' ? 4 : 5;
      const priorityRank = (value: string) => value === 'high' ? 0 : value === 'medium' ? 1 : 2;
      return statusRank(a.status) - statusRank(b.status) || priorityRank(a.priority) - priorityRank(b.priority) || a.title.localeCompare(b.title, 'ko');
    });
    return NextResponse.json({ configured: true, items });
  } catch (error) {
    return NextResponse.json({ configured: true, items: [], error: String(error) }, { status: 502 });
  }
}
