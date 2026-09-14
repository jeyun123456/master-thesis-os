'use client';

import { useEffect, useMemo, useState } from 'react';
import { dashboardApi } from '@/lib/client-api';
import type { RepositoryItem } from '@/lib/repository';
import { groupFilesByParentFolder, projectRelatedFiles, projectStatusLabel, projectStatusOptions, stageLabel, type ResearchProject } from '@/lib/projects';

const thesisPipeline = ['자료', '부문통합', '노동시간', '소비바스켓', '필요노동', '분해', '해석', '집필'];
const stageToPipeline: Record<string, string> = {
  data: '자료', mapping: '부문통합', labour: '노동시간', calculation: '필요노동', validation: '분해', interpretation: '해석', writing: '집필',
};

export function ResearchPanel({ projects, tree, selectedProjectId, onProjectSelected, onProjectStatusChange, onOpen, onOpenFolder }: {
  projects: ResearchProject[];
  tree: RepositoryItem[];
  selectedProjectId?: string;
  onProjectSelected?: (id: string) => void;
  onProjectStatusChange?: (project: ResearchProject) => void;
  onOpen: (path: string) => void;
  onOpenFolder: (path: string) => void;
}) {
  const defaultId = projects.find((project) => project.id === 'thesis')?.id || projects.find((project) => project.status === 'active')?.id || projects[0]?.id || '';
  const initialId = selectedProjectId && projects.some((project) => project.id === selectedProjectId) ? selectedProjectId : defaultId;
  const [selectedId, setSelectedId] = useState(initialId);
  const [statusSaving, setStatusSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const selected = projects.find((project) => project.id === selectedId) || projects[0] || null;
  const files = useMemo(() => selected ? projectRelatedFiles(selected, tree, 18) : [], [selected, tree]);
  const fileGroups = useMemo(() => groupFilesByParentFolder(files), [files]);

  useEffect(() => {
    if (selectedProjectId && projects.some((project) => project.id === selectedProjectId)) setSelectedId(selectedProjectId);
  }, [selectedProjectId, projects]);

  useEffect(() => {
    if (selectedId && projects.some((project) => project.id === selectedId)) return;
    setSelectedId(defaultId);
  }, [defaultId, projects, selectedId]);

  if (!projects.length) {
    return <div className="card empty project-empty">`projects/*/project.md`가 생기면 프로젝트별 연구 화면이 자동으로 구성돼.</div>;
  }

  function selectProject(id: string) {
    setSelectedId(id);
    onProjectSelected?.(id);
    setStatusMessage('');
  }

  async function updateStatus(status: string) {
    if (!selected || status === selected.status || statusSaving) return;
    setStatusSaving(true);
    setStatusMessage('저장 중…');
    try {
      const result = await dashboardApi.updateProjectStatus(selected.id, status, selected.sourceSha);
      onProjectStatusChange?.(result.project);
      setSelectedId(result.project.id);
      onProjectSelected?.(result.project.id);
      setStatusMessage('저장했어.');
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : '상태 저장에 실패했어.');
    } finally {
      setStatusSaving(false);
    }
  }

  return <div className="project-workspace">
    <aside className="card project-list" aria-label="연구 프로젝트">
      <div className="project-list-head"><b>프로젝트</b><span>{projects.length}개</span></div>
      {projects.map((project) => <button key={project.id} className={selected?.id === project.id ? 'active' : ''} onClick={() => selectProject(project.id)}>
        <div><b>{project.title}</b><small>{stageLabel(project.stage)} · {project.updated || '갱신일 없음'}</small></div>
        <span className={`project-status ${project.status}`}>{projectStatusLabel(project.status)}</span>
      </button>)}
    </aside>

    {selected && <div className="project-detail">
      <section className="card project-hero">
        <div className="project-hero-top">
          <div><span className="project-eyebrow">{projectStatusLabel(selected.status)} · 우선순위 {priorityLabel(selected.priority)}</span><h3>{selected.title}</h3><p>{selected.summary}</p></div>
          <div className="project-hero-actions">
            <label className="project-status-editor">상태<select value={selected.status} disabled={statusSaving} onChange={(event) => void updateStatus(event.target.value)}>
              {!projectStatusOptions.some((option) => option.value === selected.status) && <option value={selected.status}>{projectStatusLabel(selected.status)} · 기존 값</option>}
              {projectStatusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select></label>
            <button className="mini" onClick={() => onOpen(selected.sourcePath)}>project.md 열기</button>
          </div>
        </div>
        {statusMessage && <div className={statusMessage === '저장했어.' || statusMessage === '저장 중…' ? 'project-status-message' : 'error project-status-message'} role="status">{statusMessage}</div>}
        <div className="project-focus"><span>현재 집중</span><b>{selected.currentFocus || '현재 집중 작업이 아직 등록되지 않았어.'}</b></div>
      </section>

      {selected.id === 'thesis' && <section className="card section project-pipeline-section">
        <div className="head"><h3>연구 파이프라인</h3><span>현재 · {stageLabel(selected.stage)}</span></div>
        <div className="pipeline pipeline-reversed-d" aria-label="연구 파이프라인">
          <div className="pipeline-row pipeline-row-top">
            {thesisPipeline.slice(0, 4).map((stage, index) => <PipelineItem key={stage} stage={stage} active={stageToPipeline[selected.stage] === stage} arrow={index < 3 ? '→' : undefined} />)}
          </div>
          <div className="pipeline-turn" aria-hidden="true">↓</div>
          <div className="pipeline-row pipeline-row-bottom">
            {thesisPipeline.slice(4).reverse().map((stage, index) => <PipelineItem key={stage} stage={stage} active={stageToPipeline[selected.stage] === stage} arrow={index < 3 ? '←' : undefined} />)}
          </div>
        </div>
      </section>}

      <div className="grid2 section-gap">
        <ProjectSection title="연구 질문" items={selected.questions} empty="등록된 연구 질문이 없어." numbered={false} />
        <ProjectSection title="다음 작업" items={selected.nextTasks} empty="등록된 다음 작업이 없어." numbered />
      </div>

      <ProjectSection title="막힌 부분" items={selected.blocked} empty="현재 등록된 막힌 부분이 없어." numbered={false} />

      <section className="card section section-gap">
        <div className="head"><h3>관련 자료</h3><span>manifest의 관련 경로 · {files.length}개 표시</span></div>
        <div className="project-file-groups">
          {fileGroups.map((group) => <details className="project-file-group" key={group.path}>
            <summary><span><b>{group.label}</b><small>{group.path || '저장소 루트'} · {group.files.length}개</small></span></summary>
            <div className="project-file-group-actions"><button className="mini" onClick={() => onOpenFolder(group.path)}>폴더 열기</button></div>
            <div className="project-file-list">{group.files.map((file) => <div className="project-file-row" key={file.path}><div><b>{basename(file.path)}</b><small>{file.path}</small></div><button className="mini" onClick={() => onOpen(file.path)}>열기</button></div>)}</div>
          </details>)}
          {!fileGroups.length && <div className="empty compact-empty">연결된 파일이 아직 없어.</div>}
        </div>
      </section>
    </div>}
  </div>;
}

function PipelineItem({ stage, active, arrow }: { stage: string; active: boolean; arrow?: string }) {
  return <span className="pipeline-item"><div className={`stage ${active ? 'active' : ''}`} aria-current={active ? 'step' : undefined}><b>{stage}</b><small>{active ? '현재' : '연구 흐름'}</small></div>{arrow && <span className="arrow" aria-hidden="true">{arrow}</span>}</span>;
}

function ProjectSection({ title, items, empty, numbered }: { title: string; items: string[]; empty: string; numbered: boolean }) {
  return <section className="card section"><div className="head"><h3>{title}</h3><span>{items.length ? `${items.length}개` : '없음'}</span></div>{items.length ? <div className="project-text-list">{items.map((item, index) => <div key={`${item}-${index}`} className="project-text-row">{numbered && <span>{index + 1}</span>}<p>{item}</p></div>)}</div> : <div className="empty compact-empty">{empty}</div>}</section>;
}

function priorityLabel(priority: string) {
  return priority === 'high' ? '높음' : priority === 'medium' ? '보통' : priority === 'low' ? '낮음' : priority;
}

function basename(path: string) { return path.split('/').pop() || path; }
