'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { ResultChart, ResultTable } from '@/app/result-view-components';
import type { LoadedProjectResultDataset, ProjectResultsBundle } from '@/lib/project-results-loader';
import {
  compatibleDatasets,
  datasetForView,
  datasetKind,
  defaultChartView,
  normalizeChartView,
  numericColumnIndices,
  numericValue,
  resultViewItemKey,
  type ChartView,
  type MetricView,
  type ResultCell,
  type ResultDatasetLike,
  type ResultViewDocument,
  type ResultViewItem,
  type TableView,
} from '@/lib/results-data';

const CHART_TYPE_LABELS: Record<ChartView['chartType'], string> = {
  line: '선 그래프',
  bar: '막대 그래프',
  scatter: '산점도',
};

type AddItemType = ResultViewItem['type'];
type AxisBoundKey = 'xMin' | 'xMax' | 'yMin' | 'yMax';

const ADD_ITEM_LABELS: Record<AddItemType, string> = {
  metric: '수치 카드',
  table: '표',
  chart: '차트',
};

export function StandardResultsView({ resultPath }: { resultPath: string }) {
  const [bundle, setBundle] = useState<ProjectResultsBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [draftView, setDraftView] = useState<ResultViewDocument | null>(null);
  const [notice, setNotice] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [addType, setAddType] = useState<AddItemType>('chart');
  const [addDatasetId, setAddDatasetId] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setBundle(null);
    setDraftView(null);
    setNotice('');
    setAddOpen(false);
    setAddDatasetId('');
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

  useEffect(() => {
    if (bundle?.view) setDraftView(bundle.view);
  }, [bundle?.view]);

  if (loading) return <div className="card empty result-empty"><h3>프로젝트 결과를 불러오는 중이야</h3><p><code>{resultPath}</code>의 표준 결과 파일을 읽고 있어.</p></div>;
  if (error || !bundle || bundle.source === 'empty' || !bundle.view) {
    return <div className="card empty result-empty"><h3>표준 결과를 불러올 수 없어</h3><p>{error || bundle?.error || 'result.json 또는 view.json을 확인해줘.'}</p></div>;
  }

  const loadedBundle = bundle;
  const loadedView = loadedBundle.view!;
  if (!loadedView) return <div className="card empty result-empty"><h3>표준 결과를 불러올 수 없어</h3><p>view.json을 확인해줘.</p></div>;
  const view = draftView || loadedView;
  const addDatasets = compatibleDatasetsForType(addType, loadedBundle.datasets);
  const selectedAddDatasetId = addDatasets.some((dataset) => dataset.id === addDatasetId)
    ? addDatasetId
    : addDatasets[0]?.id || '';
  const metricItems = view.items.map((item, index) => ({ item, index })).filter(({ item }) => item.type === 'metric');
  const contentItems = view.items.map((item, index) => ({ item, index })).filter((entry): entry is { item: Exclude<ResultViewItem, MetricView>; index: number } => entry.item.type !== 'metric');
  const chartItems = contentItems.filter(({ item }) => item.type === 'chart');
  const tableItems = contentItems.filter(({ item }) => item.type === 'table');
  const serializedView = `${JSON.stringify(view, null, 2)}\n`;

  function updateItem(index: number, item: ResultViewItem) {
    setDraftView((current) => {
      const base = current || loadedView;
      const items = [...base.items];
      items[index] = item;
      return { ...base, items };
    });
    setNotice('현재 화면 설정에 반영했어. 원본 view.json은 아직 수정하지 않았어.');
  }

  function removeItem(index: number) {
    setDraftView((current) => {
      const base = current || loadedView;
      return { ...base, items: base.items.filter((_, itemIndex) => itemIndex !== index) };
    });
    setNotice('현재 화면에서 항목을 삭제했어. 원본 view.json은 아직 수정하지 않았어.');
  }

  function addItem() {
    const dataset = addDatasets.find((candidate) => candidate.id === selectedAddDatasetId) || addDatasets[0];
    if (!dataset) {
      setNotice('선택한 종류에 맞는 dataset이 없어. 결과 파일을 먼저 확인해줘.');
      return;
    }
    const item = createViewItem(addType, dataset);
    setDraftView((current) => {
      const base = current || loadedView;
      return { ...base, items: [...base.items, item] };
    });
    setAddOpen(false);
    setNotice(`${ADD_ITEM_LABELS[addType]}을 추가했어. 원본 view.json은 아직 수정하지 않았어.`);
  }

  function resetView() {
    setDraftView(loadedView);
    setNotice('view.json 설정으로 되돌렸어.');
  }

  async function copyView() {
    if (!navigator.clipboard) {
      setNotice('클립보드를 사용할 수 없어. 다운로드를 사용해줘.');
      return;
    }
    try {
      await navigator.clipboard.writeText(serializedView);
      setNotice('현재 view.json을 클립보드에 복사했어.');
    } catch {
      setNotice('클립보드 복사에 실패했어. 다운로드를 사용해줘.');
    }
  }

  function downloadView() {
    const url = URL.createObjectURL(new Blob([serializedView], { type: 'application/json;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'view.json';
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice('현재 view.json을 다운로드했어.');
  }

  return <>
    <div className="result-controls card section">
      <div><b>프로젝트 표준 결과</b><span>{bundle.source === 'local' ? 'Vault local' : 'GitHub live'} · scalar.csv + matrix.xlsx · view.json</span></div>
      <code>{resultPath}</code>
    </div>
    <div className="card section result-view-toolbar">
      <div className="result-view-toolbar-head">
        <div>
          <b>표시 설정</b>
          <span>각 결과 항목의 dataset과 표시 방향을 이 화면에서 미리 조정할 수 있어.</span>
        </div>
        <div className="toolbar">
          <button className="mini" type="button" onClick={() => setAddOpen((current) => !current)} aria-expanded={addOpen}>＋ 추가</button>
          <button className="mini" type="button" onClick={resetView}>view.json으로 초기화</button>
          <button className="mini" type="button" onClick={() => void copyView()}>view.json 복사</button>
          <button className="mini" type="button" onClick={downloadView}>view.json 다운로드</button>
        </div>
      </div>
      {addOpen && <div className="result-add-panel">
        <label className="result-view-control">종류
          <select value={addType} onChange={(event) => setAddType(event.target.value as AddItemType)}>
            {Object.entries(ADD_ITEM_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
          </select>
        </label>
        <label className="result-view-control">데이터
          <select value={selectedAddDatasetId} onChange={(event) => setAddDatasetId(event.target.value)} disabled={!addDatasets.length}>
            {!addDatasets.length && <option value="">호환 dataset 없음</option>}
            {addDatasets.map((dataset) => <option value={dataset.id} key={dataset.id}>{dataset.name}{dataset.sheetName ? ` · ${dataset.sheetName}` : ''}</option>)}
          </select>
        </label>
        <button className="mini primary" type="button" onClick={addItem} disabled={!addDatasets.length}>항목 추가</button>
        <button className="mini" type="button" onClick={() => setAddOpen(false)}>취소</button>
      </div>}
    </div>
    {notice && <div className="note result-view-notice">{notice}</div>}
    {metricItems.length > 0 && <div className="kpis">
      {metricItems.map(({ item, index }) => <MetricItem key={resultViewItemKey(item, index)} item={item as MetricView} index={index} datasets={loadedBundle.datasets} onChange={updateItem} onDelete={removeItem} />)}
    </div>}
    <div className="results-stack">
      {chartItems.map(({ item, index }) => <ResultItem key={resultViewItemKey(item, index)} item={item} index={index} datasets={loadedBundle.datasets} onChange={updateItem} onDelete={removeItem} />)}
      {tableItems.map(({ item, index }) => <ResultItem key={resultViewItemKey(item, index)} item={item} index={index} datasets={loadedBundle.datasets} onChange={updateItem} onDelete={removeItem} />)}
    </div>
    {!view.items.length && <div className="empty compact-empty result-view-no-items">표시 중인 항목이 없어. 우측 `＋ 추가`에서 수치 카드·표·차트를 추가해줘.</div>}
  </>;
}

function MetricItem({ item, index, datasets, onChange, onDelete }: {
  item: MetricView;
  index: number;
  datasets: LoadedProjectResultDataset[];
  onChange: (index: number, item: ResultViewItem) => void;
  onDelete: (index: number) => void;
}) {
  const options = compatibleDatasets(item, datasets);
  const dataset = resolveDataset(item, datasets);
  const rowIndex = dataset ? Math.min(item.row, Math.max(dataset.rows.length - 1, 0)) : 0;
  const row = dataset?.rows[rowIndex];
  const raw = row?.[1] ?? null;
  const label = item.label || cellText(row?.[0] ?? null) || dataset?.name || item.datasetId;
  const value = formatMetric(raw, item);
  return <div className="card kpi result-view-kpi">
    <button className="mini result-view-delete result-view-kpi-delete" type="button" onClick={() => onDelete(index)}>삭제</button>
    <div className="result-view-kpi-content"><small>{label}</small><strong>{value}</strong><span>{dataset?.name || item.datasetId}</span></div>
    <ItemDatasetSelect options={options} value={dataset?.id || ''} onChange={(datasetId) => {
      const nextDataset = options.find((candidate) => candidate.id === datasetId);
      if (!nextDataset) return;
      onChange(index, { ...item, datasetId, row: Math.min(item.row, Math.max(nextDataset.rows.length - 1, 0)) });
    }} />
    {dataset && <label className="result-view-control">행
      <select value={rowIndex} onChange={(event) => onChange(index, { ...item, datasetId: dataset.id, row: Number(event.target.value) })}>
        {dataset.rows.map((candidate, candidateIndex) => <option value={candidateIndex} key={candidateIndex}>{candidateIndex + 1}: {cellText(candidate[0] ?? null) || `행 ${candidateIndex + 1}`}</option>)}
      </select>
    </label>}
  </div>;
}

function ResultItem({ item, index, datasets, onChange, onDelete }: {
  item: Exclude<ResultViewItem, MetricView>;
  index: number;
  datasets: LoadedProjectResultDataset[];
  onChange: (index: number, item: ResultViewItem) => void;
  onDelete: (index: number) => void;
}) {
  const options = compatibleDatasets(item, datasets);
  const dataset = resolveDataset(item, datasets);
  if (item.type === 'table') {
    const view = item as TableView;
    const visible = dataset ? datasetForView(dataset, view) : null;
    return <ResultCard title={item.title || dataset?.sheetName || dataset?.name || item.datasetId} right="표" onDelete={() => onDelete(index)}>
      <div className="result-view-item-controls">
        <ItemDatasetSelect options={options} value={dataset?.id || ''} onChange={(datasetId) => onChange(index, { ...view, datasetId })} />
        <label className="result-checkbox"><input type="checkbox" checked={Boolean(view.transpose)} onChange={(event) => onChange(index, { ...view, transpose: event.target.checked })} /> 행/열 전환</label>
      </div>
      {visible ? <ResultTable dataset={visible} /> : <ItemError message="호환 가능한 표 dataset이 없어." />}
    </ResultCard>;
  }

  const rawView = item as ChartView;
  const normalizedView = dataset ? normalizeChartView(dataset, rawView) : rawView;
  const visible = dataset ? datasetForView(dataset, normalizedView) : null;
  const numericColumns = visible ? numericColumnIndices(visible) : [];
  const seriesOptions = numericColumns.filter((column) => column !== normalizedView.xColumn);
  const numericXAxis = Boolean(visible && normalizedView.xColumn >= 0 && visible.rows.filter((row) => numericValue(row[normalizedView.xColumn] ?? null) !== null).length > 1);
  return <ResultCard title={rawView.title || dataset?.sheetName || dataset?.name || rawView.datasetId} right={CHART_TYPE_LABELS[normalizedView.chartType] || '차트'} onDelete={() => onDelete(index)}>
    <div className="result-view-item-controls result-chart-controls">
      <ItemDatasetSelect options={options} value={dataset?.id || ''} onChange={(datasetId) => {
        const nextDataset = options.find((candidate) => candidate.id === datasetId);
        if (!nextDataset) return;
        const nextView = defaultChartView(nextDataset, rawView.transpose);
        onChange(index, { ...rawView, datasetId, xColumn: nextView.xColumn, seriesColumns: nextView.seriesColumns });
      }} />
      <label className="result-view-control">종류
        <select value={normalizedView.chartType} onChange={(event) => onChange(index, { ...rawView, chartType: event.target.value as ChartView['chartType'] })}>
          {Object.entries(CHART_TYPE_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
        </select>
      </label>
      <label className="result-checkbox"><input type="checkbox" checked={Boolean(normalizedView.transpose)} onChange={(event) => {
        const nextView = dataset ? defaultChartView(dataset, event.target.checked) : normalizedView;
        onChange(index, { ...rawView, transpose: event.target.checked, xColumn: nextView.xColumn, seriesColumns: nextView.seriesColumns });
      }} /> 축 방향 교환</label>
      {visible && <label className="result-view-control">가로축
        <select value={normalizedView.xColumn} onChange={(event) => {
          const xColumn = Number(event.target.value);
          onChange(index, { ...rawView, xColumn, seriesColumns: normalizedView.seriesColumns.filter((column) => column !== xColumn) });
        }}>
          <option value={-1}>행 번호</option>
          {visible.columns.map((column, columnIndex) => <option value={columnIndex} key={column.id}>{column.label}</option>)}
        </select>
      </label>}
    </div>
    {visible && <div className="result-series-controls">
      <span>값 열</span>
      {seriesOptions.map((column) => <label className="result-checkbox" key={visible.columns[column].id}>
        <input type="checkbox" checked={normalizedView.seriesColumns.includes(column)} onChange={(event) => onChange(index, {
          ...rawView,
          seriesColumns: event.target.checked
            ? [...normalizedView.seriesColumns, column]
            : normalizedView.seriesColumns.filter((candidate) => candidate !== column),
        })} />
        {visible.columns[column].label}
      </label>)}
      {!seriesOptions.length && <span className="muted">숫자 열 없음</span>}
    </div>}
    <div className="result-axis-controls">
      <span className="result-axis-title">축 범위</span>
      <label className="result-axis-field">X 최소
        <input type="number" step="any" value={normalizedView.xMin ?? ''} onChange={(event) => onChange(index, withAxisBound(rawView, 'xMin', parseAxisBound(event.target.value)))} disabled={!numericXAxis} placeholder="자동" />
      </label>
      <label className="result-axis-field">X 최대
        <input type="number" step="any" value={normalizedView.xMax ?? ''} onChange={(event) => onChange(index, withAxisBound(rawView, 'xMax', parseAxisBound(event.target.value)))} disabled={!numericXAxis} placeholder="자동" />
      </label>
      <label className="result-axis-field">Y 최소
        <input type="number" step="any" value={normalizedView.yMin ?? ''} onChange={(event) => onChange(index, withAxisBound(rawView, 'yMin', parseAxisBound(event.target.value)))} placeholder="자동" />
      </label>
      <label className="result-axis-field">Y 최대
        <input type="number" step="any" value={normalizedView.yMax ?? ''} onChange={(event) => onChange(index, withAxisBound(rawView, 'yMax', parseAxisBound(event.target.value)))} placeholder="자동" />
      </label>
      <button className="mini" type="button" onClick={() => onChange(index, withoutAxisBounds(rawView))}>자동 범위</button>
      {!numericXAxis && <span className="muted">숫자형 가로축을 선택하면 X 범위를 사용할 수 있어.</span>}
    </div>
    {visible ? <ResultChart dataset={visible} view={normalizedView} title={rawView.title || dataset?.name || rawView.datasetId} /> : <ItemError message="호환 가능한 차트 dataset이 없어." />}
  </ResultCard>;
}

function ItemDatasetSelect({ options, value, onChange }: {
  options: ResultDatasetLike[];
  value: string;
  onChange: (datasetId: string) => void;
}) {
  return <label className="result-view-control">데이터
    <select value={value} onChange={(event) => onChange(event.target.value)} disabled={!options.length}>
      {!options.length && <option value="">호환 dataset 없음</option>}
      {options.map((dataset) => <option value={dataset.id} key={dataset.id}>{dataset.name}{dataset.sheetName ? ` · ${dataset.sheetName}` : ''}</option>)}
    </select>
  </label>;
}

function resolveDataset(item: ResultViewItem, datasets: LoadedProjectResultDataset[]) {
  const options = compatibleDatasets(item, datasets);
  return options.find((dataset) => dataset.id === item.datasetId) || options[0];
}

function compatibleDatasetsForType(type: AddItemType, datasets: LoadedProjectResultDataset[]) {
  const expected = type === 'metric' ? 'metrics' : type;
  return datasets.filter((dataset) => datasetKind(dataset) === expected);
}

function createViewItem(type: AddItemType, dataset: LoadedProjectResultDataset): ResultViewItem {
  if (type === 'metric') return { type: 'metric', datasetId: dataset.id, row: 0 };
  if (type === 'table') return { type: 'table', datasetId: dataset.id, transpose: false };
  return defaultChartView(dataset);
}

function parseAxisBound(value: string) {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function withAxisBound(view: ChartView, key: AxisBoundKey, value: number | undefined): ChartView {
  const next = { ...view };
  if (value === undefined) delete next[key];
  else next[key] = value;
  return next;
}

function withoutAxisBounds(view: ChartView): ChartView {
  const next = { ...view };
  delete next.xMin;
  delete next.xMax;
  delete next.yMin;
  delete next.yMax;
  return next;
}

function ItemError({ message }: { message: string }) {
  return <div className="empty compact-empty">{message}</div>;
}

function ResultCard({ title, right, onDelete, children }: { title: string; right?: string; onDelete?: () => void; children: ReactNode }) {
  return <div className="card section result-view-card"><div className="head"><h3>{title}</h3><div className="result-card-actions"><span>{right}</span>{onDelete && <button className="mini result-view-delete" type="button" onClick={onDelete}>삭제</button>}</div></div>{children}</div>;
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
