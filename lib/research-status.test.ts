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

1. [06 결과](../Calc/data/results/06_decomposition.xlsx)의 부문 기여를 정리한다.
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
    expect(status.importantFiles[0].path).toBe('Calc/data/results/06_decomposition.xlsx');
  });
});
