import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { materializeConfiguredDatasets, type ProjectResultManifest } from './project-results-loader';
import type { ResultDataSource } from './results-data';

const temporaryRoots: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  for (const root of temporaryRoots.splice(0)) await rm(root, { recursive: true, force: true });
});

function dataset(sourceId: string, name: string, sheetName: string | null) {
  return {
    id: `${sourceId}:${name}`,
    sourceId,
    name,
    sheetName,
    suggestedKind: 'table' as const,
    columns: [{ id: 'c0', label: 'year' }, { id: 'c1', label: 'value' }],
    rows: [[2020, 1]],
  };
}

describe('standard project result loader', () => {
  it('maps scalar and matrix sources to configured dataset ids and sheets', () => {
    const manifest: ProjectResultManifest = {
      version: 1,
      projectId: 'thesis',
      sources: [
        { id: 'scalar', file: 'sources/scalar.csv', format: 'csv' },
        { id: 'matrix', file: 'sources/matrix.xlsx', format: 'xlsx' },
      ],
      datasets: [
        { id: 'metrics', sourceId: 'scalar', kind: 'metrics' },
        { id: 'trend', sourceId: 'matrix', sheet: 'chart_trend', kind: 'chart' },
      ],
    };
    const sources = new Map<string, ResultDataSource>([
      ['scalar', { id: 'scalar', name: 'scalar.csv', format: 'csv', datasets: [dataset('scalar', 'scalar', null)] }],
      ['matrix', { id: 'matrix', name: 'matrix.xlsx', format: 'xlsx', datasets: [dataset('matrix', 'chart_trend', 'chart_trend')] }],
    ]);

    const loaded = materializeConfiguredDatasets(manifest, sources);
    expect(loaded.map((item) => [item.id, item.kind, item.sheetName])).toEqual([
      ['metrics', 'metrics', null],
      ['trend', 'chart', 'chart_trend'],
    ]);
  });

  it('fails when a configured matrix sheet is missing', () => {
    const manifest: ProjectResultManifest = {
      version: 1,
      sources: [{ id: 'matrix', file: 'sources/matrix.xlsx', format: 'xlsx' }],
      datasets: [{ id: 'trend', sourceId: 'matrix', sheet: 'missing', kind: 'chart' }],
    };
    const sources = new Map<string, ResultDataSource>([
      ['matrix', { id: 'matrix', name: 'matrix.xlsx', format: 'xlsx', datasets: [dataset('matrix', 'other', 'other')] }],
    ]);

    expect(() => materializeConfiguredDatasets(manifest, sources)).toThrow('sheet=missing');
  });

  it('loads a standard result bundle from a local Vault checkout', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'master-thesis-os-results-'));
    temporaryRoots.push(root);
    const resultRoot = path.join(root, 'projects', 'demo', 'results');
    await mkdir(path.join(resultRoot, 'sources'), { recursive: true });
    await writeFile(path.join(resultRoot, 'result.json'), JSON.stringify({
      version: 1,
      projectId: 'demo',
      sources: [{ id: 'scalar', file: 'sources/scalar.csv', format: 'csv' }],
      datasets: [{ id: 'metrics', sourceId: 'scalar', kind: 'metrics' }],
    }), 'utf8');
    await writeFile(path.join(resultRoot, 'view.json'), JSON.stringify({
      version: 1,
      items: [{ type: 'metric', datasetId: 'metrics', row: 0, label: '첫 결과' }],
    }), 'utf8');
    await writeFile(path.join(resultRoot, 'sources', 'scalar.csv'), 'name,value\nfirst,12.5\n', 'utf8');

    vi.resetModules();
    vi.stubEnv('GITHUB_OWNER', 'invalid/owner');
    vi.stubEnv('GITHUB_REPO', 'invalid/repo/extra');
    vi.stubEnv('GITHUB_REPOSITORY', 'invalid/repository/extra');
    vi.stubEnv('LOCAL_REPOSITORY_ROOT', root);
    const { getProjectResultsBundle } = await import('./project-results-loader');
    const bundle = await getProjectResultsBundle('projects/demo/results');

    expect(bundle.source).toBe('local');
    expect(bundle.projectId).toBe('demo');
    expect(bundle.datasets).toHaveLength(1);
    expect(bundle.datasets[0]).toMatchObject({ id: 'metrics', kind: 'metrics', rows: [['first', 12.5]] });
    expect(bundle.view?.items[0]).toMatchObject({ type: 'metric', datasetId: 'metrics' });
  });
});
