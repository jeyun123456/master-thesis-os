import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const FRONT = /^---\r?\n([\s\S]*?)\r?\n---/;

function frontmatter(text) {
  const out = {};
  for (const line of (FRONT.exec(text)?.[1] ?? '').split(/\r?\n/)) {
    const m = /^([A-Za-z_]+):\s*(.*)$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
  return out;
}

/** Unchecked `- [ ]` items under the "Next" heading of a project.md. */
function nextActions(text) {
  const out = [];
  let inside = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^##\s/.test(line)) { inside = /^##\s+Next/.test(line); continue; }
    const item = inside ? /^\s*-\s\[ \]\s+(.+)$/.exec(line)?.[1]?.trim() : null;
    if (item) out.push(item.slice(0, 300));
  }
  return out;
}

/**
 * Reads Chocomint-Lab `02_Projects/<dir>/project.md`. `version` changes
 * whenever the file content changes, so unchanged projects are skipped.
 */
export async function readChocomintProjects(root) {
  const base = join(root, '02_Projects');
  const dirs = await readdir(base, { withFileTypes: true }).catch(() => []);
  const projects = [];
  for (const dir of dirs.filter((d) => d.isDirectory())) {
    const text = await readFile(join(base, dir.name, 'project.md'), 'utf8').catch(() => null);
    if (text === null) continue;
    const meta = frontmatter(text);
    if (!meta.id) continue;
    projects.push({
      id: meta.id, title: meta.title ?? dir.name, status: meta.status ?? '', path: `02_Projects/${dir.name}/project.md`,
      next_actions: nextActions(text), version: createHash('sha1').update(text).digest('hex').slice(0, 16),
    });
  }
  return projects;
}
