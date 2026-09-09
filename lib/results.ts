import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { getJsonFile, githubConfigured } from './github';

export type NecessaryLabourDashboard = {
  schemaVersion: '1.1.0'; generatedAt: string; unit: 'hours';
  source: { workbook: string; sheet: string; yearRange: string; valueRange: string };
  methodology: { id: string; version: string; priceBasis: string; sectorClassification: string };
  series: Array<{ year: number; value: number; sourceCell: string }>;
};

export type SectorContribution = {
  code: string; name: string; totalChange: number; basketEffect: number;
  embodiedLabourEffect: number; sourceRow: number;
};

export type DecompositionPeriod = {
  period: string; fromYear: number; toYear: number; startValue: number; endValue: number;
  totalChange: number; basketEffect: number; embodiedLabourEffect: number; residual: number;
  sourceRow: number; contributions: SectorContribution[];
};

export type DecompositionDashboard = {
  schemaVersion: '1.1.0'; generatedAt: string; unit: 'hours';
  source: { workbook: string; summarySheet: string; summaryRange: string; contributionColumns: string };
  methodology: { id: string; version: string; priceBasis: string; sectorClassification: string };
  periods: DecompositionPeriod[];
};

export type ValidationDashboard = {
  schemaVersion: '1.1.0'; generatedAt: string; scope: 'exporter-only';
  status: 'pass' | 'fail' | 'warning';
  sourceWorkbooks: Array<{ path: string; sha256: string }>;
  checks: Array<{ id: string; status: 'pass' | 'fail' | 'warning'; message: string }>;
  limitation: string;
};

export type DashboardBundle = {
  source: 'github' | 'local' | 'empty';
  necessaryLabour: NecessaryLabourDashboard | null;
  decomposition: DecompositionDashboard | null;
  validation: ValidationDashboard | null;
  error?: string;
};

const defaultResultsPath = 'projects/interim-presentation/코드/결과/주요결과/dashboard';

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validateDashboardDocuments(documents: unknown[]): asserts documents is [NecessaryLabourDashboard, DecompositionDashboard, ValidationDashboard] {
  const [levels, decomposition, validation] = documents;
  if (!isObject(levels) || levels.schemaVersion !== '1.1.0' || !Array.isArray(levels.series) || levels.series.length !== 3) throw new Error('Invalid necessary_labour.json');
  if (!isObject(decomposition) || decomposition.schemaVersion !== '1.1.0' || !Array.isArray(decomposition.periods) || decomposition.periods.length !== 3) throw new Error('Invalid decomposition.json');
  if (!isObject(validation) || validation.schemaVersion !== '1.1.0' || validation.scope !== 'exporter-only' || validation.status !== 'pass' || !Array.isArray(validation.checks)) throw new Error('Invalid or non-passing validation.json');
  for (const item of levels.series) if (!isObject(item) || typeof item.year !== 'number' || typeof item.value !== 'number') throw new Error('Invalid necessary-labour series');
  for (const period of decomposition.periods) if (!isObject(period) || typeof period.totalChange !== 'number' || !Array.isArray(period.contributions) || period.contributions.length !== 77) throw new Error('Invalid decomposition period');
}

async function loadGithubDocuments(resultsPath: string) {
  return Promise.all([
    getJsonFile<unknown>(`${resultsPath}/necessary_labour.json`),
    getJsonFile<unknown>(`${resultsPath}/decomposition.json`),
    getJsonFile<unknown>(`${resultsPath}/validation.json`),
  ]);
}

async function loadLocalDocuments(resultsPath: string, localRepositoryRoot?: string) {
  const repositoryRoot = localRepositoryRoot || process.env.LOCAL_REPOSITORY_ROOT;
  if (!repositoryRoot) throw new Error('LOCAL_REPOSITORY_ROOT is required for local Results fallback');
  const root = path.resolve(repositoryRoot);
  const directory = path.resolve(root, ...resultsPath.split('/'));
  const relative = path.relative(root, directory);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Results path escapes local repository root');
  return Promise.all(['necessary_labour', 'decomposition', 'validation'].map(async name => JSON.parse(await readFile(path.join(directory, `${name}.json`), 'utf8')) as unknown));
}

export async function getDashboardBundle(options: { resultsPath?: string; localRepositoryRoot?: string; preferGithub?: boolean } = {}): Promise<DashboardBundle> {
  try {
    const configuredPath = (options.resultsPath || process.env.GITHUB_RESULTS_PATH || defaultResultsPath).replace(/\/$/, '');
    const source = (options.preferGithub ?? githubConfigured()) ? 'github' : 'local';
    const documents = source === 'github' ? await loadGithubDocuments(configuredPath) : await loadLocalDocuments(configuredPath, options.localRepositoryRoot);
    validateDashboardDocuments(documents);
    return { source, necessaryLabour: documents[0], decomposition: documents[1], validation: documents[2] };
  } catch {
    return { source: 'empty', necessaryLabour: null, decomposition: null, validation: null, error: 'Dashboard JSON is missing, invalid, or has a non-passing validation status.' };
  }
}
