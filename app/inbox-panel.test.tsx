import './inbox-workflow-test-safety';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import * as ts from 'typescript';
import * as inbox from '../lib/inbox';
import { createInboxEntry } from '../lib/inbox';
import type { InboxPanel as InboxPanelType } from './inbox-panel';

const require = createRequire(import.meta.url);

function loadInboxPanel() {
  const panelPath = fileURLToPath(new URL('./inbox-panel.tsx', import.meta.url));
  const source = readFileSync(panelPath, 'utf8');
  const compiled = ts.transpileModule(source, {
    fileName: panelPath,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const module = { exports: {} as Record<string, unknown> };
  const panelRequire = (id: string) => {
    if (id === '@/lib/inbox') return inbox;
    return require(id);
  };
  new Function('require', 'module', 'exports', compiled)(panelRequire, module, module.exports);
  return module.exports.InboxPanel as typeof InboxPanelType;
}

describe('InboxPanel static render', () => {
  it('renders the Inbox list and reviewed todo content with the real panel source', () => {
    const entry = createInboxEntry('panel smoke raw', new Date('2026-10-01T08:00:00.000Z'), 'panel-1');
    entry.processed = true;
    entry.ai = {
      entryId: entry.id,
      category: 'todo',
      title: 'Panel smoke title',
      summary: 'Panel smoke summary',
      nextAction: 'Panel smoke action',
      dueDate: null,
      relatedEntryIds: [],
      processedAt: '2026-10-01T08:01:00.000Z',
    };
    const props = {
      entries: [entry],
      loaded: true,
      busy: false,
      storageStatus: 'saved',
      storageError: '',
      bridgeApiWarning: '',
      bridgeTokenWarning: '',
      onAdd: () => true,
      onOrganize: () => undefined,
      onRetrySave: () => undefined,
      preview: null,
      error: '',
      routeMessage: '',
      projects: [],
      projectTaskSavingId: null,
      deleteSavingId: null,
      onAddToProject: () => undefined,
      onDelete: async () => true,
      onApply: () => undefined,
      onDiscardPreview: () => undefined,
    } satisfies Parameters<typeof InboxPanelType>[0];

    const markup = renderToStaticMarkup(React.createElement(loadInboxPanel(), props));
    expect(markup).toContain('class="inbox-page"');
    expect(markup).toContain('panel smoke raw');
    expect(markup).toContain('Panel smoke title');
    expect(markup).toContain('Panel smoke action');
  });
});
