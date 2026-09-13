import { describe, expect, it } from 'vitest';
import { materializeConfiguredDatasets, type ProjectResultManifest } from './project-results-loader';
import type { ResultDataSource } from './results-data';

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
});