import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getDashboardBundle, validateDashboardDocuments } from './results';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function contributions() {
  return Array.from({ length: 77 }, (_, index) => ({
    code: String(index + 1).padStart(2, '0'),
    name: `sector-${index + 1}`,
    totalChange: 0,
    basketEffect: 0,
    embodiedLabourEffect: 0,
    sourceRow: index + 2,
  }));
}

async function createDashboardFixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'master-thesis-os-results-'));
  temporaryRoots.push(root);
  const directory = path.join(root, 'projects', 'interim-presentation', '코드', '결과', '주요결과', 'dashboard');
  await mkdir(directory, { recursive: true });

  const necessaryLabour = {
    schemaVersion: '1.1.0',
    generatedAt: '2026-09-08T00:00:00.000Z',
    unit: 'hours',
    source: { workbook: '05_constant_value.xlsx', sheet: 'summary', yearRange: 'A2:A4', valueRange: 'B2:B4' },
    methodology: { id: 'necessary-labour', version: '1', priceBasis: '2020', sectorClassification: 'K77' },
    series: [
      { year: 2010, value: 1000, sourceCell: 'B2' },
      { year: 2015, value: 1020, sourceCell: 'B3' },
      { year: 2020, value: 1015.6731234067013, sourceCell: 'B4' },
    ],
  };
  const decomposition = {
    schemaVersion: '1.1.0',
    generatedAt: '2026-09-08T00:00:00.000Z',
    unit: 'hours',
    source: { workbook: '06_decomposition.xlsx', summarySheet: 'summary', summaryRange: 'A2:F4', contributionColumns: 'A:H' },
    methodology: { id: 'two-factor-decomposition', version: '1', priceBasis: '2020', sectorClassification: 'K77' },
    periods: [
      { period: '2010-2015', fromYear: 2010, toYear: 2015, startValue: 1000, endValue: 1020, totalChange: 20, basketEffect: 30, embodiedLabourEffect: -10, residual: 0, sourceRow: 2, contributions: contributions() },
      { period: '2015-2020', fromYear: 2015, toYear: 2020, startValue: 1020, endValue: 1015.6731234067013, totalChange: -4.326876593298721, basketEffect: 8, embodiedLabourEffect: -12.326876593298721, residual: 0, sourceRow: 3, contributions: contributions() },
      { period: '2010-2020', fromYear: 2010, toYear: 2020, startValue: 1000, endValue: 1015.6731234067013, totalChange: 15.673123406701279, basketEffect: 38, embodiedLabourEffect: -22.32687659329872, residual: 0, sourceRow: 4, contributions: contributions() },
    ],
  };
  const validation = {
    schemaVersion: '1.1.0',
    generatedAt: '2026-09-08T00:00:00.000Z',
    scope: 'exporter-only',
    status: 'pass',
    sourceWorkbooks: [],
    checks: [{ id: 'fixture', status: 'pass', message: 'fixture is valid' }],
    limitation: 'test fixture',
  };

  await Promise.all([
    writeFile(path.join(directory, 'necessary_labour.json'), JSON.stringify(necessaryLabour)),
    writeFile(path.join(directory, 'decomposition.json'), JSON.stringify(decomposition)),
    writeFile(path.join(directory, 'validation.json'), JSON.stringify(validation)),
  ]);
  return root;
}

describe('dashboard results loading', () => {
  it('loads valid local repository JSON without depending on an external checkout', async () => {
    const localRepositoryRoot = await createDashboardFixture();
    const bundle = await getDashboardBundle({ preferGithub: false, localRepositoryRoot });
    expect(bundle.source).toBe('local');
    expect(bundle.necessaryLabour?.series.map((item) => item.year)).toEqual([2010, 2015, 2020]);
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
