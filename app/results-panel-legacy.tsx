'use client';

import { useEffect, useMemo, useState, type ChangeEvent, type ReactNode } from 'react';
import { ResultChart, ResultTable } from '@/app/result-view-components';
import { dashboardApi } from '@/lib/client-api';
import { groupFilesByParentFolder, projectStatusLabel, stageLabel, type ResearchProject } from '@/lib/projects';
import { emptyProjectResultInventory, projectResultInventory, type ProjectResultInventory } from '@/lib/project-results';
import type { RepositoryItem } from '@/lib/repository';
import type { DashboardBundle } from '@/lib/results';
import {
  datasetForView,
  defaultChartView,
  importResultFile,
  type ChartView,
  type ResultDataSource,
  type TableView,
} from '@/lib/results-data';

type ResultsPanelProps = {
  dashboard: DashboardBundle;
  loading?: boolean;
  projects?: ResearchProject[];
  tree?: RepositoryItem[];
  onOpen?: (path: string) => void;
  onOpenFolder?: (path: string) => void;
};

export function ResultsPanel({ dashboard, loading = false, projects = [], tree = [], onOpen, onOpenFolder }: ResultsPanelProps) {
  const inventories = useMemo(() => new Map(projects.map((project) => [project.id, projectResultInventory(project, tree)])), [projects, tree]);
  const defaultProjectId = useMemo(() => {
    const withDashboard = projects.find((project) => inventories.get(project.id)?.dashboardPath);
    return withDashboard?.id || projects.find((project) => project.id === 'thesis')?.id || projects.find((project) => project.status === 'active')?.id || projects[0]?.id || '';
  }, [inventories, projects]);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [selectedPeriod, setSelectedPeriod] = useState('');
  const [projectDashboard, setProjectDashboard] = useState<DashboardBundle | null>(null);
  const [projectDashboardLoading, setProjectDashboardLoading] = useState(false);
  const [projectDashboardError, setProjectDashboardError] = useState('');
  const [importedSource, setImportedSource] = useState<ResultDataSource | null>(null);
  const [importedDatasetIndex, setImportedDatasetIndex] = useState(0);
  const [importedView, setImportedView] = useState<'table' | 'chart'>('table');
  const [transpose, setTranspose] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');

  const selectedProject = projects.find((project) => project.id === selectedProjectId)
    || projects.find((project) => project.id === defaultProjectId)
    || null;
  const selectedInventory = selectedProject ? inventories.get(selectedProject.id) || emptyProjectResultInventory() : emptyProjectResultInventory();
  const selectedResultPath = selectedInventory.dashboardPath || '';
  const initialResultPath = dashboard.resultPath || '';

  useEffect(() => {
    if (defaultProjectId && !projects.some((project) => project.id === selectedProjectId)) setSelectedProjectId(defaultProjectId);
    if (!defaultProjectId && selectedProjectId) setSelectedProjectId('');
  }, [defaultProjectId, projects, selectedProjectId]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedProject) {
      setProjectDashboard(null);
      setProjectDashboardLoading(false);
      setProjectDashboardError('');
      return () => { cancelled = true; };
    }
    if (!tree.length) {
      setProjectDashboard(dashboard);
      setProjectDashboardLoading(false);
      setProjectDashboardError('');
      return () => { cancelled = true; };
    }
    if (!selectedResultPath) {
      setProjectDashboard(emptyDashboard('', '이 프로젝트에서 자동으로 찾은 결과 파일이 아직 없어.'));
      setProjectDashboardLoading(false);
      setProjectDashboardError('');
      return () => { cancelled = true; };
    }
    if (selectedResultPath === initialResultPath && !loading) {
      setProjectDashboard(dashboard);
      setProjectDashboardLoading(false);
      setProjectDashboardError('');
      return () => { cancelled = true; };
    }

    setProjectDashboard(null);
    setProjectDashboardLoading(true);
    setProjectDashboardError('');
    dashboardApi.results(selectedResultPath)
      .then((nextDashboard) => {
        if (cancelled) return;
        setProjectDashboard(nextDashboard);
      })
      .catch((error) => {
        if (cancelled) return;
        setProjectDashboardError(error instanceof Error ? error.message : '프로젝트 결과를 불러오지 못했어.');
        setProjectDashboard(emptyDashboard(selectedResultPath, '프로젝트 결과 dashboard를 불러오지 못했어.'));
      })
      .finally(() => {
        if (!cancelled) setProjectDashboardLoading(false);
      });
    return () => { cancelled = true; };
  }, [dashboard, initialResultPath, loading, selectedProject, selectedResultPath, tree.length]);

  useEffect(() => setSelectedPeriod(''), [selectedProjectId, selectedResultPath]);

  const activeDatasetIndex = importedSource
    ? Math.min(importedDatasetIndex, Math.max(importedSource.datasets.length - 1, 0))
    : 0;
  const importedDataset = importedSource?.datasets[activeDatasetIndex] || null;
  const tableDataset = useMemo(() => {
    if (!importedDataset) return null;
    const view: TableView = { type: 'table', datasetId: importedDataset.id, transpose };
    return datasetForView(importedDataset, view);
  }, [importedDataset, transpose]);
  const chartView = useMemo(
    () => importedDataset ? defaultChartView(importedDataset, transpose) : null,
    [importedDataset, transpose],
  );
  const chartDataset = useMemo(
    () => importedDataset && chartView ? datasetForView(importedDataset, chartView) : null,
    [importedDataset, chartView],
  );

  async function handleImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setImporting(true);
    setImportError('');
    try {
      const source = await importResultFile(file);
      setImportedSource(source);
      setImportedDatasetIndex(0);
      setImportedView('table');
      setTranspose(false);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : '결과 파일을 읽지 못했어.');
    } finally {
      setImporting(false);
    }
  }

  const activeDashboard = selectedProject ? projectDashboard || emptyDashboard(selectedResultPath) : dashboard;
  const activeLoading = selectedProject ? projectDashboardLoading || (loading && !projectDashboard) : loading;
  const hasCanonicalDashboard = Boolean(activeDashboard.necessaryLabour && activeDashboard.decomposition && activeDashboard.validation);
  const dashboardView = activeLoading && !hasCanonicalDashboard ? (
    <div className="card empty result-empty"><h3>분석 결과를 불러오는 중이야</h3><p>선택한 프로젝트의 검증된 결과 JSON을 확인하고 있어.</p></div>
  ) : hasCanonicalDashboard ? (
    <CanonicalResults dashboard={activeDashboard} selectedPeriod={selectedPeriod} onPeriodChange={setSelectedPeriod} />
  ) : (
    <div className="card empty result-empty">
      <h3>분석 결과를 불러올 수 없어</h3>
      <p>{projectDashboardError || activeDashboard.error || 'exporter를 실행하고 검증된 JSON을 GitHub에 반영해줘.'}</p>
      <code>python exporter/export_results.py</code>
    </div>
  );

  const importView = <section className="card section result-import-card">
      <div className="head result-import-head">
        <div>
          <h3>결과 파일 미리보기</h3>
          <span>{importedSource ? `${importedSource.name} · ${importedSource.format.toUpperCase()}` : 'CSV · TSV · XLSX'}</span>
        </div>
        <label className="btn primary result-file-button">
          {importing ? '읽는 중…' : '결과 파일 열기'}
          <input
            className="result-file-input"
            type="file"
            accept=".csv,.tsv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            disabled={importing}
            onChange={(event) => void handleImport(event)}
          />
        </label>
      </div>

      {importError && <div className="error result-import-error">{importError}</div>}
      {!importedSource || !importedDataset ? (
        <div className="note">로컬 결과 파일을 열면 원본 데이터를 바꾸지 않고 표 또는 간단한 차트로 확인할 수 있어. XLSX는 시트별로 분리해서 보여줘.</div>
      ) : (
        <>
          <div className="result-import-toolbar">
            <div className="result-import-meta">
              <b>{importedSource.name}</b>
              <span>{importedSource.datasets.length}개 dataset · {importedDataset.rows.length}개 행 · {importedDataset.columns.length}개 열</span>
            </div>
            {importedSource.datasets.length > 1 && (
              <label className="result-select">시트
                <select value={activeDatasetIndex} onChange={(event) => setImportedDatasetIndex(Number(event.target.value))}>
                  {importedSource.datasets.map((dataset, index) => <option value={index} key={dataset.id}>{dataset.sheetName || dataset.name}</option>)}
                </select>
              </label>
            )}
            <div className="tabs result-view-tabs" role="tablist" aria-label="결과 파일 표시 방식">
              <button className={importedView === 'table' ? 'active' : ''} type="button" onClick={() => setImportedView('table')}>표</button>
              <button className={importedView === 'chart' ? 'active' : ''} type="button" onClick={() => setImportedView('chart')}>차트</button>
            </div>
            <label className="result-checkbox"><input type="checkbox" checked={transpose} onChange={(event) => setTranspose(event.target.checked)} /> 행/열 바꾸기</label>
          </div>
          {importedView === 'chart' && chartDataset && chartView ? (
            <ResultChart dataset={chartDataset} view={chartView} />
          ) : tableDataset ? (
            <ResultTable dataset={tableDataset} />
          ) : null}
        </>
      )}
    </section>;

  if (!projects.length) return <>{dashboardView}{importView}</>;

  return <div className="project-workspace results-project-workspace">
    <ResultProjectList projects={projects} inventories={inventories} selectedId={selectedProject?.id || ''} onSelect={setSelectedProjectId} />
    {selectedProject && <div className="project-detail">
      <ResultProjectHero project={selectedProject} inventory={selectedInventory} onOpen={onOpen} />
      {dashboardView}
      <ProjectResultFiles inventory={selectedInventory} onOpen={onOpen} onOpenFolder={onOpenFolder} />
      {importView}
    </div>}
  </div>;
}

