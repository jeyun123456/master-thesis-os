import { describe, expect, it } from 'vitest';
import { groupFilesByParentFolder, parseProjectManifest, projectManifestPaths, projectRelatedFiles, projectStatusLabel, stageLabel } from './projects';
import type { RepositoryItem } from './repository';

const manifest = `---
id: thesis
title: 석사논문 본체
status: active
priority: high
stage: interpretation
updated: 2026-09-09
---

# 석사논문 본체

한국의 필요노동 변화를 분석한다.

## 현재 집중

2015→2020 결과 해석

## 연구 질문
- 필요노동은 어떻게 변했는가?
- 무엇이 변화를 구성하는가?

## 다음 작업
1. 산업별 기여 정리
2. 시대적 배경 대조

## 막힌 부분
- 설명 근거 보강

## 관련 경로
- wiki/current_status.md
- Calc/data/results/
`;

describe('project manifests', () => {
  it('parses metadata and project sections', () => {
    const project = parseProjectManifest(manifest, 'projects/thesis/project.md');
    expect(project.id).toBe('thesis');
    expect(project.title).toBe('석사논문 본체');
    expect(project.status).toBe('active');
    expect(project.stage).toBe('interpretation');
    expect(project.summary).toBe('한국의 필요노동 변화를 분석한다.');
    expect(project.currentFocus).toBe('2015→2020 결과 해석');
    expect(project.questions).toEqual(['필요노동은 어떻게 변했는가?', '무엇이 변화를 구성하는가?']);
    expect(project.nextTasks).toEqual(['산업별 기여 정리', '시대적 배경 대조']);
    expect(project.blocked).toEqual(['설명 근거 보강']);
    expect(project.relatedPaths).toEqual(['wiki/current_status.md', 'Calc/data/results/']);
  });

  it('discovers only project manifests', () => {
    const tree = [
      { path: 'projects/thesis/project.md', type: 'blob' },
      { path: 'projects/README.md', type: 'blob' },
      { path: 'projects/foo/notes.md', type: 'blob' },
      { path: 'projects/bar/project.md', type: 'blob' },
    ] as RepositoryItem[];
    expect(projectManifestPaths(tree)).toEqual(['projects/bar/project.md', 'projects/thesis/project.md']);
  });

  it('matches exact and directory related paths', () => {
    const project = parseProjectManifest(manifest, 'projects/thesis/project.md');
    const tree = [
      { path: 'wiki/current_status.md', type: 'blob' },
      { path: 'Calc/data/results/05.xlsx', type: 'blob' },
      { path: 'Calc/data/input.xlsx', type: 'blob' },
    ] as RepositoryItem[];
    expect(projectRelatedFiles(project, tree).map((item) => item.path)).toEqual([
      'Calc/data/results/05.xlsx',
      'wiki/current_status.md',
    ]);
  });

  it('provides Korean stage and status labels', () => {
    expect(stageLabel('interpretation')).toBe('해석');
    expect(projectStatusLabel('active')).toBe('진행 중');
    expect(projectStatusLabel('writing')).toBe('작성중');
    expect(projectStatusLabel('paused')).toBe('보류');
  });

  it('groups related files by their actual parent directory in stable order', () => {
    const groups = groupFilesByParentFolder([
      { path: 'wiki/z.md', type: 'blob' },
      { path: 'wiki/a.md', type: 'blob' },
      { path: 'README.md', type: 'blob' },
      { path: 'Calc/data/result.xlsx', type: 'blob' },
    ]);
    expect(groups.map((group) => group.path)).toEqual(['', 'Calc/data', 'wiki']);
    expect(groups[0].label).toBe('Vault root');
    expect(groups[2].files.map((item) => item.path)).toEqual(['wiki/a.md', 'wiki/z.md']);
  });

  it('returns no groups for an empty or tree-only selection', () => {
    expect(groupFilesByParentFolder([])).toEqual([]);
    expect(groupFilesByParentFolder([{ path: 'wiki', type: 'tree' }])).toEqual([]);
  });
});
