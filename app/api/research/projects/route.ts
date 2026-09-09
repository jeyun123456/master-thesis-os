import { NextResponse } from 'next/server';
import { getTextFile, getTree, githubConfigured } from '@/lib/github';
import { parseProjectManifest, projectManifestPaths } from '@/lib/projects';

export async function GET() {
  if (!githubConfigured()) {
    return NextResponse.json({ configured: false, items: [] });
  }

  try {
    const tree = await getTree();
    const paths = projectManifestPaths(tree);
    const items = await Promise.all(paths.map(async (path) => parseProjectManifest(await getTextFile(path), path)));
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
