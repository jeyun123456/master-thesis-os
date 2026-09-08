import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getDashboardBundle, validateDashboardDocuments } from './results';

describe('dashboard results loading', () => {
  it('loads the generated local repository JSON', async () => {
    const bundle = await getDashboardBundle({
      preferGithub: false,
      localRepositoryRoot: path.resolve(process.cwd(), '..'),
    });
    expect(bundle.source).toBe('local');
    expect(bundle.necessaryLabour?.series.map(item => item.year)).toEqual([2010, 2015, 2020]);
    expect(bundle.decomposition?.periods[1].totalChange).toBeCloseTo(-4.326876593298721, 10);
    expect(bundle.validation?.status).toBe('pass');
  });

  it('returns an explicit empty state when JSON files are missing', async () => {
    const bundle = await getDashboardBundle({
      preferGithub: false,
      localRepositoryRoot: process.cwd(),
      resultsPath: 'does-not-exist',
    });
    expect(bundle.source).toBe('empty');
    expect(bundle.necessaryLabour).toBeNull();
    expect(bundle.error).toBe('Dashboard JSON is missing, invalid, or has a non-passing validation status.');
  });

  it('rejects malformed or non-passing document bundles', () => {
    expect(() => validateDashboardDocuments([
      { schemaVersion: '1.1.0', series: [] },
      { schemaVersion: '1.1.0', periods: [] },
      { schemaVersion: '1.1.0', scope: 'exporter-only', status: 'fail', checks: [] },
    ])).toThrow();
  });
});
