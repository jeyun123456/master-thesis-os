import { getFile, getJsonFile, getTextFile } from './github';
import { isSafeRepositoryPath } from './repository';
import {
  importCsvText,
  importXlsxBytes,
  type ResultDataSource,
  type ResultDataset,
  type ResultDatasetKind,
  type ResultViewDocument,
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
  return candidate as ResultViewDocument;
}

function projectIdFromRoot(root: string) {
  const match = /^projects\/([^/]+)\/results(?:\/|$)/.exec(root);
  return match?.[1] || null;
}

function emptyBundle(resultPath: string, error: string): ProjectResultsBundle {
  return { source: 'empty', resultPath, projectId: null, datasets: [], view: null, error };
}
