'use client';

import { useEffect, useMemo, useState } from 'react';
import { dashboardApi } from '@/lib/client-api';
import { ResultsPanel as LegacyResultsPanel } from '@/app/results-panel';
import { StandardResultsView } from '@/app/standard-results-view';
import type { DashboardBundle } from '@/lib/results';
import { emptyProjectResultInventory, projectResultInventory } from '@/lib/project-results';
import type { RepositoryItem } from '@/lib/repository';
import {
  parseProjectManifest,
  pipelineStageValue,
  projectStatusLabel,
  projectStatusOptions,
  researchPipelineStages,
  type ResearchProject,
} from '@/lib/projects';
import { getProjectWorkspace, ProjectWorkspaceError, updateProjectMetadata, type ProjectWorkspace, type ProjectWorkspaceItem, type RecentProjectFile } from '@/lib/project-workspace-client';
import { loadCachedPlannerTasks, filterDeletedPlannerTasks, saveCachedPlannerTasks, type PlannerTask } from '@/lib/planner-tasks';
import { syncInboxPlannerTasks } from '@/lib/planner-tasks-client';

type ResearchResultsChoice = { key: string; label: string; path: string; type: 'standard' | 'dashboard' };

export function ResearchPanel({ projects: projectsInput, tree: treeInput, projectsLoading = false, projectsError = '', selectedProjectId, expandedFolders = new Set<string>(), onToggleProjectFolder, onProjectSelected, onProjectStatusChange, onOpen, onOpenFolder }: {
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
  const defaultId = projects.find((project) => project.id === 'thesis')?.id || projects.find((project) => project.status === 'active')?.id || projects[0]?.id || '';
  const selectedId = selectedProjectId && projects.some((project) => project.id === selectedProjectId) ? selectedProjectId : defaultId;
  const [statusSaving, setStatusSaving] = useState(false);
  const [stageSaving, setStageSaving] = useState(false);
  const [favoriteSaving, setFavoriteSaving] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState('');
  const [workspace, setWorkspace] = useState<ProjectWorkspace | null>(null);
  const [workspaceState, setWorkspaceState] = useState<'idle' | 'loading' | 'ready' | 'offline' | 'unknown' | 'outdated' | 'auth' | 'error'>('idle');
  const [workspaceMessage, setWorkspaceMessage] = useState('');
  const [resultChoice, setResultChoice] = useState('');
  const [plannerTasks, setPlannerTasks] = useState<PlannerTask[]>([]);
  const [plannerTasksLoading, setPlannerTasksLoading] = useState(false);
  const [plannerTasksError, setPlannerTasksError] = useState('');
  const selectedBase = projects.find((project) => project.id === selectedId) || null;
  const localManifest = selectedBase && workspace && workspace.projectId === selectedBase.id && workspace.manifestText
    ? parseProjectManifest(workspace.manifestText, selectedBase.sourcePath)
    : null;
  const selected = selectedBase && localManifest ? { ...selectedBase, ...localManifest, sourceSha: selectedBase.sourceSha } : selectedBase;
  const fallbackFiles = useMemo(() => selected ? tree.filter((item) => item.type === 'blob' && item.path.startsWith(`projects/${selected.id}/`)) : [], [selected, tree]);
  const hasWorkspace = Boolean(selected && workspace && workspace.projectId === selected.id);
  const files = useMemo<RepositoryItem[]>(() => {
    const source = selected && workspace && workspace.projectId === selected.id ? workspace.items : workspaceState === 'offline' ? fallbackFiles : [];
    return source.map((item) => ({ path: item.path, type: 'blob', ...(item.size !== undefined ? { size: item.size } : {}) }));
  }, [fallbackFiles, hasWorkspace, workspace, workspaceState]);
  const recentFiles = selected && workspace && workspace.projectId === selected.id ? workspace.recentFiles : [];
  const inventory = useMemo(() => selected ? projectResultInventory(selected, files) : emptyProjectResultInventory(), [files, selected]);
  const choices = useMemo(() => resultChoices(inventory), [inventory]);
  const chosen = choices.find((choice) => choice.key === resultChoice) || null;

  useEffect(() => {
    setResultChoice('');
    setWorkspace(null);
    setWorkspaceMessage('');
    setWorkspaceState(selected ? 'loading' : 'idle');
    if (!selected) return;
    let active = true;
    void getProjectWorkspace(selected.id).then((next) => {
      if (active) {
        setWorkspace(next);
        setWorkspaceState('ready');
      }
    }).catch((error) => {
      if (active) {
        setWorkspaceMessage(error instanceof Error ? error.message : 'Local Bridge 작업 폴더를 읽지 못했어.');
        setWorkspaceState(error instanceof ProjectWorkspaceError ? error.state : 'error');
      }
    });
    return () => { active = false; };
  }, [selectedBase?.id]);

  useEffect(() => {
    if (!selectedBase) {
      setPlannerTasks([]);
      return;
    }
    let active = true;
    setPlannerTasks(loadCachedPlannerTasks().filter((task) => task.projectId === selectedBase.id));
    setPlannerTasksLoading(true);
    setPlannerTasksError('');
    void syncInboxPlannerTasks().then((store) => {
      if (!active) return;
      const tasks = filterDeletedPlannerTasks(store.tasks, store.deletedTaskIds);
      saveCachedPlannerTasks(tasks);
      setPlannerTasks(tasks.filter((task) => task.projectId === selectedBase.id));
      setPlannerTasksLoading(false);
    }).catch((error) => {
      if (!active) return;
      setPlannerTasksError(error instanceof Error ? error.message : 'Planner 작업을 읽지 못했어.');
      setPlannerTasksLoading(false);
    });
    return () => { active = false; };
  }, [selectedBase?.id]);

  if (!projects.length) {
    if (projectsLoading) return <div className="card empty project-empty" role="status">연구 프로젝트를 불러오는 중…</div>;
    if (projectsError) return <div className="card error project-empty" role="alert">연구 프로젝트를 불러오지 못했어. {projectsError}</div>;
    return <div className="card empty project-empty"><code>projects/*/project.md</code>가 생기면 프로젝트별 연구 화면이 자동으로 구성돼.</div>;
  }

  function selectProject(id: string) {
    onProjectSelected?.(id);
    setStatusMessage('');
  }

  function acceptManifestUpdate(manifestText: string, manifestSha: string) {
    if (!selected) return;
    setWorkspace((current) => current?.projectId === selected.id ? { ...current, manifestText, manifestSha } : current);
    const updated = parseProjectManifest(manifestText, selected.sourcePath);
    onProjectStatusChange?.({ ...selected, ...updated, sourceSha: selected.sourceSha });
  }

  async function updateStatus(status: string) {
    if (!selected || status === selected.status || statusSaving) return;
    setStatusSaving(true);
    setStatusMessage('저장 중…');
    try {
      if (!workspace?.manifestSha) throw new Error('Local Bridge에서 프로젝트 파일을 읽은 뒤 상태를 저장할 수 있어.');
      const result = await updateProjectMetadata(selected.id, 'status', status, workspace.manifestSha);
      acceptManifestUpdate(result.manifestText, result.manifestSha);
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
      if (!workspace?.manifestSha) throw new Error('Local Bridge에서 프로젝트 파일을 읽은 뒤 단계를 저장할 수 있어.');
      const result = await updateProjectMetadata(selected.id, 'stage', stage, workspace.manifestSha);
      acceptManifestUpdate(result.manifestText, result.manifestSha);
      setStatusMessage('연구 단계를 저장했어.');
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : '연구 단계 저장에 실패했어.');
    } finally {
      setStageSaving(false);
    }
  }

  const workingFolders = hasWorkspace && workspace ? workspace.folders : workspaceState === 'offline' ? inferFolders(files.map((file) => file.path)) : [];
  const keyFilePaths = selected ? selected.keyFiles.map((path) => path.startsWith('projects/') ? path : `projects/${selected.id}/${path}`) : [];
  const keyFiles = files.filter((file) => keyFilePaths.includes(file.path));

  async function toggleFavorite(path: string) {
    if (!selected || !workspace?.manifestSha || favoriteSaving) return;
    const isFavorite = keyFilePaths.includes(path);
    setFavoriteSaving(path);
    setStatusMessage(isFavorite ? '주요 파일에서 제거 중…' : '주요 파일에 추가 중…');
    try {
      const result = await updateProjectMetadata(selected.id, isFavorite ? 'favorite_remove' : 'favorite_add', path, workspace.manifestSha);
      acceptManifestUpdate(result.manifestText, result.manifestSha);
      setStatusMessage(isFavorite ? '주요 파일에서 제거했어.' : '주요 파일에 추가했어.');
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : '주요 파일 저장에 실패했어.');
    } finally {
      setFavoriteSaving(null);
    }
  }
  return <div className="project-workspace">
    <aside className="card project-list" aria-label="연구 프로젝트">
      <div className="project-list-head"><b>프로젝트</b><span>{projects.length}개</span></div>
      {projects.map((project) => <button key={project.id} className={selected?.id === project.id ? 'active' : ''} onClick={() => selectProject(project.id)}>
        <div><b>{project.title}</b><small>{projectStatusLabel(project.status)}</small></div>
        <span className={`project-status ${project.status}`}>{projectStatusLabel(project.status)}</span>
      </button>)}
    </aside>

    {selected && <div className="project-detail">
      <section className="card project-hero">
        <div className="project-hero-top">
          <div><span className="project-eyebrow">{projectStatusLabel(selected.status)} · 우선순위 {priorityLabel(selected.priority)}</span><h3>{selected.title}</h3><p>{selected.summary}</p></div>
          <div className="project-hero-actions">
            <label className="project-status-editor">상태<select value={selected.status} disabled={statusSaving || workspaceState !== 'ready' || !workspace?.manifestSha} onChange={(event) => void updateStatus(event.target.value)}>
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
        <div className="head"><h3>연구 파이프라인</h3><label className="project-stage-editor">현재 단계<select value={pipelineStageValue(selected.stage)} disabled={stageSaving || workspaceState !== 'ready' || !workspace?.manifestSha} onChange={(event) => void updateStage(event.target.value)}>
          {researchPipelineStages.map((stage) => <option key={stage.value} value={stage.value}>{stage.label}</option>)}
        </select></label></div>
        <div className="research-pipeline-compact" aria-label="6단계 연구 파이프라인">
          {researchPipelineStages.map((stage, index) => <span className={`research-pipeline-step${pipelineStageValue(selected.stage) === stage.value ? ' active' : ''}`} key={stage.value}>
            {index > 0 && <i aria-hidden="true">→</i>}<b>{stage.label}</b>
          </span>)}
        </div>
      </section>

      <div className="research-recent-files">
        <div className="research-section-heading"><h3>최근 작업 파일</h3><span>Local Bridge 실제 수정 시각</span></div>
        {recentFiles.length ? <div className="research-recent-list">{latestRecentFiles(recentFiles).map((file) => <div className="research-recent-row" key={file.path}>
          <span className="research-file-type">{file.extension.toUpperCase().slice(1)}</span><div><b>{file.name}</b><small>{file.path} · {formatModifiedAt(file.modifiedAt)}</small></div><button className="mini" type="button" onClick={() => onOpen(file.path)}>열기</button>
        </div>)}</div> : <div className="empty compact-empty">{workspaceState === 'loading' ? '최근 문서 목록을 불러오는 중…' : workspaceState === 'offline' ? 'Local Bridge 사용 불가 · 저장소 파일 목록을 표시 중' : workspaceMessage || '최근 수정한 발표자료나 문서가 없어.'}</div>}
      </div>

      <div className="grid2 section-gap">
        <ProjectSection title="연구 질문" items={selected.questions} empty="등록된 연구 질문이 없어." numbered={false} />
        <section className="card section"><div className="head"><h3>다음 작업</h3><span>{plannerTasks.length ? `${plannerTasks.length}개` : '없음'}</span></div>
          {plannerTasksError && <div className="muted" role="status">Planner 연결을 확인할 수 없어. {plannerTasksError}</div>}
          {plannerTasksLoading && !plannerTasks.length ? <div className="empty compact-empty">Planner 작업을 불러오는 중…</div>
            : plannerTasks.length ? <div className="project-task-list">{[...plannerTasks].sort((a, b) => Number(a.status === 'done') - Number(b.status === 'done') || Date.parse(b.createdAt) - Date.parse(a.createdAt)).map((task) => <div className={`project-task-row${task.status === 'done' ? ' done' : ''}`} key={task.id}>
              <span className="project-task-check" aria-label={task.status === 'done' ? '완료' : '미완료'}>{task.status === 'done' ? '✓' : '○'}</span>
              <div><b>{task.status === 'done' ? <s>{task.title}</s> : task.title}</b>{task.description && <small>{task.description}</small>}</div>
            </div>)}</div> : <div className="empty compact-empty">Inbox에서 이 프로젝트를 지정한 할 일이 없어.</div>}
        </section>
      </div>
      <section className="card section section-gap research-favorites">
        <div className="head"><h3>주요 파일</h3><span>즐겨찾기 {keyFiles.length}개</span></div>
        {keyFiles.length ? <ul>{keyFiles.map((file) => <li key={file.path}>
          <button type="button" className="research-favorite-open" title={file.path} onClick={() => onOpen(file.path)}>▧ {file.path.split('/').pop()}</button>
          <button className="mini" type="button" disabled={!workspace?.manifestSha || favoriteSaving === file.path} aria-label={`${file.path} 주요 파일에서 제거`} onClick={() => void toggleFavorite(file.path)}>제거</button>
        </li>)}</ul> : <div className="empty compact-empty">작업 폴더에서 ☆를 누르면 이 프로젝트의 주요 파일로 저장돼.</div>}
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
        <div className="head"><h3>작업 폴더</h3><button className="mini" type="button" onClick={() => onOpenFolder(`projects/${selected.id}`)}>프로젝트 폴더 열기</button></div>
        {workspaceState === 'offline' && <small className="muted">Local Bridge 사용 불가 · 저장소 파일 목록을 표시 중</small>}
        {workspaceMessage && workspaceState !== 'offline' && <small className="muted">{workspaceMessage}</small>}
        {workspaceState === 'loading' ? <div className="empty compact-empty">프로젝트 작업 폴더를 불러오는 중…</div> : <ProjectFolderTree root={`projects/${selected.id}`} files={files} folders={workingFolders} expandedFolders={expandedFolders} keyFilePaths={keyFilePaths} favoriteSaving={favoriteSaving} canSaveMetadata={Boolean(workspace?.manifestSha)} onToggleExpanded={onToggleProjectFolder} onToggleFavorite={toggleFavorite} onOpen={onOpen} onOpenFolder={onOpenFolder} />}
      </section>
    </div>}
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
    sourcePath: text(project.sourcePath, `projects/${project.id}/project.md`),
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

function latestRecentFiles(files: RecentProjectFile[]) {
  const allowed = new Set(['.ppt', '.pptx', '.md', '.doc', '.docx']);
  return files
    .filter((file) => allowed.has(file.extension.toLowerCase()))
    .sort((a, b) => Date.parse(b.modifiedAt || '') - Date.parse(a.modifiedAt || ''))
    .slice(0, 5);
}

function formatModifiedAt(value?: string) {
  if (!value || Number.isNaN(Date.parse(value))) return '수정 시각 없음';
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

function ProjectSection({ title, items, empty, numbered, onOpen }: { title: string; items: string[]; empty: string; numbered: boolean; onOpen?: (path: string) => void }) {
  return <section className="card section"><div className="head"><h3>{title}</h3><span>{items.length ? `${items.length}개` : '없음'}</span></div>{items.length ? <div className="project-text-list">{items.map((item, index) => <div key={`${item}-${index}`} className="project-text-row">{numbered && <span>{index + 1}</span>}{onOpen ? <button type="button" onClick={() => onOpen(item)}>{item}</button> : <p>{item}</p>}</div>)}</div> : <div className="empty compact-empty">{empty}</div>}</section>;
}

function priorityLabel(priority: string) { return priority === 'high' ? '높음' : priority === 'medium' ? '보통' : priority === 'low' ? '낮음' : priority; }
