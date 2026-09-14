'use client';

import { numericValue, type ChartView, type ResultCell, type ResultDataset } from '@/lib/results-data';

export const RESULT_ROW_LIMIT = 100;

export function ResultTable({ dataset, rowLimit = RESULT_ROW_LIMIT }: { dataset: ResultDataset; rowLimit?: number }) {
  const rows = dataset.rows.slice(0, rowLimit);
  return <>
    <div className="result-import-table-wrap">
      <table className="result-import-table">
        <thead><tr>{dataset.columns.map((column) => <th key={column.id}>{column.label}</th>)}</tr></thead>
        <tbody>{rows.map((row, rowIndex) => <tr key={`${rowIndex}-${row.join('|')}`}>
          {dataset.columns.map((column, columnIndex) => <td key={column.id}>{formatCell(row[columnIndex] ?? null)}</td>)}
        </tr>)}</tbody>
      </table>
    </div>
    {dataset.rows.length > rows.length && <p className="muted result-import-limit">처음 {rows.length}개 행만 표시하고 있어.</p>}
  </>;
}

export function ResultChart({ dataset, view, title }: { dataset: ResultDataset; view: ChartView; title?: string }) {
  const rows = dataset.rows.slice(0, RESULT_ROW_LIMIT);
  const seriesColumns = view.seriesColumns
    .filter((column) => Number.isInteger(column) && column >= 0 && column < dataset.columns.length && column !== view.xColumn)
    .filter((column, index, columns) => columns.indexOf(column) === index);
  const values = seriesColumns.flatMap((column) => rows
    .map((row) => numericValue(row[column]))
    .filter((value): value is number => value !== null));
  if (!seriesColumns.length || !values.length) return <div className="empty compact-empty">차트로 표시할 숫자 열이 없어.</div>;

  const chartRows = rows.map((row, index) => ({
    row,
    index,
    label: view.xColumn >= 0 ? formatCell(row[view.xColumn] ?? null) : `행 ${index + 1}`,
    xValue: view.xColumn >= 0 ? numericValue(row[view.xColumn] ?? null) : null,
  }));
  const useNumericX = view.xColumn >= 0 && chartRows.filter((item) => item.xValue !== null).length > 1;
  const numericX = chartRows.map((item) => item.xValue).filter((value): value is number => value !== null);
  const [xMin, xMax] = useNumericX
    ? chartDomain(Math.min(...numericX), Math.max(...numericX), view.xMin, view.xMax)
    : [0, Math.max(chartRows.length - 1, 1)];
  const dataYMin = view.chartType === 'scatter' ? Math.min(...values) : Math.min(0, ...values);
  const dataYMax = view.chartType === 'scatter' ? Math.max(...values) : Math.max(0, ...values);
  const [yMin, yMax] = chartDomain(dataYMin, dataYMax, view.yMin, view.yMax);
  const yRange = yMax - yMin || 1;
  const width = 760;
  const height = 320;
  const left = 56;
  const right = 20;
  const top = 24;
  const bottom = 52;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const xAt = (item: { index: number; xValue: number | null }) => {
    if (useNumericX && item.xValue !== null) return left + ((item.xValue - xMin) / (xMax - xMin || 1)) * plotWidth;
    return left + (item.index / Math.max(chartRows.length - 1, 1)) * plotWidth;
  };
  const yAt = (value: number) => top + ((yMax - value) / yRange) * plotHeight;
  const zeroY = yAt(Math.min(yMax, Math.max(yMin, 0)));
  const ticks = Array.from({ length: 5 }, (_, index) => yMin + (yRange * index) / 4).reverse();
  const colors = ['#2f7cf6', '#22c983', '#f59e0b', '#e55353', '#8b5cf6', '#0ea5e9'];
  const xLabelStep = Math.max(1, Math.ceil(chartRows.length / 8));

  return <div className="result-chart">
    <p className="muted result-chart-caption">
      {title || '차트'} · 가로축: {view.xColumn >= 0 ? dataset.columns[view.xColumn]?.label || '열' : '행'} · {seriesColumns.map((column) => dataset.columns[column].label).join(', ')}
    </p>
    <div className="result-svg-chart-wrap">
      <svg className="result-svg-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${title || '결과'} ${view.chartType} chart`}>
        {ticks.map((tick) => <g key={tick}>
          <line x1={left} x2={width - right} y1={yAt(tick)} y2={yAt(tick)} className="result-chart-gridline" />
          <text x={left - 8} y={yAt(tick) + 3} textAnchor="end" className="result-chart-axis-label">{formatAxisValue(tick)}</text>
        </g>)}
        <line x1={left} x2={width - right} y1={zeroY} y2={zeroY} className="result-chart-zero" />
        <line x1={left} x2={left} y1={top} y2={top + plotHeight} className="result-chart-axis" />
        <line x1={left} x2={width - right} y1={top + plotHeight} y2={top + plotHeight} className="result-chart-axis" />
        {view.chartType === 'bar' && seriesColumns.map((column, seriesIndex) => chartRows.map((item) => {
          const value = numericValue(item.row[column]);
          if (value === null) return null;
          const groupWidth = plotWidth / Math.max(chartRows.length, 1);
          const barWidth = Math.min(28, (groupWidth * 0.78) / seriesColumns.length);
          const groupStart = xAt(item) - (barWidth * seriesColumns.length) / 2;
          const y = yAt(value);
          return <rect key={`bar-${seriesIndex}-${item.index}`} x={groupStart + seriesIndex * barWidth} y={Math.min(y, zeroY)} width={Math.max(1, barWidth - 2)} height={Math.abs(zeroY - y)} fill={colors[seriesIndex % colors.length]} className="result-chart-mark" />;
        }))}
        {view.chartType === 'line' && seriesColumns.map((column, seriesIndex) => {
          const points = chartRows.map((item) => {
            const value = numericValue(item.row[column]);
            return value === null ? null : { x: xAt(item), y: yAt(value) };
          });
          return <g key={`line-${column}`}>
            {lineSegments(points).map((segment, segmentIndex) => <path key={segmentIndex} d={segment} fill="none" stroke={colors[seriesIndex % colors.length]} strokeWidth="2.5" className="result-chart-line" />)}
            {points.map((point, pointIndex) => point && <circle key={pointIndex} cx={point.x} cy={point.y} r="3" fill={colors[seriesIndex % colors.length]} className="result-chart-mark" />)}
          </g>;
        })}
        {view.chartType === 'scatter' && seriesColumns.map((column, seriesIndex) => chartRows.map((item) => {
          const value = numericValue(item.row[column]);
          if (value === null) return null;
          return <circle key={`scatter-${seriesIndex}-${item.index}`} cx={xAt(item)} cy={yAt(value)} r="4" fill={colors[seriesIndex % colors.length]} className="result-chart-mark" />;
        }))}
        {chartRows.map((item) => item.index % xLabelStep === 0 || item.index === chartRows.length - 1 ? <text key={`label-${item.index}`} x={xAt(item)} y={height - 25} textAnchor="middle" className="result-chart-axis-label">{truncate(item.label)}</text> : null)}
      </svg>
    </div>
    <div className="result-chart-legend">{seriesColumns.map((column, index) => <span key={dataset.columns[column].id}><i style={{ backgroundColor: colors[index % colors.length] }} />{dataset.columns[column].label}</span>)}</div>
  </div>;
}

