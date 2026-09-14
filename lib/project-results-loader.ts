import { getFile, getJsonFile, getTextFile } from './github';
import { isSafeRepositoryPath } from './repository';
import {
  importCsvText,
  importXlsxBytes,
  type ResultDataSource,
  type ResultDataset,
  type ResultDatasetKind,
  type ResultViewDocument,
  isChartType,
} from './results-data';

type ResultManifestSource = {
  id: string;
  file: string;
  format: 'csv' | 'xlsx';
};

type ResultManifestDataset = {
  id: string;
  sourceId: string;
  kind: ResultDatasetKind;
  sheet?: string;
};

export type ProjectResultManifest = {
  version: 1;
  projectId?: string;
  sources: ResultManifestSource[];
  datasets: ResultManifestDataset[];
};

export type LoadedProjectResultDataset = ResultDataset & {
  kind: ResultDatasetKind;
};

export type ProjectResultsBundle = {
  source: 'github' | 'empty';
  resultPath: string;
  projectId: string | null;
  datasets: LoadedProjectResultDataset[];
  view: ResultViewDocument | null;
  error?: string;
};

export async function getProjectResultsBundle(resultPath: string): Promise<ProjectResultsBundle> {
  const root = normalizeResultRoot(resultPath);
  if (!root) return emptyBundle(resultPath, '유효한 프로젝트 결과 경로가 아니야.');

  try {
    const manifest = validateManifest(await getJsonFile<unknown>(`${root}/result.json`));
    const view = validateView(await getJsonFile<unknown>(`${root}/view.json`));
    const loadedSources = new Map<string, ResultDataSource>();

    for (const source of manifest.sources) {
      const sourcePath = resolveResultPath(root, source.file);
      const loaded = source.format === 'csv'
        ? importCsvText(source.file, await getTextFile(sourcePath))
        : await importXlsxBytes(source.file, await readBinaryFile(sourcePath));
      loadedSources.set(source.id, loaded);
    }

    const datasets = materializeConfiguredDatasets(manifest, loadedSources);
    const ids = new Set(datasets.map((dataset) => dataset.id));
    const missingViewDataset = view.items.find((item) => !ids.has(item.datasetId));
    if (missingViewDataset) throw new Error(`view.json이 없는 dataset을 참조해: ${missingViewDataset.datasetId}`);

    return {
      source: 'github',
      resultPath: root,
      projectId: manifest.projectId || projectIdFromRoot(root),
      datasets,
      view,
    };
  } catch (error) {
    return emptyBundle(root, error instanceof Error ? error.message : String(error));
  }
}

export function materializeConfiguredDatasets(manifest: ProjectResultManifest, sources: Map<string, ResultDataSource>): LoadedProjectResultDataset[] {
  return manifest.datasets.map((configured) => {
    const source = sources.get(configured.sourceId);
    if (!source) throw new Error(`result.json source를 찾을 수 없어: ${configured.sourceId}`);

    const dataset = configured.sheet
      ? source.datasets.find((candidate) => candidate.sheetName === configured.sheet)
      : source.datasets[0];
    if (!dataset) {
      const suffix = configured.sheet ? ` / sheet=${configured.sheet}` : '';
      throw new Error(`result.json dataset 원자료를 찾을 수 없어: ${configured.id}${suffix}`);
    }

    return {
      ...dataset,
      id: configured.id,
      sourceId: configured.sourceId,
      name: configured.sheet || dataset.name || configured.id,
      kind: configured.kind,
    };
  });
}

function normalizeResultRoot(value: string) {
  const normalized = value.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!normalized || !isSafeRepositoryPath(normalized)) return '';
  return normalized;
}

function resolveResultPath(root: string, relative: string) {
  const normalized = relative.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
  const path = `${root}/${normalized}`;
  if (!normalized || normalized.split('/').some((segment) => segment === '..') || !isSafeRepositoryPath(path)) {
    throw new Error(`잘못된 결과 source 경로야: ${relative}`);
  }
  return path;
}

async function readBinaryFile(path: string) {
  const file = await getFile(path);
  if (Array.isArray(file) || !('encoding' in file) || !('content' in file) || file.encoding !== 'base64' || typeof file.content !== 'string') {
    throw new Error(`GitHub binary file을 읽을 수 없어: ${path}`);
  }
  return new Uint8Array(Buffer.from(file.content.replace(/\n/g, ''), 'base64'));
}

