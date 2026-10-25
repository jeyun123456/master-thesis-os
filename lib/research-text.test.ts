import { describe, expect, it } from 'vitest';
import { researchText } from './research-text';

describe('researchText', () => {
  it('displays emphasis, code and source labels without Markdown markers', () => {
    expect(researchText('**현재 사양** · __기준__ · `코드/v3/` · [원문](methodology/計算方法.md)')).toBe('현재 사양 · 기준 · 코드/v3/ · 원문');
    expect(researchText('[[decisions/D014|채택 결정]] <!-- RQ-ID: RQ-01 -->')).toBe('채택 결정');
  });
  it('preserves content, paths, mathematics and incomplete markup', () => {
    expect(researchText('2010·2015·2020 / t* / x_y / **미완성')).toBe('2010·2015·2020 / t* / x_y / **미완성');
    expect(researchText('[[02_Projects/project.md]]')).toBe('02_Projects/project.md');
  });
});
