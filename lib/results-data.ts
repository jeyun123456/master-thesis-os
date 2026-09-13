export type ResultSourceFormat = 'csv' | 'xlsx';
export type ResultDatasetKind = 'metrics' | 'table' | 'chart';
export type ResultCell = string | number | boolean | null;

export type ResultColumn = {
  id: string;
  label: string;
};

export type ResultDataset = {
  id: string;
  sourceId: string;
  name: string;
  sheetName: string | null;
  suggestedKind: Exclude<ResultDatasetKind, 'chart'>;
  columns: ResultColumn[];
  rows: ResultCell[][];
};

export type ResultDataSource = {
  id: string;
  name: string;
  format: ResultSourceFormat;
  datasets: ResultDataset[];
};

export type MetricView = {
  type: 'metric';
  datasetId: string;
  row: number;
  label?: string;
  prefix?: string;
  suffix?: string;
  decimals?: number;
};

export type TableView = {
  type: 'table';
  datasetId: string;
  transpose: boolean;
};

export type ChartView = {
  type: 'chart';
  datasetId: string;
  transpose: boolean;
  chartType: 'line' | 'bar' | 'scatter';
  xColumn: number;
  seriesColumns: number[];
};

export type ResultViewItem = MetricView | TableView | ChartView;

export type ResultViewDocument = {
  version: 1;
  items: ResultViewItem[];
};

type ImportedFile = Pick<File, 'name' | 'text' | 'arrayBuffer'>;

type ZipEntry = {
  name: string;
  compression: number;
  compressedSize: number;
  localHeaderOffset: number;
};

const HEADER_NAMES = new Set(['name', 'label', 'metric', 'item', '이름', '항목', '지표']);
const VALUE_NAMES = new Set(['value', 'values', '값', '수치']);

function sourceId(fileName: string) {
  const normalized = fileName.trim().toLowerCase().replace(/[^a-z0-9가-힣]+/g, '-').replace(/^-|-$/g, '');
  return `source:${normalized || 'results'}`;
}

function datasetId(source: string, index: number) {
  return `${source}:dataset:${index + 1}`;
}

function isBlank(value: ResultCell) {
  return value === null || (typeof value === 'string' && value.trim() === '');
}

function trimMatrix(matrix: ResultCell[][]) {
  const rows = matrix.map((row) => [...row]);
  while (rows.length && rows[rows.length - 1].every(isBlank)) rows.pop();
  let width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  while (width > 0 && rows.every((row) => isBlank(row[width - 1] ?? null))) width -= 1;
  return rows.map((row) => Array.from({ length: width }, (_, index) => row[index] ?? null));
}

function labelFor(value: ResultCell, index: number) {
  if (value === null || value === '') return `열 ${index + 1}`;
  return String(value);
}

function looksLikeMetricHeader(row: ResultCell[]) {
  const first = String(row[0] ?? '').trim().toLowerCase();
  const second = String(row[1] ?? '').trim().toLowerCase();
  return HEADER_NAMES.has(first) && VALUE_NAMES.has(second);
}

function numericRatio(rows: ResultCell[][], column: number) {
  const values = rows.map((row) => row[column]).filter((value) => !isBlank(value));
  if (!values.length) return 0;
  const numeric = values.filter((value) => typeof value === 'number' || (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))));
  return numeric.length / values.length;
}