function validateManifest(value: unknown): ProjectResultManifest {
  if (!value || typeof value !== 'object') throw new Error('result.json 형식이 올바르지 않아.');
  const candidate = value as Partial<ProjectResultManifest>;
  if (candidate.version !== 1 || !Array.isArray(candidate.sources) || !Array.isArray(candidate.datasets)) {
    throw new Error('result.json version/sources/datasets 형식이 올바르지 않아.');
  }
  for (const source of candidate.sources) {
    if (!source || typeof source.id !== 'string' || typeof source.file !== 'string' || (source.format !== 'csv' && source.format !== 'xlsx')) {
      throw new Error('result.json source 정의가 올바르지 않아.');
    }
  }
  for (const dataset of candidate.datasets) {
    if (!dataset || typeof dataset.id !== 'string' || typeof dataset.sourceId !== 'string' || !['metrics', 'table', 'chart'].includes(dataset.kind)) {
      throw new Error('result.json dataset 정의가 올바르지 않아.');
    }
  }
  return candidate as ProjectResultManifest;
}

function validateView(value: unknown): ResultViewDocument {
  if (!value || typeof value !== 'object') throw new Error('view.json 형식이 올바르지 않아.');
  const candidate = value as Partial<ResultViewDocument>;
  if (candidate.version !== 1 || !Array.isArray(candidate.items)) throw new Error('view.json version/items 형식이 올바르지 않아.');
  candidate.items.forEach(validateViewItem);
  return candidate as ResultViewDocument;
}

function validateViewItem(value: unknown, index: number) {
  if (!value || typeof value !== 'object') throw new Error(`view.json item ${index + 1} 형식이 올바르지 않아.`);
  const item = value as Record<string, unknown>;
  if (item.type !== 'metric' && item.type !== 'table' && item.type !== 'chart') {
    throw new Error(`view.json item ${index + 1} type이 올바르지 않아.`);
  }
  if (typeof item.datasetId !== 'string' || !item.datasetId.trim()) {
    throw new Error(`view.json item ${index + 1} datasetId가 올바르지 않아.`);
  }
  if (item.id !== undefined && (typeof item.id !== 'string' || !item.id.trim())) {
    throw new Error(`view.json item ${index + 1} id가 올바르지 않아.`);
  }
  if (item.title !== undefined && typeof item.title !== 'string') {
    throw new Error(`view.json item ${index + 1} title이 올바르지 않아.`);
  }

  if (item.type === 'metric') {
    if (!Number.isInteger(item.row) || (item.row as number) < 0) throw new Error(`view.json item ${index + 1} row가 올바르지 않아.`);
    if (item.label !== undefined && typeof item.label !== 'string') throw new Error(`view.json item ${index + 1} label이 올바르지 않아.`);
    if (item.prefix !== undefined && typeof item.prefix !== 'string') throw new Error(`view.json item ${index + 1} prefix가 올바르지 않아.`);
    if (item.suffix !== undefined && typeof item.suffix !== 'string') throw new Error(`view.json item ${index + 1} suffix가 올바르지 않아.`);
    if (item.decimals !== undefined && (!Number.isInteger(item.decimals) || (item.decimals as number) < 0 || (item.decimals as number) > 12)) {
      throw new Error(`view.json item ${index + 1} decimals가 올바르지 않아.`);
    }
    return;
  }

  if (typeof item.transpose !== 'boolean') throw new Error(`view.json item ${index + 1} transpose가 올바르지 않아.`);
  if (item.type === 'table') return;

  if (!isChartType(item.chartType)) throw new Error(`view.json item ${index + 1} chartType이 올바르지 않아.`);
  if (!Number.isInteger(item.xColumn) || (item.xColumn as number) < -1) throw new Error(`view.json item ${index + 1} xColumn이 올바르지 않아.`);
  for (const key of ['xMin', 'xMax', 'yMin', 'yMax'] as const) {
    if (item[key] !== undefined && (typeof item[key] !== 'number' || !Number.isFinite(item[key]))) {
      throw new Error(`view.json item ${index + 1} ${key}가 올바르지 않아.`);
    }
  }
  if (!Array.isArray(item.seriesColumns) || item.seriesColumns.some((column) => !Number.isInteger(column) || (column as number) < 0)) {
    throw new Error(`view.json item ${index + 1} seriesColumns가 올바르지 않아.`);
  }
  if (new Set(item.seriesColumns as number[]).size !== (item.seriesColumns as number[]).length) {
    throw new Error(`view.json item ${index + 1} seriesColumns가 중복됐어.`);
  }
}

function projectIdFromRoot(root: string) {
  const match = /^projects\/([^/]+)\/results(?:\/|$)/.exec(root);
  return match?.[1] || null;
}

function emptyBundle(resultPath: string, error: string): ProjectResultsBundle {
  return { source: 'empty', resultPath, projectId: null, datasets: [], view: null, error };
}
