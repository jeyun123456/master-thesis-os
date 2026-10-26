'use client';

import { useEffect, useMemo, useState } from 'react';
import { dashboardApi } from '@/lib/client-api';
import { ResultsPanel as LegacyResultsPanel } from '@/app/results-panel';
import { StandardResultsView } from '@/app/standard-results-view';
import type { DashboardBundle } from '@/lib/results';
import { emptyProjectResultInventory, projectResultInventory } from '@/lib/project-results';
import type { RepositoryItem } from '@/lib/repository';
import {
  PROJECTS_ROOT,
  isThesisProject,
  pipelineStageValue,
  projectStatusLabel,
  projectStatusOptions,
  researchPipelineStages,
  type ResearchProject,
} from '@/lib/projects';
import type { Milestone, TaskMeta } from '@/lib/mtos-planning';
import type { P0Task } from '@/lib/p0-tasks-client';
import { ResearchKanban, type KanbanViewState } from '@/app/research-kanban';
import { BlockersSection, MemosSection, MilestonesSection, ProjectTasksSection } from '@/app/project-sections';

export type ResearchWorkspaceData = {
  tasks: P0Task[];
  tasksState: 'loading' | 'ready' | 'error';
  tasksError: string;
  meta: Map<string, TaskMeta>;
  milestones: Milestone[];
  agentState: 'loading' | 'ready' | 'error';
  agentError: string;
  reloadTasks: () => void;
  reloadAgent: () => void;
};

type ResearchResultsChoice = { key: string; label: string; path: string; type: 'standard' | 'dashboard' };