function ResultProjectList({ projects, inventories, selectedId, onSelect }: {
  projects: ResearchProject[];
  inventories: Map<string, ProjectResultInventory>;
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  return <aside className="card project-list result-project-list" aria-label="프로젝트별 분석 결과">
    <div className="project-list-head"><b>프로젝트별 결과</b><span>{projects.length}개</span></div>
    {projects.map((project) => {
      const inventory = inventories.get(project.id);
      return <button type="button" key={project.id} className={selectedId === project.id ? 'active' : ''} onClick={() => onSelect(project.id)}>
        <div><b>{project.title}</b><small>{stageLabel(project.stage)} · 결과 {inventory?.totalFiles || 0}개</small></div>
        <span className={`project-status ${project.status}`}>{projectStatusLabel(project.status)}</span>
      </button>;
    })}
  </aside>;
}

function ResultProjectHero({ project, inventory, onOpen }: { project: ResearchProject; inventory: ProjectResultInventory; onOpen?: (path: string) => void }) {
  return <section className="card project-hero result-project-hero">
    <div className="project-hero-top"><div><span className="project-eyebrow">분석 결과 · {projectStatusLabel(project.status)}</span><h3>{project.title}</h3><p>{project.summary || '프로젝트 매니페스트에 등록된 설명이 없어.'}</p></div>{onOpen && <button type="button" className="mini" onClick={() => onOpen(project.sourcePath)}>project.md 열기</button>}</div>
    <div className="project-focus"><span>대표 결과 경로</span><b><code>{inventory.dashboardPath || inventory.roots[0] || '자동 발견된 결과 없음'}</code></b></div>
  </section>;
}

function ProjectResultFiles({ inventory, onOpen, onOpenFolder }: { inventory: ProjectResultInventory; onOpen?: (path: string) => void; onOpenFolder?: (path: string) => void }) {
  const groups = useMemo(() => groupFilesByParentFolder(inventory.files), [inventory.files]);
  const root = inventory.roots[0]?.replace(/\/$/, '') || '';
  return <section className="card section section-gap result-project-files">
    <div className="head"><div><h3>프로젝트 결과 파일</h3><span>{inventory.totalFiles ? `${inventory.totalFiles}개 자동 발견` : '표준 경로 자동 탐색'}</span></div>{root && onOpenFolder && <button type="button" className="mini" onClick={() => onOpenFolder(root)}>결과 폴더 열기</button>}</div>
    {groups.length ? <div className="project-file-groups">{groups.map((group) => <details className="project-file-group" key={group.path}>
      <summary><span><b>{group.label}</b><small>{group.path || '저장소 루트'} · {group.files.length}개</small></span></summary>
      {onOpenFolder && <div className="project-file-group-actions"><button type="button" className="mini" onClick={() => onOpenFolder(group.path)}>폴더 열기</button></div>}
      <div className="project-file-list">{group.files.map((file) => <div className="project-file-row" key={file.path}><div><b>{basename(file.path)}</b><small>{file.path}</small></div>{onOpen && <button type="button" className="mini" onClick={() => onOpen(file.path)}>열기</button>}</div>)}</div>
    </details>)}</div> : <div className="note">`projects/&lt;project-id&gt;/코드/결과/`, `results/`, `outputs/`, `산출물/` 아래의 파일을 자동으로 찾고 있어. 매니페스트에 `결과 경로`를 추가하면 별도 경로도 연결할 수 있어.</div>}
    {inventory.totalFiles > inventory.files.length && <p className="muted result-file-limit">처음 {inventory.files.length}개 파일만 표시하고 있어.</p>}
  </section>;
}

function emptyDashboard(resultPath: string | null, error = 'Dashboard JSON이 없어.'): DashboardBundle {
  return { source: 'empty', resultPath, necessaryLabour: null, decomposition: null, validation: null, error };
}

function basename(path: string) { return path.split('/').pop() || path; }

function CanonicalResults({ dashboard, selectedPeriod, onPeriodChange }: {
  dashboard: DashboardBundle;
  selectedPeriod: string;
  onPeriodChange: (value: string) => void;
}) {
  const levels = dashboard.necessaryLabour?.series || [];
  const periods = dashboard.decomposition?.periods || [];
  const focus = periods.find((item) => item.period === selectedPeriod) || periods.find((item) => item.period === '2015-2020') || periods[0] || null;
  const maxLevel = Math.max(1, ...levels.map((item) => item.value));
  const contributions = focus
    ? [...focus.contributions].sort((a, b) => Math.abs(b.totalChange) - Math.abs(a.totalChange)).slice(0, 8)
    : [];

  return <>
    <div className="result-controls card section">
      <div>
        <b>검증된 canonical 결과</b>
        <span>{dashboard.source === 'github' ? 'GitHub live' : dashboard.source} · 계산 결과 JSON을 읽기 전용으로 표시</span>
      </div>
      <label className="result-select">분해 기간
        <select value={focus?.period || ''} onChange={(event) => onPeriodChange(event.target.value)}>
          {periods.map((item) => <option value={item.period} key={item.period}>{item.period}</option>)}
        </select>
      </label>
    </div>
    <div className="kpis">
      {levels.map((point) => <Kpi key={point.year} label={`${point.year}년`} value={`${formatHours(point.value)}h`} sub={`${point.sourceCell} · 2020년 가격`} />)}
      {dashboard.validation && <Kpi label="검증 상태" value={dashboard.validation.status === 'pass' ? '통과' : dashboard.validation.status.toUpperCase()} sub={`${dashboard.validation.checks.length}개 exporter 검사`} />}
    </div>
    <div className="grid2 results-grid">
      <ResultCard title="필요노동 추이" right={dashboard.source === 'github' ? 'GitHub live' : dashboard.source}>
        {levels.map((point) => <div className="result-bar" key={point.year}><span>{point.year}</span><div className="result-track"><div style={{ width: `${Math.max(0, point.value / maxLevel * 100)}%` }} /></div><b>{formatHours(point.value)}h</b></div>)}
      </ResultCard>
      <ResultCard title="기간별 2요인 분해" right="시간">
        <table className="result-table"><thead><tr><th>기간</th><th>변화량</th><th>바스켓</th><th>투하노동량</th></tr></thead><tbody>{periods.map((item) => <tr key={item.period}><td>{item.period}</td><td>{signed(item.totalChange)}</td><td>{signed(item.basketEffect)}</td><td>{signed(item.embodiedLabourEffect)}</td></tr>)}</tbody></table>
      </ResultCard>
    </div>
    <div className="grid2 results-grid">
      <ResultCard title={`주요 부문 변화 · ${focus?.period || '기간 없음'}`} right="절대값 순">
        {focus ? <table className="result-table"><thead><tr><th>코드</th><th>부문</th><th>변화량</th></tr></thead><tbody>{contributions.map((item) => <tr key={item.code}><td>{item.code}</td><td>{item.name}</td><td>{signed(item.totalChange)}</td></tr>)}</tbody></table> : <div className="empty compact-empty">선택 가능한 분해 기간이 없어.</div>}
      </ResultCard>
      {dashboard.validation && <ResultCard title="결과 검증" right={dashboard.validation.scope}>
        {dashboard.validation.checks.map((check) => <div className="validation-row" key={check.id}><b>{check.status === 'pass' ? '통과' : check.status.toUpperCase()}</b><span>{check.message}</span></div>)}
        <p className="muted validation-limit">{dashboard.validation.limitation}</p>
      </ResultCard>}
    </div>
    {dashboard.necessaryLabour && dashboard.decomposition && dashboard.validation && <div className="note result-source">출처: <code>{dashboard.necessaryLabour.source.workbook}</code> · <code>{dashboard.decomposition.source.workbook}</code> · 생성 {formatDate(dashboard.validation.generatedAt)}</div>}
  </>;
}

function ResultCard({ title, right, children }: { title: string; right?: string; children: ReactNode }) {
  return <div className="card section"><div className="head"><h3>{title}</h3><span>{right}</span></div>{children}</div>;
}

function Kpi({ label, value, sub }: { label: string; value: string; sub: string }) {
  return <div className="card kpi"><small>{label}</small><strong>{value}</strong><span>{sub}</span></div>;
}

function formatHours(value: number) {
  return value.toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function signed(value: number) {
  return `${value >= 0 ? '+' : ''}${formatHours(value)}`;
}

function formatDate(value: string) {
  if (!value) return '';
  try {
    return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
  } catch {
    return value;
  }
}
