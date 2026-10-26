import './network-test-safety';
import { describe, expect, it } from 'vitest';
import { parseResearchStatus } from './research-status';

describe('parseResearchStatus', () => {
  it('extracts the live research workflow from current_status.md', () => {
    const markdown = `# 현재 연구 상태

최종 감사: 2026-09-04. 범위: 한국, 2010·2015·2020 벤치마크, K=77.

## 연구 주제와 문제의식

한국의 필요노동은 어떻게 변했는가? [정의](concepts/necessary_labour.md).

## 최근 결과와 현재 해석

필요노동은 2010→2015 증가하고 2015→2020 소폭 감소했다.

## 미해결 문제

1. 민간소비 대리 가정을 정리한다.
2. 민감도 검증이 필요하다.

## 바로 다음 작업

1. [06 결과](../projects/thesis/코드/결과/주요결과/06_decomposition.xlsx)의 부문 기여를 정리한다.
2. 발표자료의 반영 범위를 판단한다.

[D003](decisions/D003_constant_price_main.md)
`;

    const status = parseResearchStatus(markdown);
    expect(status.auditedAt).toBe('2026-09-04');
    expect(status.scope).toContain('K=77');
    expect(status.researchQuestion).toContain('한국의 필요노동');
    expect(status.currentInterpretation).toContain('소폭 감소');
    expect(status.unresolved).toHaveLength(2);
    expect(status.nextActions).toHaveLength(2);
    expect(status.currentStage).toBe('해석 · 집필 준비');
    expect(status.decisions[0].path).toBe('wiki/decisions/D003_constant_price_main.md');
    expect(status.importantFiles[0].path).toBe('projects/thesis/코드/결과/주요결과/06_decomposition.xlsx');
  });

  it('reads the real Chocomint-Lab project.md without inventing missing fields', () => {
    const path = '02_Projects/Master_필요노동과_노동력재생산/project.md';
    const markdown = `---
type: project
stage: 분석
updated: 2026-10-19
---
# 제목

## 연구 질문

1. 필요노동은 어느 수준인가? <!-- RQ-ID: RQ-01 -->
2. 두 번째 질문 <!-- RQ-ID: RQ-02 -->

## 현재 해석 기준

- 증감을 후생으로 해석하지 않는다.
자세한 기준은 [D007](decisions/D007_x.md)를 따른다.

## 다음 작업

### 현재 범위
- **본문:** 서술형 항목

## 막힌 부분

- 간극 설명이 필요하다.
`;
    const status = parseResearchStatus(markdown, path);
    expect(status.currentStage).toBe('분석');
    expect(status.auditedAt).toBe('2026-10-19');
    expect(status.researchQuestion).toBe('필요노동은 어느 수준인가?');
    expect(status.currentInterpretation).toBe('증감을 후생으로 해석하지 않는다.');
    expect(status.unresolved).toEqual(['간극 설명이 필요하다.']);
    expect(status.nextActions).toEqual([]);
    expect(status.decisions[0].path).toBe('02_Projects/Master_필요노동과_노동력재생산/decisions/D007_x.md');
  });
});