function lineSegments(points: Array<{ x: number; y: number } | null>) {
  const segments: string[] = [];
  let current: string[] = [];
  for (const point of points) {
    if (!point) {
      if (current.length > 1) segments.push(current.join(' '));
      current = [];
      continue;
    }
    current.push(`${current.length ? 'L' : 'M'} ${point.x} ${point.y}`);
  }
  if (current.length > 1) segments.push(current.join(' '));
  return segments;
}

function formatCell(value: ResultCell) {
  if (value === null) return '—';
  if (typeof value === 'number') return value.toLocaleString('ko-KR', { maximumFractionDigits: 6 });
  return String(value);
}

function formatAxisValue(value: number) {
  return value.toLocaleString('ko-KR', { maximumFractionDigits: 3 });
}

function truncate(value: string) {
  return value.length > 14 ? `${value.slice(0, 13)}…` : value;
}

function chartDomain(dataMin: number, dataMax: number, requestedMin?: number, requestedMax?: number) {
  const min = requestedMin ?? dataMin;
  const max = requestedMax ?? dataMax;
  if (min > max) return expandDomain(dataMin, dataMax);
  if (min === max) return [min - 0.5, max + 0.5] as const;
  return [min, max] as const;
}

function expandDomain(min: number, max: number) {
  if (min !== max) return [min, max] as const;
  return [min - 0.5, max + 0.5] as const;
}
