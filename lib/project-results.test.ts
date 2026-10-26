import { describe, expect, it } from 'vitest';
import { parseProjectManifest } from './projects';
import { projectResultInventory } from './project-results';
import type { RepositoryItem } from './repository';

function project(markdown = '') {
  return parseProjectManifest(`---
id: thesis
title: Thesis
---

# Thesis

${markdown}`, '02_Projects/thesis/project.md');
}

describe('project result discovery', () => {
  it('discovers the standard project result bundle', () => {
    const tree = [
      { path: '02_Projects/thesis/results/result.json', type: 'blob' },
      { path: '02_Projects/thesis/results/view.json', type: 'blob' },
      { path: '02_Projects/thesis/results/sources/scalar.csv', type: 'blob' },
      { path: '02_Projects/thesis/results/sources/matrix.xlsx', type: 'blob' },
    ] as RepositoryItem[];

    const inventory = projectResultInventory(project(), tree);
    expect(inventory.roots).toEqual(['02_Projects/thesis/results/']);
    expect(inventory.totalFiles).toBe(4);
    expect(inventory.standardPath).toBe('02_Projects/thesis/results');
    expect(inventory.dashboardPath).toBeNull();
  });

  it('discovers the project result convention and a valid dashboard', () => {
    const tree = [
      { path: '02_Projects/thesis/코드/결과/05.xlsx', type: 'blob' },
      { path: '02_Projects/thesis/코드/결과/dashboard/necessary_labour.json', type: 'blob' },
      { path: '02_Projects/thesis/코드/결과/dashboard/decomposition.json', type: 'blob' },
      { path: '02_Projects/thesis/코드/결과/dashboard/validation.json', type: 'blob' },
      { path: '02_Projects/thesis/코드/input.xlsx', type: 'blob' },
    ] as RepositoryItem[];

    const inventory = projectResultInventory(project(), tree);
    expect(inventory.roots).toEqual(['02_Projects/thesis/코드/결과/']);
    expect(inventory.totalFiles).toBe(4);
    expect(inventory.standardPath).toBeNull();
    expect(inventory.dashboardPath).toBe('02_Projects/thesis/코드/결과/dashboard');
  });

  it('uses an explicit result path even when the folder is not populated yet', () => {
    const inventory = projectResultInventory(project('## 결과 경로\n- 02_Projects/thesis/exports/'), []);
    expect(inventory.roots).toEqual(['02_Projects/thesis/exports/']);
    expect(inventory.standardPath).toBeNull();
    expect(inventory.dashboardPath).toBeNull();
  });

  it('does not treat unrelated project files as results', () => {
    const tree = [
      { path: '02_Projects/thesis/코드/analysis.py', type: 'blob' },
      { path: '02_Projects/thesis/원고/초고.md', type: 'blob' },
    ] as RepositoryItem[];
    expect(projectResultInventory(project(), tree).totalFiles).toBe(0);
  });
});