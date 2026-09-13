'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ProjectResultsBundle, LoadedProjectResultDataset } from '@/lib/project-results-loader';
import { datasetForView, type ChartView, type MetricView, type ResultCell, type ResultDataset, type ResultViewItem, type TableView } from '@/lib/results-data';

const ROW_LIMIT = 100;

export function StandardResultsView({ resultPath }: { resultPath: string }) {
  const [bundle, setBundle] = useState<ProjectResultsBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setBundle(null);
    fetch(`/api/project-results?path=${encodeURIComponent(resultPath)}`, { cache: 'no-store' })
      .then(async (response) => {
        const data = await response.json() as ProjectResultsBundle & { error?: string };
        if (!response.ok) throw new Error(data.error || '표준 결과를 불러오지 못했어.');
        return data;
      })
      .then((data) => {
        if (!cancelled) setBundle(data);
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : '표준 결과를 불러오지 못했어.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [resultPath]);

  const datasets = useMemo(() => new Map((bundle?.datasets || []).map((dataset) => [dataset.id, dataset])), [bundle]);

  if (loading) return <div className="card empty result-empty"><h3>프로젝트 결과를 불러오는 중이야</h3><p><code>{resultPath}</code>의 표준 결과 파일을 읽고 있어.</p></div>;
  if (error || !bundle || bundle.source !== 'github' || !bundle.view) {
    return <div className="card empty result-empty"><h3>표준 결과를 불러올 수 없어</h3><p>{error || bundle?.error || 'result.json 또는 view.json을 확인해줘.'}</p></div>;
  }

  const metricItems = bundle.view.items.filter((item): item is MetricView => item.type === 'metric');
  const contentItems = bundle.view.items.filter((item) => item.type !== 'metric');
  const chartItems = contentItems.filter((item) => item.type === 'chart');
  const tableItems = contentItems.filter((item) => item.type === 'table');

  return <>
    <div className="result-controls card section">
      <div><b>프로젝트 표준 결과</b><span>GitHub live · scalar.csv + matrix.xlsx · view.json</span></div>
      <code>{resultPath}</code>
    </div>
    {metricItems.length > 0 && <div className="kpis">
      {metricItems.map((item, index) => <MetricCard key={`${item.datasetId}-${item.row}-${index}`} item={item} dataset={datasets.get(item.datasetId)} />)}
    </div>}
    <div className="results-stack">
      {chartItems.map((item, index) => <ResultItem key={`${item.datasetId}-${item.type}-${index}`} item={item} dataset={datasets.get(item.datasetId)} />)}
      {tableItems.map((item, index) => <ResultItem key={`${item.datasetId}-${item.type}-${index}`} item={item} dataset={datasets.get(item.datasetId)} />)}
    </div>
  </>;
}

function MetricCard({ item, dataset }: { item: MetricView; dataset?: LoadedProjectResultDataset }) {
  const row = dataset?.rows[item.row];
  const raw = row?.[1] ?? null;
  const label = item.label || cellText(row?.[0] ?? null) || dataset?.name || item.datasetId;
  const value = formatMetric(raw, item);
  return <div className="card kpi"><small>{label}</small><strong>{value}</strong><span>{dataset?.name || item.datasetId}</span></div>;
}

function ResultItem({ item, dataset }: { item: Exclude<ResultViewItem, MetricView>; dataset?: LoadedProjectResultDataset }) {
  if (!dataset) return <ResultCard title={item.datasetId}><div className="empty compact-empty">dataset을 찾지 못했어.</div></ResultCard>;
  if (item.type === 'table') {
    const visible = datasetForView(dataset, item as TableView);
    return <ResultCard title={dataset.sheetName || dataset.name} right="표"><ResultTable dataset={visible} /></ResultCard>;
  }
  const visible = datasetForView(dataset, item as ChartView);
  return <ResultCard title={dataset.sheetName || dataset.name} right={item.chartType}><ResultChart dataset={visible} view={item as ChartView} /></ResultCard>;
}

function ResultTable({ dataset }: { dataset: ResultDataset }) {
  const rows = dataset.rows.slice(0, ROW_LIMIT);
  return <>
    <div className="result-import-table-wrap">
      <table className="result-import-table"><thead><tr>{dataset.columns.map((column) => <th key={column.id}>{column.label}</th>)}</tr></thead><tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{dataset.columns.map((column, columnIndex) => <td key={column.id}>{formatCell(row[columnIndex] ?? null)}</td>)}</tr>)}</tbody></table>
    </div>
    {dataset.rows.length > rows.length && <p className="muted result-import-limit">처음 {rows.length}개 행만 표시하고 있어.</p>}
  </>;
}

function ResultChart({ dataset, view }: { dataset: ResultDataset; view: ChartView }) {
  const seriesColumns = view.seriesColumns.filter((column) => dataset.columns[column]);
  const rows = dataset.rows.slice(0, ROW_LIMIT);
  const values = seriesColumns.flatMap((column) => rows.map((row) => numericValue(row[column])).filter((value): value is number => value !== null));
  const maxAbs = Math.max(1, ...values.map((value) => Math.abs(value)));
  if (!seriesColumns.length || !values.length) return <div className="empty compact-empty">차트로 표시할 숫자 열이 없어.</div>;

  return <div className="result-chart">
    <p className="muted result-chart-caption">가로축: {view.xColumn >= 0 ? dataset.columns[view.xColumn]?.label : '행'} · {seriesColumns.map((column) => dataset.columns[column].label).join(', ')}</p>
    {seriesColumns.map((column) => <div className="result-chart-series" key={dataset.columns[column].id}>
      <b>{dataset.columns[column].label}</b>
      {rows.map((row, rowIndex) => {
        const value = numericValue(row[column]);
        const label = view.xColumn >= 0 ? formatCell(row[view.xColumn] ?? null) : `행 ${rowIndex + 1}`;
        const width = value === null ? 0 : Math.min(100, Math.abs(value) / maxAbs * 100);
        return <div className="result-chart-row" key={`${rowIndex}-${label}`}><span>{label}</span><div className="result-track"><div style={{ width: `${width}%` }} /></div><strong>{value === null ? '—' : formatCell(value)}</strong></div>;
      })}
    </div>)}
  </div>;
}

function ResultCard({ title, right, children }: { title: string; right?: string; children: ReactNode }) {
  return <div className="card section"><div className="head"><h3>{title}</h3><span>{right}</span></div>{children}</div>;
}

function formatMetric(value: ResultCell, view: MetricView) {
  const number = numericValue(value);
  const body = number === null
    ? cellText(value) || '—'
    : number.toLocaleString('ko-KR', view.decimals === undefined ? { maximumFractionDigits: 6 } : { minimumFractionDigits: view.decimals, maximumFractionDigits: view.decimals });
  return `${view.prefix || ''}${body}${view.suffix || ''}`;
}

function formatCell(value: ResultCell) {
  if (value === null) return '—';
  if (typeof value === 'number') return value.toLocaleString('ko-KR', { maximumFractionDigits: 6 });
  return String(value);
}

function cellText(value: ResultCell) {
  return value === null ? '' : String(value);
}

function numericValue(value: ResultCell) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}
