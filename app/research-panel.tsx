'use client';

import { useMemo, useState } from 'react';
import type { RepositoryItem } from '@/lib/repository';
import { groupFilesByParentFolder, projectRelatedFiles, projectStatusLabel, stageLabel, type ResearchProject } from '@/lib/projects';

const thesisPipeline = ['자료', '부문통합', '노동시간', '소비바스켓', '필요노동', '분해', '해석', '집필'];
const stageToPipeline: Record<string, string> = {
  data: '자료', mapping: '부문통합', labour: '노동시간', calculation: '필요노동', validation: '분해', interpretation: '해석', writing: '집필',
};

export function ResearchPanel({ projects, tree, onOpen, onOpenFolder }: {
  projects: ResearchProject[];
  tree: RepositoryItem[];
  onOpen: (path: string) => void;
  onOpenFolder: (path: string) => void;
}) {
  const defaultId = projects.find((project) => project.id === 'thesis')?.id || projects.find((project) => project.status === 'active')?.id || projects[0]?.id || '';
  const [selectedId, setSelectedId] = useState(defaultId);
  const selected = projects.find((project) => project.id === selectedId) || projects[0] || null;
  const files = useMemo(() => selected ? projectRelatedFiles(selected, tree, 18) : [], [selected, tree]);
  const fileGroups = useMemo(() => groupFilesByParentFolder(files), [files]);

  if (!projects.length) {
    return <div className="card empty project-empty">`projects/*/project.md`가 생기면 프로젝트별 연구 화면이 자동으로 구성돼.</div>;
  }

  return <div className="project-workspace">
    <aside className="card project-list" aria-label="연구 프로젝트">
      <div className="project-list-head"><b>프로젝트</b><span>{projects.length}개</span></div>
      {projects.map((project) => <button key={project.id} className={selected?.id === project.id ? 'active' : ''} onClick={() => setSelectedId(project.id)}>
        <div><b>{project.title}</b><small>{stageLabel(project.stage)} · {project.updated || '갱신일 없음'}</small></div>
        <span className={`project-status ${project.status}`}>{projectStatusLabel(project.status)}</span>
      </button>)}
    </aside>

    {selected && <div className="project-detail">
      <section className="card project-hero">
        <div className="project-hero-top"><div><span className="project-eyebrow">{projectStatusLabel(selected.status)} · 우선순위 {priorityLabel(selected.priority)}</span><h3>{selected.title}</h3><p>{selected.summary}</p></div><button className="mini" onClick={() => onOpen(selected.sourcePath)}>project.md 열기</button></div>
        <div className="project-focus"><span>현재 집중</span><b>{selected.currentFocus || '현재 집중 작업이 아직 등록되지 않았어.'}</b></div>
      </section>

      {selected.id === 'thesis' && <section className="card section project-pipeline-section">
        <div className="head"><h3>연구 파이프라인</h3><span>현재 · {stageLabel(selected.stage)}</span></div>
        <div className="pipeline">{thesisPipeline.map((stage, index) => {
          const active = stageToPipeline[selected.stage] === stage;
          return <span className="pipeline-wrap" key={stage}><div className={`stage ${active ? 'active' : ''}`}><b>{stage}</b><small>{active ? '현재' : '연구 흐름'}</small></div>{index < thesisPipeline.length - 1 && <span className="arrow">→</span>}</span>;
        })}</div>
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

function ProjectSection({ title, items, empty, numbered }: { title: string; items: string[]; empty: string; numbered: boolean }) {
  return <section className="card section"><div className="head"><h3>{title}</h3><span>{items.length ? `${items.length}개` : '없음'}</span></div>{items.length ? <div className="project-text-list">{items.map((item, index) => <div key={`${item}-${index}`} className="project-text-row">{numbered && <span>{index + 1}</span>}<p>{item}</p></div>)}</div> : <div className="empty compact-empty">{empty}</div>}</section>;
}

function priorityLabel(priority: string) {
  return priority === 'high' ? '높음' : priority === 'medium' ? '보통' : priority === 'low' ? '낮음' : priority;
}

function basename(path: string) { return path.split('/').pop() || path; }