export function ResearchPanel({ projects: projectsInput, tree: treeInput, projectsLoading = false, projectsError = '', selectedProjectId, expandedFolders = new Set<string>(), onToggleProjectFolder, onProjectSelected, onProjectStatusChange, onOpen, onOpenFolder, workspaceData, view = 'detail', onViewChange, kanbanState, onKanbanStateChange, onOpenTask }: {
  workspaceData?: ResearchWorkspaceData;
  view?: 'board' | 'detail';
  onViewChange?: (view: 'board' | 'detail') => void;
  kanbanState?: KanbanViewState;
  onKanbanStateChange?: (state: KanbanViewState) => void;
  onOpenTask?: (taskId: string) => void;
  projects: ResearchProject[] | null;
  tree: RepositoryItem[] | null;
  projectsLoading?: boolean;
  projectsError?: string;
  selectedProjectId?: string;
  expandedFolders?: Set<string>;
  onToggleProjectFolder?: (path: string) => void;
  onProjectSelected?: (id: string) => void;
  onProjectStatusChange?: (project: ResearchProject) => void;
  onOpen: (path: string) => void;
  onOpenFolder: (path: string) => void;
}) {
  const projects = Array.isArray(projectsInput) ? projectsInput.flatMap(normalizeProject) : [];
  const tree = Array.isArray(treeInput) ? treeInput : [];
  const defaultId = projects.find(isThesisProject)?.id || projects.find((project) => project.status === 'active')?.id || projects[0]?.id || '';
  const selectedId = selectedProjectId && projects.some((project) => project.id === selectedProjectId) ? selectedProjectId : defaultId;
  const [statusSaving, setStatusSaving] = useState(false);
  const [stageSaving, setStageSaving] = useState(false);
  const [favoriteSaving, setFavoriteSaving] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState('');
  const [resultChoice, setResultChoice] = useState('');
  const selectedBase = projects.find((project) => project.id === selectedId) || null;
  const selected = selectedBase;
  const fallbackFiles = useMemo(() => selected ? tree.filter((item) => item.type === 'blob' && item.path.startsWith(`${PROJECTS_ROOT}/${selected.id}/`)) : [], [selected, tree]);
  const files = useMemo<RepositoryItem[]>(() => fallbackFiles.map((item) => ({ path: item.path, type: 'blob', ...(item.size !== undefined ? { size: item.size } : {}) })), [fallbackFiles]);
  const inventory = useMemo(() => selected ? projectResultInventory(selected, files) : emptyProjectResultInventory(), [files, selected]);
  const choices = useMemo(() => resultChoices(inventory), [inventory]);
  const chosen = choices.find((choice) => choice.key === resultChoice) || null;

  useEffect(() => { setResultChoice(''); }, [selectedBase?.id]);

  if (!projects.length) {
    if (projectsLoading) return <div className="card empty project-empty" role="status">연구 프로젝트를 불러오는 중…</div>;
    if (projectsError) return <div className="card error project-empty" role="alert">연구 프로젝트를 불러오지 못했어. {projectsError}</div>;
    return <div className="card empty project-empty"><code>02_Projects/*/project.md</code>가 생기면 프로젝트별 연구 화면이 자동으로 구성돼.</div>;
  }

  function selectProject(id: string) {
    onProjectSelected?.(id);
    setStatusMessage('');
  }

  async function updateStatus(status: string) {
    if (!selected || status === selected.status || statusSaving) return;
    setStatusSaving(true);
    setStatusMessage('저장 중…');
    try {
      const result = await dashboardApi.updateProjectStatus(selected.id, status, selected.sourceSha);
      onProjectStatusChange?.({ ...result.project, sourceSha: result.sha });
      setStatusMessage('저장했어.');
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : '상태 저장에 실패했어.');
    } finally {
      setStatusSaving(false);
    }
  }

  async function updateStage(stage: string) {
    if (!selected || pipelineStageValue(selected.stage) === stage || stageSaving) return;
    setStageSaving(true);
    setStatusMessage('단계를 저장 중…');
    try {
      const result = await dashboardApi.updateProjectStage(selected.id, stage, selected.sourceSha);
      onProjectStatusChange?.({ ...result.project, sourceSha: result.sha });
      setStatusMessage('연구 단계를 저장했어.');
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : '연구 단계 저장에 실패했어.');
    } finally {
      setStageSaving(false);
    }
  }

  const workingFolders = inferFolders(files.map((file) => file.path));
  const keyFilePaths = selected ? selected.keyFiles.map((path) => path.startsWith(`${PROJECTS_ROOT}/`) ? path : `${PROJECTS_ROOT}/${selected.id}/${path}`) : [];
  const keyFiles = files.filter((file) => keyFilePaths.includes(file.path));

  if (view === 'board' && workspaceData && kanbanState && onKanbanStateChange) {
    return <ResearchKanban projects={projects} tasks={workspaceData.tasks} tasksState={workspaceData.tasksState} meta={workspaceData.meta} milestones={workspaceData.milestones}
      view={kanbanState} onViewChange={onKanbanStateChange} onSelect={(id, state) => { onKanbanStateChange(state); selectProject(id); onViewChange?.('detail'); }} />;
  }

  return <div className="project-detail project-detail-full">
    {onViewChange && <button type="button" className="mini project-back" onClick={() => onViewChange('board')}>← 연구 프로젝트 보드</button>}
    {selected && <>
      {workspaceData && <ProjectTasksSection projectId={selected.id} tasks={workspaceData.tasks} tasksState={workspaceData.tasksState} tasksError={workspaceData.tasksError} meta={workspaceData.meta}
        onChanged={workspaceData.reloadTasks} onOpenTask={(taskId) => onOpenTask?.(taskId)} />}

      <section className="card project-hero section-gap">
        <div className="project-hero-top">
          <div><span className="project-eyebrow">{projectStatusLabel(selected.status)} · 우선순위 {priorityLabel(selected.priority)}</span><h3>{selected.title}</h3><p>{selected.summary}</p></div>
          <div className="project-hero-actions">
            <label className="project-status-editor">상태<select value={selected.status} disabled={statusSaving || !selected.sourceSha} onChange={(event) => void updateStatus(event.target.value)}>
              {!projectStatusOptions.some((option) => option.value === selected.status) && <option value={selected.status}>{projectStatusLabel(selected.status)} · 기존 값</option>}
              {projectStatusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select></label>
            <button className="mini" onClick={() => onOpen(selected.sourcePath)}>project.md 열기</button>
          </div>
        </div>
        {statusMessage && <div className={statusMessage.includes('저장') ? 'project-status-message' : 'error project-status-message'} role="status">{statusMessage}</div>}
        <div className="project-focus"><span>연구 목적 / 핵심 문제의식</span><b>{selected.currentFocus || selected.summary || '프로젝트 설명을 project.md에 추가해줘.'}</b></div>
      </section>

      <section className="card section project-pipeline-section">
        <div className="head"><h3>연구 파이프라인</h3><label className="project-stage-editor">현재 단계<select value={pipelineStageValue(selected.stage)} disabled={stageSaving || !selected.sourceSha} onChange={(event) => void updateStage(event.target.value)}>
          {researchPipelineStages.map((stage) => <option key={stage.value} value={stage.value}>{stage.label}</option>)}
        </select></label></div>
        <div className="research-pipeline-compact" aria-label="6단계 연구 파이프라인">
          {researchPipelineStages.map((stage, index) => <span className={`research-pipeline-step${pipelineStageValue(selected.stage) === stage.value ? ' active' : ''}`} key={stage.value}>
            {index > 0 && <i aria-hidden="true">→</i>}<b>{stage.label}</b>
          </span>)}
        </div>
      </section>

      {workspaceData && <div className="section-gap"><MilestonesSection projectId={selected.id} milestones={workspaceData.milestones} agentState={workspaceData.agentState} agentError={workspaceData.agentError} onChanged={workspaceData.reloadAgent} /></div>}
      {workspaceData && <div className="section-gap"><BlockersSection projectId={selected.id} manifestBlocked={selected.blocked} tasks={workspaceData.tasks} meta={workspaceData.meta} /></div>}

      <div className="grid2 section-gap">
        <ProjectSection title="연구 질문" items={selected.questions} empty="등록된 연구 질문이 없어." numbered={false} />
        <MemosSection projectId={selected.id} />
      </div>
      <section className="card section section-gap research-favorites">
        <div className="head"><h3>주요 파일 · 원본</h3><span>즐겨찾기 {keyFiles.length}개</span></div>
        {keyFiles.length ? <ul>{keyFiles.map((file) => <li key={file.path}>
          <button type="button" className="research-favorite-open" title={file.path} onClick={() => onOpen(file.path)}>▧ {file.path.split('/').pop()}</button>
        </li>)}</ul> : <div className="empty compact-empty">project.md의 ‘주요 파일’에 적은 파일이 여기에 표시돼.</div>}
      </section>

      <section className="card section section-gap">
        <div className="head"><h3>분석 결과</h3><span>{choices.length}개 선택 가능</span></div>
        <label className="research-result-picker">결과 선택
          <select value={resultChoice} onChange={(event) => setResultChoice(event.target.value)}>
            <option value="">분석 결과를 선택해주세요</option>
            {choices.map((choice) => <option key={choice.key} value={choice.key}>{choice.label}</option>)}
          </select>
        </label>
        {!chosen ? <div className="empty compact-empty">분석 결과를 선택해주세요</div>
          : chosen.type === 'standard' ? <StandardResultsView resultPath={chosen.path} />
            : <DashboardResultView path={chosen.path} onOpen={onOpen} onOpenFolder={onOpenFolder} />}
      </section>

      <section className="card section section-gap research-folder-section">
        <div className="head"><h3>작업 폴더</h3><button className="mini" type="button" onClick={() => onOpenFolder(`${PROJECTS_ROOT}/${selected.id}`)}>프로젝트 폴더 열기</button></div>
        <ProjectFolderTree root={`${PROJECTS_ROOT}/${selected.id}`} files={files} folders={workingFolders} expandedFolders={expandedFolders} keyFilePaths={keyFilePaths} favoriteSaving={null} canSaveMetadata={false} onToggleExpanded={onToggleProjectFolder} onToggleFavorite={() => undefined} onOpen={onOpen} onOpenFolder={onOpenFolder} />
      </section>

    </>}
  </div>;
}

function DashboardResultView({ path, onOpen, onOpenFolder }: { path: string; onOpen: (path: string) => void; onOpenFolder: (path: string) => void }) {
  const [dashboard, setDashboard] = useState<DashboardBundle | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setDashboard(null);
    setError('');
    void dashboardApi.results(path).then((value) => { if (active) setDashboard(value); }).catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : '분석 결과를 읽지 못했어.');
    });
    return () => { active = false; };
  }, [path]);
  if (error) return <div className="error">{error}</div>;
  if (!dashboard) return <div className="empty compact-empty">선택한 분석 결과를 불러오는 중…</div>;
  return <LegacyResultsPanel dashboard={dashboard} loading={false} projects={[]} tree={[]} onOpen={onOpen} onOpenFolder={onOpenFolder} />;
}

function ProjectFolderTree({ root, files, folders, expandedFolders, keyFilePaths, favoriteSaving, canSaveMetadata, onToggleExpanded, onToggleFavorite, onOpen, onOpenFolder }: {
  root: string;
  files: RepositoryItem[];
  folders: string[];
  expandedFolders: Set<string>;
  keyFilePaths: string[];
  favoriteSaving: string | null;
  canSaveMetadata: boolean;
  onToggleExpanded?: (path: string) => void;
  onToggleFavorite: (path: string) => void;
  onOpen: (path: string) => void;
  onOpenFolder: (path: string) => void;
}) {
  const children = useMemo(() => folderChildren(root, files.map((file) => file.path), folders), [files, folders, root]);
  const rootFiles = files.filter((file) => file.path.startsWith(`${root}/`) && file.path.slice(root.length + 1).indexOf('/') < 0);
  if (!children.length && !rootFiles.length) return <div className="empty compact-empty">프로젝트 작업 폴더에 표시할 파일이 없어.</div>;
  return <div className="project-tree" role="tree">
    {rootFiles.length > 0 && <ul>{rootFiles.map((file) => <li key={file.path}><div className="project-tree-file-row">
      <button type="button" className="project-tree-file" title={file.path} onClick={() => onOpen(file.path)}>▧ {file.path.split('/').pop()}</button>
      <button type="button" className={`project-tree-favorite${keyFilePaths.includes(file.path) ? ' active' : ''}`} title={keyFilePaths.includes(file.path) ? '주요 파일에서 제거' : '주요 파일에 추가'} aria-label={`${file.path} ${keyFilePaths.includes(file.path) ? '주요 파일에서 제거' : '주요 파일에 추가'}`} disabled={!canSaveMetadata || favoriteSaving === file.path} onClick={() => onToggleFavorite(file.path)}>{keyFilePaths.includes(file.path) ? '★' : '☆'}</button>
    </div></li>)}</ul>}
    <FolderNodes nodes={children} expandedFolders={expandedFolders} keyFilePaths={keyFilePaths} favoriteSaving={favoriteSaving} canSaveMetadata={canSaveMetadata} onToggleExpanded={onToggleExpanded} onToggleFavorite={onToggleFavorite} onOpen={onOpen} onOpenFolder={onOpenFolder} />
  </div>;
}

type FolderNode = { name: string; path: string; folders: FolderNode[]; files: string[] };

function folderChildren(root: string, filePaths: string[], folderPaths: string[]): FolderNode[] {
  const nodes = new Map<string, FolderNode>();
  const ensure = (path: string) => {
    const name = path.split('/').pop() || path;
    let node = nodes.get(path);
    if (!node) { node = { name, path, folders: [], files: [] }; nodes.set(path, node); }
    return node;
  };
  for (const folder of folderPaths) {
    if (folder === root || !folder.startsWith(`${root}/`)) continue;
    ensure(folder);
    const parent = folder.slice(0, folder.lastIndexOf('/'));
    if (parent.startsWith(root)) ensure(parent).folders.push(ensure(folder));
  }
  for (const file of filePaths) {
    if (!file.startsWith(`${root}/`)) continue;
    const parent = file.slice(0, file.lastIndexOf('/'));
    ensure(parent).files.push(file);
    let current = parent;
    while (current.startsWith(root) && current !== root) {
      const node = ensure(current);
      const ancestor = current.slice(0, current.lastIndexOf('/'));
      if (ancestor.startsWith(root)) ensure(ancestor).folders.push(node);
      if (ancestor === current) break;
      current = ancestor;
    }
  }
  const roots = [...nodes.values()].filter((node) => node.path.startsWith(`${root}/`) && node.path.slice(root.length + 1).split('/').length === 1);
  const deduplicate = (node: FolderNode) => {
    node.folders = [...new Map(node.folders.map((child) => [child.path, child])).values()].sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    node.files = [...new Set(node.files)].sort((a, b) => a.localeCompare(b, 'ko'));
    node.folders.forEach(deduplicate);
  };
  roots.forEach(deduplicate);
  return roots.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
}

function FolderNodes({ nodes, expandedFolders, keyFilePaths, favoriteSaving, canSaveMetadata, onToggleExpanded, onToggleFavorite, onOpen, onOpenFolder }: {
  nodes: FolderNode[];
  expandedFolders: Set<string>;
  keyFilePaths: string[];
  favoriteSaving: string | null;
  canSaveMetadata: boolean;
  onToggleExpanded?: (path: string) => void;
  onToggleFavorite: (path: string) => void;
  onOpen: (path: string) => void;
  onOpenFolder: (path: string) => void;
}) {
  return <ul>{nodes.map((node) => <li key={node.path}>
    <div className="project-tree-folder-row">
      <button type="button" className="project-tree-folder" aria-expanded={expandedFolders.has(node.path)} onClick={() => onToggleExpanded?.(node.path)}><span aria-hidden="true">{expandedFolders.has(node.path) ? '▾' : '▸'}</span> {node.name}</button>
      <button type="button" className="project-tree-open-folder" title={node.path} aria-label={`${node.path} 폴더 열기`} onClick={() => onOpenFolder(node.path)}>↗</button>
    </div>
    {expandedFolders.has(node.path) && <>
      {node.folders.length > 0 && <FolderNodes nodes={node.folders} expandedFolders={expandedFolders} keyFilePaths={keyFilePaths} favoriteSaving={favoriteSaving} canSaveMetadata={canSaveMetadata} onToggleExpanded={onToggleExpanded} onToggleFavorite={onToggleFavorite} onOpen={onOpen} onOpenFolder={onOpenFolder} />}
      {node.files.length > 0 && <ul>{node.files.map((path) => <li key={path}><div className="project-tree-file-row">
        <button type="button" className="project-tree-file" title={path} onClick={() => onOpen(path)}>▧ {path.split('/').pop()}</button>
        <button type="button" className={`project-tree-favorite${keyFilePaths.includes(path) ? ' active' : ''}`} title={keyFilePaths.includes(path) ? '주요 파일에서 제거' : '주요 파일에 추가'} aria-label={`${path} ${keyFilePaths.includes(path) ? '주요 파일에서 제거' : '주요 파일에 추가'}`} disabled={!canSaveMetadata || favoriteSaving === path} onClick={() => onToggleFavorite(path)}>{keyFilePaths.includes(path) ? '★' : '☆'}</button>
      </div></li>)}</ul>}
    </>}
  </li>)}</ul>;
}

function resultChoices(inventory: ReturnType<typeof emptyProjectResultInventory>): ResearchResultsChoice[] {
  const choices: ResearchResultsChoice[] = [];
  if (inventory.standardPath) choices.push({ key: `standard:${inventory.standardPath}`, label: `표준 분석 · ${inventory.standardPath}`, path: inventory.standardPath, type: 'standard' });
  if (inventory.dashboardPath) choices.push({ key: `dashboard:${inventory.dashboardPath}`, label: `대시보드 · ${inventory.dashboardPath}`, path: inventory.dashboardPath, type: 'dashboard' });
  return choices;
}

function inferFolders(paths: string[]): string[] {
  return [...new Set(paths.map((path) => path.slice(0, path.lastIndexOf('/'))))];
}

function normalizeProject(value: unknown): ResearchProject[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const project = value as Partial<ResearchProject>;
  if (typeof project.id !== 'string' || !project.id) return [];
  const text = (candidate: unknown, fallback = '') => typeof candidate === 'string' ? candidate : fallback;
  const strings = (candidate: unknown) => Array.isArray(candidate) ? candidate.filter((item): item is string => typeof item === 'string') : [];
  return [{
    id: project.id,
    title: text(project.title, project.id),
    status: text(project.status, 'waiting'),
    priority: text(project.priority, 'medium'),
    stage: text(project.stage, 'unknown'),
    updated: text(project.updated),
    sourcePath: text(project.sourcePath, `${PROJECTS_ROOT}/${project.id}/project.md`),
    ...(typeof project.sourceSha === 'string' ? { sourceSha: project.sourceSha } : {}),
    summary: text(project.summary),
    currentFocus: text(project.currentFocus),
    questions: strings(project.questions),
    keyFiles: strings(project.keyFiles),
    nextTasks: strings(project.nextTasks),
    blocked: strings(project.blocked),
    relatedPaths: strings(project.relatedPaths),
    resultPaths: strings(project.resultPaths),
  }];
}




function ProjectSection({ title, items, empty, numbered, onOpen }: { title: string; items: string[]; empty: string; numbered: boolean; onOpen?: (path: string) => void }) {
  return <section className="card section"><div className="head"><h3>{title}</h3><span>{items.length ? `${items.length}개` : '없음'}</span></div>{items.length ? <div className="project-text-list">{items.map((item, index) => <div key={`${item}-${index}`} className="project-text-row">{numbered && <span>{index + 1}</span>}{onOpen ? <button type="button" onClick={() => onOpen(item)}>{item}</button> : <p>{item}</p>}</div>)}</div> : <div className="empty compact-empty">{empty}</div>}</section>;
}

function priorityLabel(priority: string) { return priority === 'high' ? '높음' : priority === 'medium' ? '보통' : priority === 'low' ? '낮음' : priority; }