function buildDataset(source: string, index: number, name: string, sheetName: string | null, rawMatrix: ResultCell[][]): ResultDataset {
  const matrix = trimMatrix(rawMatrix);
  const firstRow = matrix[0] || [];
  const metricWithoutHeader = matrix.length > 0 && matrix.every((row) => row.length <= 2) && firstRow.length >= 2 && !looksLikeMetricHeader(firstRow) && numericRatio(matrix, 1) >= 0.8;
  const metricWithHeader = matrix.length > 1 && firstRow.length === 2 && looksLikeMetricHeader(firstRow) && numericRatio(matrix.slice(1), 1) >= 0.8;
  const suggestedKind: ResultDataset['suggestedKind'] = metricWithoutHeader || metricWithHeader ? 'metrics' : 'table';

  let headers: ResultCell[];
  let rows: ResultCell[][];
  if (metricWithoutHeader) {
    headers = ['이름', '값'];
    rows = matrix;
  } else {
    headers = firstRow;
    rows = matrix.slice(1);
  }

  const width = Math.max(headers.length, rows.reduce((max, row) => Math.max(max, row.length), 0));
  const columns = Array.from({ length: width }, (_, columnIndex) => ({
    id: `c${columnIndex}`,
    label: labelFor(headers[columnIndex] ?? null, columnIndex),
  }));
  const normalizedRows = rows.map((row) => Array.from({ length: width }, (_, columnIndex) => row[columnIndex] ?? null));

  return {
    id: datasetId(source, index),
    sourceId: source,
    name,
    sheetName,
    suggestedKind,
    columns,
    rows: normalizedRows,
  };
}

