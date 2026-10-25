import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { parseProjectManifest } from '@/lib/projects';
import { parseResearchStatus } from '@/lib/research-status';
import { ResearchOverview } from './research-overview';
import { ResearchPanel } from './research-panel';

const sourcePath = '02_Projects/test/project.md';
const project = parseProjectManifest('', sourcePath);

describe('ResearchOverview source isolation', () => {
  it('never substitutes project focus for an absent interpretation', () => {
    const html = renderToStaticMarkup(<ResearchOverview project={project} onOpen={() => {}} />);
    expect(html).toContain('현재 판단을 확인하지 못했습니다');
    expect(html.indexOf('연구 질문')).toBeLessThan(html.indexOf('현재 판단'));
    expect(html.indexOf('현재 판단')).toBeLessThan(html.indexOf('근거와 출처'));
    expect(html.indexOf('근거와 출처')).toBeLessThan(html.indexOf('다음 행동'));
  });
  it('uses an interpretation only when its source matches the selected project', () => {
    const status = parseResearchStatus('## 최근 결과와 현재 해석\n원문에 기록된 판단', sourcePath);
    const matching = renderToStaticMarkup(<ResearchOverview project={project} status={status} onOpen={() => {}} />);
    const other = renderToStaticMarkup(<ResearchOverview project={project} status={{ ...status, sourcePath: '02_Projects/other/project.md' }} onOpen={() => {}} />);
    expect(matching).toContain('원문에 기록된 판단');
    expect(other).not.toContain('원문에 기록된 판단');
  });
  it('explains and links a status document that belongs to another source instead of using it', () => {
    const status = parseResearchStatus('## 최근 결과와 현재 해석\n다른 문서의 판단', 'wiki/current_status.md');
    const html = renderToStaticMarkup(<ResearchOverview project={project} status={status} onOpen={() => {}} />);
    expect(html).not.toContain('다른 문서의 판단');
    expect(html).toContain('연결 정보가 없어 표시하지 않았습니다');
    expect(html).toContain('현재 상태 문서 열기');
  });
  it('escapes source HTML and exposes Markdown as readable text', () => {
    const marked = parseProjectManifest('## 연구 질문\n- **표시** <script>alert(1)</script>', sourcePath);
    const html = renderToStaticMarkup(<ResearchOverview project={marked} onOpen={() => {}} />);
    expect(html).not.toContain('**표시**');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
  });
  it('keeps every overview jump connected to a target in the research screen', () => {
    const html = renderToStaticMarkup(<ResearchPanel projects={[project]} tree={[]} onOpen={() => {}} onOpenFolder={() => {}} />);
    for (const id of ['research-tasks', 'research-evidence', 'research-results']) {
      expect(html).toContain(`href="#${id}"`);
      expect(html).toContain(`id="${id}"`);
    }
    expect(html).toContain('프로젝트 설정 · 진행 단계 관리');
  });
  it('keeps long source action lists available behind a native disclosure', () => {
    const source = parseProjectManifest('## 다음 작업\n- a\n- b\n- c\n- d', sourcePath);
    const html = renderToStaticMarkup(<ResearchOverview project={source} onOpen={() => {}} />);
    expect(html).toContain('나머지 항목 1개');
    expect(html).toContain('<li>d</li>');
  });
});
