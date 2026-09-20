type ResearchTrendPoint = {
  year: number;
  value: number;
};

type ResearchMiniTrendProps = {
  series: ResearchTrendPoint[];
  sourceLabel?: string;
  className?: string;
};

const CHART_WIDTH = 420;
const CHART_HEIGHT = 126;
const CHART_PADDING = { top: 12, right: 12, bottom: 28, left: 12 };

export function ResearchMiniTrend({ series, sourceLabel = '필요노동 · 시간', className = '' }: ResearchMiniTrendProps) {
  const points = series
    .filter((point) => Number.isFinite(point.year) && Number.isFinite(point.value))
    .slice()
    .sort((left, right) => left.year - right.year);

  if (!points.length) {
    return <div className={`research-mini-trend research-mini-trend-empty${className ? ` ${className}` : ''}`}>결과 데이터가 없어.</div>;
  }

  const values = points.map((point) => point.value);
  const valueMin = Math.min(...values);
  const valueMax = Math.max(...values);
  const valueRange = valueMax - valueMin || Math.max(Math.abs(valueMax) * 0.05, 1);
  const yMin = valueMin - valueRange * 0.14;
  const yMax = valueMax + valueRange * 0.14;
  const plotWidth = CHART_WIDTH - CHART_PADDING.left - CHART_PADDING.right;
  const plotHeight = CHART_HEIGHT - CHART_PADDING.top - CHART_PADDING.bottom;
  const xAt = (index: number) => CHART_PADDING.left + (index / Math.max(points.length - 1, 1)) * plotWidth;
  const yAt = (value: number) => CHART_PADDING.top + ((yMax - value) / (yMax - yMin || 1)) * plotHeight;
  const chartPoints = points.map((point, index) => `${xAt(index)},${yAt(point.value)}`).join(' ');
  const latest = points[points.length - 1];
  const first = points[0];

  return <div className={`research-mini-trend${className ? ` ${className}` : ''}`}>
    <div className="research-mini-trend-head">
      <span>{sourceLabel}</span>
      <span>{first.year} → {latest.year}</span>
    </div>
    <svg
      className="research-mini-trend-chart"
      viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
      role="img"
      aria-label={`${sourceLabel}: ${points.map((point) => `${point.year}년 ${formatTrendValue(point.value)}`).join(', ')}`}
    >
      <line className="research-mini-trend-guide" x1={CHART_PADDING.left} x2={CHART_WIDTH - CHART_PADDING.right} y1={CHART_PADDING.top + plotHeight / 2} y2={CHART_PADDING.top + plotHeight / 2} />
      <polyline className="research-mini-trend-line" fill="none" points={chartPoints} />
      {points.map((point, index) => <g key={point.year}>
        <circle className="research-mini-trend-point" cx={xAt(index)} cy={yAt(point.value)} r="4" />
        <text className="research-mini-trend-year" x={xAt(index)} y={CHART_HEIGHT - 8} textAnchor="middle">{point.year}</text>
      </g>)}
    </svg>
    <div className="research-mini-trend-reading">
      <strong>{formatTrendValue(latest.value)}</strong>
      <span>최근 관측값 · 시간</span>
    </div>
  </div>;
}

function formatTrendValue(value: number) {
  return value.toLocaleString('ko-KR', { maximumFractionDigits: 1 });
}
