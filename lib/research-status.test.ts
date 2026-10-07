import '../app/inbox-workflow-test-safety';
import { describe, expect, it } from 'vitest';
import { parseResearchStatus } from './research-status';

describe('parseResearchStatus', () => {
  it('extracts the canonical Chocomint research workflow from project.md', () => {
    const markdown = `---
id: project-thesis
type: project
status: 진행중
stage: 분석
---

# Thesis

## 연구 질문

1. 한국의 필요노동은 어떻게 변했는가?
2. 무엇이 변화를 구성하는가?

## 현재 해석 기준

- 필요노동은 후생지표가 아니라 노동력 재생산조건의 노동시간 지표로 해석한다.

## 막힌 부분

- 민간소비 대리 가정을 정리한다.
- 민감도 검증이 필요하다.

## 다음 작업

- [06 결과](코드/결과/주요결과/06_decomposition.xlsx)의 부문 기여를 정리한다.
- 발표자료의 반영 범위를 판단한다.

[D003](decisions/D003_constant_price_main.md)
`;

    const status = parseResearchStatus(markdown);
    expect(status.sourcePath).toBe('02_Projects/thesis/project.md');
    expect(status.researchQuestion).toContain('한국의 필요노동');
    expect(status.currentInterpretation).toContain('재생산조건');
    expect(status.unresolved).toHaveLength(2);
    expect(status.nextActions).toHaveLength(2);
    expect(status.currentStage).toBe('해석 · 집필 준비');
    expect(status.decisions[0].path).toBe('02_Projects/thesis/decisions/D003_constant_price_main.md');
    expect(status.importantFiles[0].path).toBe('02_Projects/thesis/코드/결과/주요결과/06_decomposition.xlsx');
  });
});
