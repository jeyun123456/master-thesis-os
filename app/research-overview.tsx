import type { ResearchProject } from '@/lib/projects';
import type { ResearchStatus } from '@/lib/research-status';
import { researchText } from '@/lib/research-text';
import styles from './research-overview.module.css';

export function ResearchOverview({ project, status, onOpen }: {
  project: ResearchProject;
  status?: ResearchStatus | null;
  onOpen: (path: string) => void;
}) {
  const current = status?.sourcePath === project.sourcePath ? status : null;
  // A status document that belongs to another source is never shown as this project's judgment.
  const unlinkedStatusPath = status && !current ? status.sourcePath : '';
  const questions = project.questions.length ? project.questions : current?.researchQuestion ? [current.researchQuestion] : [];
  const nextActions = project.nextTasks.length ? project.nextTasks : current?.nextActions || [];
  const evidence = [...(current?.decisions || []), ...(current?.importantFiles || [])];

  return <section className={styles.overview} aria-labelledby="research-overview-title">
    <header className={styles.header}>
      <h3 id="research-overview-title">{researchText(project.title)}</h3>
      <button className="mini" type="button" onClick={() => onOpen(project.sourcePath)}>원문 project.md 열기</button>
    </header>
    <section className={styles.question} aria-labelledby="research-question-title">
      <h4 id="research-question-title">연구 질문</h4>
      {questions.length ? <ul>{questions.map((question, index) => <li key={index}>{researchText(question)}</li>)}</ul>
        : <p className={styles.empty}>등록된 연구 질문이 없습니다. 프로젝트 원문에서 확인해주세요.</p>}
      {project.currentFocus && <details className={styles.purpose} open={!current?.currentInterpretation}><summary>현재 집중 · 연구 목적</summary><p>{researchText(project.currentFocus)}</p></details>}
    </section>
    <div className={styles.columns}>
      <section aria-labelledby="research-interpretation-title">
        <h4 id="research-interpretation-title">현재 판단</h4>
        {current?.currentInterpretation ? <p>{researchText(current.currentInterpretation)}</p>
          : <p className={styles.empty}>이 프로젝트의 현재 판단을 확인하지 못했습니다. 원문에서 확인해주세요.{unlinkedStatusPath && <> 현재 상태 문서({unlinkedStatusPath})는 이 프로젝트 원문과 연결 정보가 없어 표시하지 않았습니다.</>}</p>}
        {unlinkedStatusPath && <button className="mini" type="button" onClick={() => onOpen(unlinkedStatusPath)}>현재 상태 문서 열기</button>}
        <span className={styles.source}>출처: {current?.sourcePath || project.sourcePath}</span>
      </section>
      <section aria-labelledby="research-evidence-title">
        <h4 id="research-evidence-title">근거와 출처</h4>
        {evidence.length ? <><ul className={styles.links}>{evidence.map((item, index) => <li key={`${item.path}-${index}`}><button type="button" onClick={() => onOpen(item.path)}>{researchText(item.label)}</button></li>)}</ul><p className={styles.source}>원문에 연결된 문서입니다. 채택 여부와 검증 범위는 각 문서에서 확인해주세요.</p></>
          : <p className={styles.empty}>근거 목록이 연결되지 않았습니다. 아래 주요 파일과 프로젝트 원문을 확인해주세요.</p>}
        <a href="#research-evidence">주요 파일 · 원본으로 이동</a>
        <a href="#research-results">관련 분석 결과로 이동</a>
      </section>
    </div>
    <section className={styles.next} aria-labelledby="research-next-title">
      <h4 id="research-next-title">다음 행동</h4>
      {nextActions.length ? <><ul>{nextActions.slice(0, 3).map((action, index) => <li key={index}>{researchText(action)}</li>)}</ul>
        {nextActions.length > 3 && <details className={styles.more}><summary>원문 순서의 나머지 항목 {nextActions.length - 3}개</summary><ul>{nextActions.slice(3).map((action, index) => <li key={index}>{researchText(action)}</li>)}</ul></details>}</>
        : <p className={styles.empty}>원문에 등록된 다음 행동이 없습니다. 아래 프로젝트 할 일에서 확인하거나 추가해주세요.</p>}
      <a href="#research-tasks">프로젝트 할 일로 이동</a>
    </section>
  </section>;
}