export function parseCsv(text: string, delimiter?: string): ResultCell[][] {
  const normalized = text.replace(/^\uFEFF/, '');
  const chosenDelimiter = delimiter || detectDelimiter(normalized);
  const rows: string[][] = [[]];
  let field = '';
  let quoted = false;

  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    if (quoted) {
      if (char === '"' && normalized[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') quoted = true;
    else if (char === chosenDelimiter) {
      rows[rows.length - 1].push(field);
      field = '';
    } else if (char === '\n') {
      rows[rows.length - 1].push(field.replace(/\r$/, ''));
      rows.push([]);
      field = '';
    } else {
      field += char;
    }
  }
  rows[rows.length - 1].push(field.replace(/\r$/, ''));

  return trimMatrix(rows.map((row) => row.map(coerceCell)));
}

function detectDelimiter(text: string) {
  const sample = text.split(/\r?\n/, 4).join('\n');
  const candidates = [',', '\t', ';'];
  let best = ',';
  let bestCount = -1;
  for (const candidate of candidates) {
    let count = 0;
    let quoted = false;
    for (let index = 0; index < sample.length; index += 1) {
      const char = sample[index];
      if (char === '"' && sample[index + 1] === '"' && quoted) index += 1;
      else if (char === '"') quoted = !quoted;
      else if (!quoted && char === candidate) count += 1;
    }
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

function coerceCell(value: string): ResultCell {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (/^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(trimmed)) {
    const number = Number(trimmed);
    if (Number.isFinite(number)) return number;
  }
  if (/^(true|false)$/i.test(trimmed)) return trimmed.toLowerCase() === 'true';
  return value;
}

export function importCsvText(fileName: string, text: string): ResultDataSource {
  const id = sourceId(fileName);
  const baseName = fileName.replace(/\.[^.]+$/, '');
  return {
    id,
    name: fileName,
    format: 'csv',
    datasets: [buildDataset(id, 0, baseName, null, parseCsv(text))],
  };
}

export async function importResultFile(file: ImportedFile): Promise<ResultDataSource> {
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (extension === 'csv' || extension === 'tsv') return importCsvText(file.name, await file.text());
  if (extension === 'xlsx') return importXlsxBytes(file.name, new Uint8Array(await file.arrayBuffer()));
  throw new Error('지원하는 결과 파일은 .csv, .tsv, .xlsx야.');
}

export function transposeDataset(dataset: ResultDataset): ResultDataset {
  const matrix: ResultCell[][] = [dataset.columns.map((column) => column.label), ...dataset.rows];
  const width = matrix.reduce((max, row) => Math.max(max, row.length), 0);
  const transposed = Array.from({ length: width }, (_, columnIndex) => matrix.map((row) => row[columnIndex] ?? null));
  const headers = transposed[0] || [];
  const rows = transposed.slice(1);
  return {
    ...dataset,
    columns: headers.map((value, index) => ({ id: `c${index}`, label: labelFor(value, index) })),
    rows,
  };
}

export function datasetForView(dataset: ResultDataset, view: TableView | ChartView) {
  return view.transpose ? transposeDataset(dataset) : dataset;
}

export function defaultChartView(dataset: ResultDataset, transpose = false): ChartView {
  const visible = transpose ? transposeDataset(dataset) : dataset;
  const numericColumns = visible.columns
    .map((_, index) => index)
    .filter((index) => numericRatio(visible.rows, index) >= 0.8);
  const xColumn = visible.columns.length > 0 ? 0 : -1;
  const seriesColumns = numericColumns.filter((index) => index !== xColumn);
  return {
    type: 'chart',
    datasetId: dataset.id,
    transpose,
    chartType: 'line',
    xColumn,
    seriesColumns,
  };
}

export async function importXlsxBytes(fileName: string, bytes: Uint8Array): Promise<ResultDataSource> {
  const archive = parseZipDirectory(bytes);
  const workbookXml = await readZipText(bytes, archive, 'xl/workbook.xml');
  const relationshipsXml = await readZipText(bytes, archive, 'xl/_rels/workbook.xml.rels');
  const sharedStrings = archive.has('xl/sharedStrings.xml')
    ? parseSharedStrings(await readZipText(bytes, archive, 'xl/sharedStrings.xml'))
    : [];
  const relationships = parseRelationships(relationshipsXml);
  const sheets = parseWorkbookSheets(workbookXml);
  const id = sourceId(fileName);
  const datasets: ResultDataset[] = [];

  for (const [index, sheet] of sheets.entries()) {
    const target = relationships.get(sheet.relationshipId);
    if (!target) throw new Error(`Excel 시트 관계를 찾을 수 없어: ${sheet.name}`);
    const part = resolveWorkbookPart(target);
    const worksheetXml = await readZipText(bytes, archive, part);
    const matrix = parseWorksheet(worksheetXml, sharedStrings);
    datasets.push(buildDataset(id, index, sheet.name, sheet.name, matrix));
  }

  if (!datasets.length) throw new Error('Excel 파일에 읽을 수 있는 시트가 없어.');
  return { id, name: fileName, format: 'xlsx', datasets };
}

function parseZipDirectory(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  const lowerBound = Math.max(0, bytes.length - 65_557);
  for (let offset = bytes.length - 22; offset >= lowerBound; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) throw new Error('유효한 .xlsx ZIP 구조가 아니야.');

  const entryCount = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const entries = new Map<string, ZipEntry>();
  const decoder = new TextDecoder();

  for (let index = 0; index < entryCount; index += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new Error('Excel ZIP 중앙 디렉터리가 손상됐어.');
    const compression = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const fileNameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + fileNameLength)).replace(/^\//, '');
    entries.set(name, { name, compression, compressedSize, localHeaderOffset });
    offset += 46 + fileNameLength + extraLength + commentLength;
  }
  return entries;
}

async function readZipText(bytes: Uint8Array, entries: Map<string, ZipEntry>, name: string) {
  const entry = entries.get(name.replace(/^\//, ''));
  if (!entry) throw new Error(`Excel 내부 파일을 찾을 수 없어: ${name}`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const offset = entry.localHeaderOffset;
  if (view.getUint32(offset, true) !== 0x04034b50) throw new Error(`Excel ZIP 항목이 손상됐어: ${name}`);
  const fileNameLength = view.getUint16(offset + 26, true);
  const extraLength = view.getUint16(offset + 28, true);
  const start = offset + 30 + fileNameLength + extraLength;
  const compressed = bytes.subarray(start, start + entry.compressedSize);
  let content: Uint8Array;
  if (entry.compression === 0) content = compressed;
  else if (entry.compression === 8) content = await inflateRaw(compressed);
  else throw new Error(`지원하지 않는 Excel ZIP 압축 방식이야: ${entry.compression}`);
  return new TextDecoder().decode(content);
}

async function inflateRaw(bytes: Uint8Array) {
  if (typeof DecompressionStream === 'undefined') throw new Error('이 브라우저는 .xlsx 압축 해제를 지원하지 않아. CSV를 사용해줘.');
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function parseWorkbookSheets(xml: string) {
  const sheets: Array<{ name: string; relationshipId: string }> = [];
  for (const match of xml.matchAll(/<sheet\b([^>]*)\/?\s*>/g)) {
    const attrs = match[1];
    const name = decodeXml(attribute(attrs, 'name') || 'Sheet');
    const relationshipId = attribute(attrs, 'r:id');
    if (relationshipId) sheets.push({ name, relationshipId });
  }
  return sheets;
}

function parseRelationships(xml: string) {
  const relationships = new Map<string, string>();
  for (const match of xml.matchAll(/<Relationship\b([^>]*)\/?\s*>/g)) {
    const attrs = match[1];
    const id = attribute(attrs, 'Id');
    const target = attribute(attrs, 'Target');
    if (id && target) relationships.set(id, target);
  }
  return relationships;
}

function resolveWorkbookPart(target: string) {
  const normalized = target.replace(/\\/g, '/');
  if (normalized.startsWith('/')) return normalized.slice(1);
  const segments = `xl/${normalized}`.split('/');
  const output: string[] = [];
  for (const segment of segments) {
    if (segment === '..') output.pop();
    else if (segment !== '.') output.push(segment);
  }
  return output.join('/');
}

function parseSharedStrings(xml: string) {
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((match) =>
    [...match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((part) => decodeXml(part[1])).join(''),
  );
}

function parseWorksheet(xml: string, sharedStrings: string[]) {
  const cells: Array<{ row: number; column: number; value: ResultCell }> = [];
  let maxRow = -1;
  let maxColumn = -1;
  for (const match of xml.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
    const attrs = match[1];
    const body = match[2];
    const reference = attribute(attrs, 'r');
    if (!reference) continue;
    const coordinates = cellCoordinates(reference);
    const type = attribute(attrs, 't');
    const value = worksheetCellValue(type, body, sharedStrings);
    cells.push({ ...coordinates, value });
    maxRow = Math.max(maxRow, coordinates.row);
    maxColumn = Math.max(maxColumn, coordinates.column);
  }
  if (maxRow < 0 || maxColumn < 0) return [];
  const matrix: ResultCell[][] = Array.from({ length: maxRow + 1 }, () => Array.from({ length: maxColumn + 1 }, () => null));
  for (const cell of cells) matrix[cell.row][cell.column] = cell.value;
  return trimMatrix(matrix);
}

function worksheetCellValue(type: string | null, body: string, sharedStrings: string[]): ResultCell {
  if (type === 'inlineStr') {
    return [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((match) => decodeXml(match[1])).join('');
  }
  const raw = body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1];
  if (raw === undefined) return null;
  const decoded = decodeXml(raw);
  if (type === 's') return sharedStrings[Number(decoded)] ?? '';
  if (type === 'b') return decoded === '1';
  if (type === 'str' || type === 'e') return decoded;
  const number = Number(decoded);
  return Number.isFinite(number) ? number : decoded;
}

function cellCoordinates(reference: string) {
  const match = /^([A-Z]+)(\d+)$/i.exec(reference);
  if (!match) throw new Error(`잘못된 Excel 셀 주소야: ${reference}`);
  let column = 0;
  for (const char of match[1].toUpperCase()) column = column * 26 + char.charCodeAt(0) - 64;
  return { row: Number(match[2]) - 1, column: column - 1 };
}

function attribute(attrs: string, name: string) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:^|\\s)${escaped}=(?:"([^"]*)"|'([^']*)')`).exec(attrs);
  return match ? (match[1] ?? match[2] ?? '') : null;
}

function decodeXml(value: string) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}
