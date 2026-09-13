'use client';

import { useEffect, useMemo, useState } from 'react';
import { ResultsPanel as LegacyResultsPanel } from '@/app/results-panel-legacy';
import { StandardResultsView } from '@/app/standard-results-view';
import { dashboardApi } from '@/lib/client-api';
import { groupFilesByParentFolder, projectStatusLabel, stageLabel, type ResearchProject } from '@/lib/projects';
import { emptyProjectResultInventory, projectResultInventory, type ProjectResultInventory } from '@/lib/project-results';
import type { RepositoryItem } from '@/lib/repository';
import type { DashboardBundle } from '@/lib/results';

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
    const withStandard = projects.find((project) => inventories.get(project.id)?.standardPath);
    const withDashboard = projects.find((project) => inventories.get(project.id)?.dashboardPath);
    return withStandard?.id || withDashboard?.id || projects.find((project) => project.id === 'thesis')?.id || projects.find((project) => project.status === 'active')?.id || projects[0]?.id || '';
  }, [inventories, projects]);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [fallbackDashboard, setFallbackDashboard] = useState<DashboardBundle>(dashboard);
  const [fallbackLoading, setFallbackLoading] = useState(loading);

  const selectedProject = projects.find((project) => project.id === selectedProjectId)
    || projects.find((project) => project.id === defaultProjectId)
    || null;
  const selectedInventory = selectedProject ? inventories.get(selectedProject.id) || emptyProjectResultInventory() : emptyProjectResultInventory();

  useEffect(() => {
    if (defaultProjectId && !projects.some((project) => project.id === selectedProjectId)) setSelectedProjectId(defaultProjectId);
    if (!defaultProjectId && selectedProjectId) setSelectedProjectId('');
  }, [defaultProjectId, projects, selectedProjectId]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedProject || selectedInventory.standardPath) {
      setFallbackLoading(false);
      return () => { cancelled = true; };
    }

    const resultPath = selectedInventory.dashboardPath || '';
    if (!resultPath) {
      setFallbackDashboard(emptyDashboard('', '이 프로젝트에서 자동으로 찾은 표시 가능한 결과가 아직 없어.'));
      setFallbackLoading(false);
      return () => { cancelled = true; };
    }
    if (resultPath === dashboard.resultPath && !loading) {
      setFallbackDashboard(dashboard);
      setFallbackLoading(false);
      return () => { cancelled = true; };
    }

    setFallbackLoading(true);
    dashboardApi.results(resultPath)
      .then((nextDashboard) => {
        if (!cancelled) setFallbackDashboard(nextDashboard);
      })
      .catch((error) => {
        if (!cancelled) setFallbackDashboard(emptyDashboard(resultPath, error instanceof Error ? error.message : '프로젝트 결과를 불러오지 못했어.'));
      })
      .finally(() => {
        if (!cancelled) setFallbackLoading(false);
      });
    return () => { cancelled = true; };
  }, [dashboard, loading, selectedInventory.dashboardPath, selectedInventory.standardPath, selectedProject]);

  if (!projects.length) {
    return <LegacyResultsPanel dashboard={dashboard} loading={loading} projects={projects} tree={tree} onOpen={onOpen} onOpenFolder={onOpenFolder} />;
  }

  return <div className="project-workspace results-project-workspace">
    <ResultProjectList projects={projects} inventories={inventories} selectedId={selectedProject?.id || ''} onSelect={setSelectedProjectId} />
    {selectedProject && <div className="project-detail">
      <ResultProjectHero project={selectedProject} inventory={selectedInventory} onOpen={onOpen} />
      {selectedInventory.standardPath
        ? <StandardResultsView resultPath={selectedInventory.standardPath} />
        : <LegacyResultsPanel dashboard={fallbackDashboard} loading={fallbackLoading} projects={[]} tree={[]} onOpen={onOpen} onOpenFolder={onOpenFolder} />}
      <ProjectResultFiles inventory={selectedInventory} onOpen={onOpen} onOpenFolder={onOpenFolder} />
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
      const mode = inventory?.standardPath ? '표준' : inventory?.dashboardPath ? 'dashboard' : '파일';
      return <button type="button" key={project.id} className={selectedId === project.id ? 'active' : ''} onClick={() => onSelect(project.id)}>
        <div><b>{project.title}</b><small>{stageLabel(project.stage)} · {mode} · 결과 {inventory?.totalFiles || 0}개</small></div>
        <span className={`project-status ${project.status}`}>{projectStatusLabel(project.status)}</span>
      </button>;
    })}
  </aside>;
}

function ResultProjectHero({ project, inventory, onOpen }: { project: ResearchProject; inventory: ProjectResultInventory; onOpen?: (path: string) => void }) {
  const primaryPath = inventory.standardPath || inventory.dashboardPath || inventory.roots[0] || '';
  return <section className="card project-hero result-project-hero">
    <div className="project-hero-top"><div><span className="project-eyebrow">분석 결과 · {projectStatusLabel(project.status)}</span><h3>{project.title}</h3><p>{project.summary || '프로젝트 매니페스트에 등록된 설명이 없어.'}</p></div>{onOpen && <button type="button" className="mini" onClick={() => onOpen(project.sourcePath)}>project.md 열기</button>}</div>
    <div className="project-focus"><span>대표 결과 경로</span><b><code>{primaryPath || '자동 발견된 결과 없음'}</code></b></div>
  </section>;
}

function ProjectResultFiles({ inventory, onOpen, onOpenFolder }: { inventory: ProjectResultInventory; onOpen?: (path: string) => void; onOpenFolder?: (path: string) => void }) {
  const groups = useMemo(() => groupFilesByParentFolder(inventory.files), [inventory.files]);
  const root = (inventory.standardPath || inventory.roots[0] || '').replace(/\/$/, '');
  return <section className="card section section-gap result-project-files">
    <div className="head"><div><h3>프로젝트 결과 파일</h3><span>{inventory.totalFiles ? `${inventory.totalFiles}개 자동 발견` : '표준 경로 자동 탐색'}</span></div>{root && onOpenFolder && <button type="button" className="mini" onClick={() => onOpenFolder(root)}>결과 폴더 열기</button>}</div>
    {groups.length ? <div className="project-file-groups">{groups.map((group) => <details className="project-file-group" key={group.path}>
      <summary><span><b>{group.label}</b><small>{group.path || '저장소 루트'} · {group.files.length}개</small></span></summary>
      {onOpenFolder && <div className="project-file-group-actions"><button type="button" className="mini" onClick={() => onOpenFolder(group.path)}>폴더 열기</button></div>}
      <div className="project-file-list">{group.files.map((file) => <div className="project-file-row" key={file.path}><div><b>{basename(file.path)}</b><small>{file.path}</small></div>{onOpen && <button type="button" className="mini" onClick={() => onOpen(file.path)}>열기</button>}</div>)}</div>
    </details>)}</div> : <div className="note">표준 결과는 <code>results/result.json</code>, <code>view.json</code>, <code>sources/scalar.csv</code>, <code>sources/matrix.xlsx</code>를 자동으로 찾아.</div>}
    {inventory.totalFiles > inventory.files.length && <p className="muted result-file-limit">처음 {inventory.files.length}개 파일만 표시하고 있어.</p>}
  </section>;
}

function basename(path: string) { return path.split('/').pop() || path; }

function emptyDashboard(resultPath: string | null, error: string): DashboardBundle {
  return { source: 'empty', resultPath, necessaryLabour: null, decomposition: null, validation: null, error };
}
