import { describe, expect, it, vi } from 'vitest';
import {
  applyInboxSuggestions as applyInboxSuggestionsActual,
  createInboxEntry as createInboxEntryActual,
  loadInboxEntries,
  type InboxEntry,
  type InboxSuggestion,
} from '../lib/inbox';
import { InboxPersistenceError } from '../lib/inbox-persistence-client';
import type { ResearchProject } from '../lib/projects';
import { useInboxWorkflow } from './use-inbox-workflow';
import {
  assertNoDeniedAttempts,
  deniedNetworkAttempts,
  fakeStorage,
  failInboxStorageWritesForTest,
} from './inbox-workflow-test-safety';

const mockHooks = vi.hoisted(() => {
  class BridgeApiVersionMismatchError extends Error {}
  return { runtime: null as any, services: null as any, BridgeApiVersionMismatchError };
});

vi.mock('react', () => ({
  useState: (initial: unknown) => mockHooks.runtime.useState(initial),
  useRef: (initial: unknown) => mockHooks.runtime.useRef(initial),
  useEffect: (callback: () => void | (() => void), deps: unknown[]) => mockHooks.runtime.useEffect(callback, deps),
}));

vi.mock('../lib/inbox-persistence-client', async () => {
  const actual = await vi.importActual<typeof import('../lib/inbox-persistence-client')>('../lib/inbox-persistence-client');
  return {
    ...actual,
    loadPersistedInbox: () => mockHooks.services.loadPersistedInbox(),
    savePersistedInbox: (entries: InboxEntry[]) => mockHooks.services.savePersistedInbox(entries),
    deletePersistedInboxEntry: (entryId: string) => mockHooks.services.deletePersistedInboxEntry(entryId),
  };
});

vi.mock('../lib/inbox-ai-client', () => ({
  organizeInboxEntries: (entries: InboxEntry[], token: string) => mockHooks.services.organizeInboxEntries(entries, token),
}));

vi.mock('../lib/planner-tasks-client', () => ({
  addPlannerTask: (task: unknown) => mockHooks.services.addPlannerTask(task),
  syncInboxPlannerTasks: () => mockHooks.services.syncInboxPlannerTasks(),
  updatePlannerTaskProject: (taskId: string, projectId: string) => mockHooks.services.updatePlannerTaskProject(taskId, projectId),
}));

vi.mock('../lib/calendar-client', () => ({
  addCalendarEvent: (input: unknown) => mockHooks.services.addCalendarEvent(input),
}));

vi.mock('../lib/bridge-status', () => ({
  BridgeApiVersionMismatchError: mockHooks.BridgeApiVersionMismatchError,
  bridgeApiVersionMismatchMessage: (apiVersion?: number) => mockHooks.services.bridgeApiVersionMismatchMessage(apiVersion),
  checkLocalBridgeApiVersion: () => mockHooks.services.checkLocalBridgeApiVersion(),
}));

type EffectSlot = {
  deps: unknown[];
  callback: () => void | (() => void);
  cleanup?: () => void;
  pending: boolean;
};

type StateController = {
  state: Record<string, unknown>;
  setters: Record<string, (value: unknown) => void>;
  actions: Record<string, (...args: unknown[]) => unknown>;
};

type InboxDeps = {
  checkLocalBridgeApiVersion: () => Promise<{ state: string; apiVersion?: number }>;
  bridgeApiVersionMismatchMessage: (apiVersion?: number) => string;
  InboxPersistenceError: typeof InboxPersistenceError;
  BridgeApiVersionMismatchError: new (...args: never[]) => Error;
  loadPersistedInbox: () => Promise<InboxEntry[]>;
  savePersistedInbox: (entries: InboxEntry[]) => Promise<InboxEntry[]>;
  deletePersistedInboxEntry: (entryId: string) => Promise<InboxEntry[]>;
  organizeInboxEntries: (entries: InboxEntry[], token: string) => Promise<InboxSuggestion[]>;
  addPlannerTask: (task: unknown) => Promise<unknown>;
  syncInboxPlannerTasks: () => Promise<unknown>;
  updatePlannerTaskProject: (taskId: string, projectId: string) => Promise<unknown>;
  addCalendarEvent: (input: unknown) => Promise<unknown>;
  projects: Array<{ id: string; title: string }>;
  now: () => Date;
};

const stateNames = [
  'inboxEntries', 'inboxPreview', 'inboxLoaded', 'inboxStorageStatus', 'inboxStorageError',
  'bridgeApiWarning', 'bridgeTokenWarning', 'inboxLoadAttempt', 'inboxOrganizing', 'inboxAIError',
  'inboxRouteMessage', 'projectTaskSavingId', 'inboxDeleteSavingId',
];

function createInboxHarness(deps: InboxDeps) {
  const stateSlots: Array<{ value: unknown }> = [];
  const refSlots: Array<{ current: unknown }> = [];
  const effects: EffectSlot[] = [];
  let stateIndex = 0;
  let refIndex = 0;
  let effectIndex = 0;
  let page = 'home';
  let toast = '';

  const hooks = {
    useState<T>(initial: T | (() => T)): [T, (next: T | ((previous: T) => T)) => void] {
      const index = stateIndex++;
      if (!stateSlots[index]) stateSlots[index] = { value: typeof initial === 'function' ? (initial as () => T)() : initial };
      const slot = stateSlots[index];
      return [slot.value as T, (next) => {
        slot.value = typeof next === 'function' ? (next as (previous: T) => T)(slot.value as T) : next;
      }];
    },
    useRef<T>(initial: T) {
      const index = refIndex++;
      if (!refSlots[index]) refSlots[index] = { current: initial };
      return refSlots[index] as { current: T };
    },
    useEffect(callback: EffectSlot['callback'], deps: unknown[]) {
      const index = effectIndex++;
      const slot = effects[index];
      const changed = !slot || slot.deps.length !== deps.length || deps.some((value, i) => !Object.is(value, slot.deps[i]));
      if (!slot) effects[index] = { deps: [...deps], callback, pending: true };
      else if (changed) {
        slot.deps = [...deps];
        slot.callback = callback;
        slot.pending = true;
      }
    },
  };

  mockHooks.services = deps;
  const render = (): StateController => {
    stateIndex = 0;
    refIndex = 0;
    effectIndex = 0;
    mockHooks.runtime = hooks;
    let workflow: ReturnType<typeof useInboxWorkflow>;
    try {
      workflow = useInboxWorkflow({
        projects: deps.projects as unknown as ResearchProject[],
        onNotice: (message) => { toast = message; },
        onOpenInbox: () => { page = 'inbox'; },
      });
    } finally {
      mockHooks.runtime = null;
    }
    const state = Object.fromEntries(stateNames.map((name, index) => [name, stateSlots[index].value])) as Record<string, unknown>;
    state.page = page;
    state.toast = toast;
    const setters = Object.fromEntries(stateNames.map((name, index) => [name, (value: unknown) => {
      const slot = stateSlots[index];
      slot.value = typeof value === 'function' ? (value as (previous: unknown) => unknown)(slot.value) : value;
    }])) as Record<string, (value: unknown) => void>;
    return { state, setters, actions: workflow as unknown as StateController['actions'] };
  };

  const commit = () => {
    for (const slot of effects) {
      if (!slot.pending) continue;
      slot.cleanup?.();
      const cleanup = slot.callback();
      slot.cleanup = typeof cleanup === 'function' ? cleanup : undefined;
      slot.pending = false;
    }
  };
  const unmount = () => {
    for (const slot of effects) slot.cleanup?.();
    effects.length = 0;
  };

  return { render, commit, unmount, hookState: { stateSlots, refSlots, effects } };
}
type ServiceCalls = {
  healthChecks: number;
  loads: number;
  saves: InboxEntry[][];
  deletes: string[];
  organizes: Array<{ ids: string[]; token: string }>;
  events: string[];
};

function makeServices(overrides: Partial<InboxDeps> = {}) {
  const calls: ServiceCalls = {
    healthChecks: 0,
    loads: 0,
    saves: [],
    deletes: [],
    organizes: [],
    events: [],
  };
  const deps: InboxDeps = {
    checkLocalBridgeApiVersion: async () => {
      calls.healthChecks += 1;
      return { state: 'ok' };
    },
    bridgeApiVersionMismatchMessage: (apiVersion) => `Bridge version ${apiVersion} is outdated.`,
    InboxPersistenceError,
    BridgeApiVersionMismatchError: mockHooks.BridgeApiVersionMismatchError,
    loadPersistedInbox: async () => {
      calls.loads += 1;
      calls.events.push('load');
      return [];
    },
    savePersistedInbox: async (entries) => {
      calls.saves.push(entries);
      calls.events.push(`save:${entries.map((entry) => entry.id).join(',')}`);
      return entries;
    },
    deletePersistedInboxEntry: async (entryId) => {
      calls.deletes.push(entryId);
      calls.events.push(`delete:${entryId}`);
      return [];
    },
    organizeInboxEntries: async (entries, token) => {
      calls.organizes.push({ ids: entries.map((entry) => entry.id), token });
      calls.events.push('organize');
      return [];
    },
    addPlannerTask: async (task) => {
      const taskId = typeof task === 'object' && task !== null && 'id' in task ? String(task.id) : 'unknown';
      calls.events.push(`planner:${taskId}`);
    },
    syncInboxPlannerTasks: async () => {
      calls.events.push('sync-planner');
    },
    updatePlannerTaskProject: async (taskId, projectId) => {
      calls.events.push(`project:${taskId}:${projectId}`);
    },
    addCalendarEvent: async (input) => {
      const eventId = typeof input === 'object' && input !== null && 'mailId' in input ? String(input.mailId) : 'unknown';
      calls.events.push(`calendar:${eventId}`);
    },
    projects: [{ id: 'project-1', title: 'Project One' }],
    now: () => new Date('2026-10-01T12:00:00.000Z'),
    ...overrides,
  };
  return { deps, calls };
}

function makeEntry(id: string, rawText: string, createdAt = '2026-10-01T08:00:00.000Z'): InboxEntry {
  return createInboxEntryActual(rawText, new Date(createdAt), id);
}

function makeSuggestion(entryId: string, category: InboxSuggestion['category'], overrides: Partial<InboxSuggestion> = {}): InboxSuggestion {
  return {
    entryId,
    category,
    title: `${category} title`,
    summary: `${category} summary`,
    nextAction: `${category} next action`,
    dueDate: null,
    relatedEntryIds: [],
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks(rounds = 8) {
  for (let i = 0; i < rounds; i += 1) await Promise.resolve();
}

function makeActionHarness(deps: InboxDeps, entries: InboxEntry[] = []) {
  const harness = createInboxHarness(deps);
  let controller = harness.render();
  controller.setters.inboxEntries(entries);
  controller.setters.inboxLoaded(true);
  controller.setters.inboxStorageStatus('saved');
  controller.setters.inboxStorageError('');
  controller.setters.inboxPreview(null);
  controller.setters.inboxAIError('');
  controller.setters.inboxRouteMessage('');
  controller = harness.render();
  return { harness, controller, current: () => harness.render() };
}

function stateValue<T>(controller: StateController, name: string): T {
  return controller.state[name] as T;
}

function action<T>(controller: StateController, name: string): T {
  return controller.actions[name] as T;
}

describe('Inbox workflow baseline isolation', () => {
  it('blocks fetch and retains a caught attempt in the safety ledger', async () => {
    try {
      await globalThis.fetch('http://127.0.0.1:38471/inbox');
    } catch {
      // The ledger must catch attempts even when application code swallows them.
    }
    expect(deniedNetworkAttempts).toEqual(['globalThis.fetch']);
    expect(assertNoDeniedAttempts).toThrow('Denied network attempts: globalThis.fetch');
    expect(globalThis.localStorage).toBe(fakeStorage);
    expect(globalThis.window.localStorage).toBe(fakeStorage);
    deniedNetworkAttempts.length = 0;
  });
});

describe('Inbox workflow behavior after extraction', () => {
  it('shows cache first, normalizes legacy AI, and merges cache-only entries with Vault data', async () => {
    const shared = makeEntry('shared', 'shared raw');
    const cacheOnly = makeEntry('cache-only', 'offline capture', '2026-09-30T08:00:00.000Z');
    const legacyCacheItem = {
      ...shared,
      processed: true,
      ai: {
        entryId: shared.id,
        category: 'Todo',
        title: 'Legacy todo',
        summary: 'Migrated from the old cache label.',
        nextAction: 'Review the note',
        dueDate: null,
        relatedEntryIds: [],
        processedAt: '2026-09-30T09:00:00.000Z',
      },
    };
    fakeStorage.setItem('chocomintLab.inbox.v1', JSON.stringify([legacyCacheItem, cacheOnly]));

    const persisted = deferred<InboxEntry[]>();
    const health = deferred<{ state: string; apiVersion?: number }>();
    const services = makeServices();
    services.deps.loadPersistedInbox = () => {
      services.calls.loads += 1;
      services.calls.events.push('load');
      return persisted.promise;
    };
    services.deps.checkLocalBridgeApiVersion = () => {
      services.calls.healthChecks += 1;
      return health.promise;
    };
    const harness = createInboxHarness(services.deps);

    let controller = harness.render();
    expect(stateValue(controller, 'inboxLoaded')).toBe(false);
    harness.commit();
    controller = harness.render();
    expect(stateValue<InboxEntry[]>(controller, 'inboxEntries').map((entry) => entry.id)).toEqual(['shared', 'cache-only']);
    expect(stateValue(controller, 'inboxLoaded')).toBe(false);
    expect(stateValue(controller, 'bridgeTokenWarning')).toContain('Local Bridge token이 없습니다.');
    expect(services.calls.loads).toBe(1);

    health.resolve({ state: 'outdated', apiVersion: 1 });
    await flushMicrotasks();
    controller = harness.render();
    expect(stateValue(controller, 'bridgeApiWarning')).toBe('Bridge version 1 is outdated.');

    persisted.resolve([shared]);
    await flushMicrotasks();
    controller = harness.render();
    const merged = stateValue<InboxEntry[]>(controller, 'inboxEntries');
    expect(merged.map((entry) => entry.id)).toEqual(['shared', 'cache-only']);
    expect(merged[0].processed).toBe(true);
    expect(merged[0].ai?.category).toBe('todo');
    expect(stateValue(controller, 'inboxLoaded')).toBe(true);
    expect(stateValue(controller, 'bridgeTokenWarning')).toBe('');
    expect(stateValue(controller, 'bridgeApiWarning')).toBe('');
    expect(services.calls.saves.map((entries) => entries.map((entry) => entry.id))).toEqual([['shared', 'cache-only']]);
    await flushMicrotasks();
    expect(stateValue(harness.render(), 'inboxStorageStatus')).toBe('saved');
    harness.unmount();
  });

  it('ignores an in-flight Vault load after tokenSaved starts a new load', async () => {
    fakeStorage.setItem('thesisBridgeToken', 'test-bridge-token');
    const firstLoad = deferred<InboxEntry[]>();
    const secondLoad = deferred<InboxEntry[]>();
    const requests = [firstLoad, secondLoad];
    const services = makeServices();
    services.deps.loadPersistedInbox = () => {
      services.calls.loads += 1;
      services.calls.events.push('load');
      const request = requests.shift();
      if (!request) throw new Error('Unexpected third Inbox load.');
      return request.promise;
    };
    const harness = createInboxHarness(services.deps);
    let controller = harness.render();
    harness.commit();
    expect(services.calls.loads).toBe(1);

    action<() => void>(controller, 'bridgeTokenSaved')();
    controller = harness.render();
    expect(stateValue(controller, 'bridgeTokenWarning')).toBe('');
    expect(stateValue(controller, 'toast')).toBe('브리지 토큰을 저장했어');
    harness.commit();
    expect(services.calls.loads).toBe(2);

    const stale = makeEntry('stale', 'from the old load');
    firstLoad.resolve([stale]);
    await flushMicrotasks();
    controller = harness.render();
    expect(stateValue(controller, 'inboxEntries')).toEqual([]);
    expect(stateValue(controller, 'inboxLoaded')).toBe(false);

    const fresh = makeEntry('fresh', 'from the token reload');
    secondLoad.resolve([fresh]);
    await flushMicrotasks();
    controller = harness.render();
    expect(stateValue<InboxEntry[]>(controller, 'inboxEntries').map((entry) => entry.id)).toEqual(['fresh']);
    expect(stateValue(controller, 'inboxLoaded')).toBe(true);
    expect(services.calls.healthChecks).toBe(1);
    harness.unmount();
  });

  it('serializes two captures and ignores the first save response after the newer capture', async () => {
    const pending: Array<{ entries: InboxEntry[]; response: ReturnType<typeof deferred<InboxEntry[]>> }> = [];
    const services = makeServices();
    services.deps.savePersistedInbox = (entries) => {
      const response = deferred<InboxEntry[]>();
      pending.push({ entries, response });
      services.calls.saves.push(entries);
      services.calls.events.push(`save:start:${entries.map((entry) => entry.rawText).join('|')}`);
      return response.promise;
    };
    const { harness, current } = makeActionHarness(services.deps);

    let controller = current();
    expect(action<(rawText: string) => boolean>(controller, 'addInboxEntry')('first capture')).toBe(true);
    controller = current();
    expect(action<(rawText: string) => boolean>(controller, 'addInboxEntry')('second capture')).toBe(true);
    await flushMicrotasks();

    expect(pending).toHaveLength(1);
    expect(pending[0].entries.map((entry) => entry.rawText)).toEqual(['first capture']);
    const firstEntry = pending[0].entries[0];
    pending[0].response.resolve([firstEntry]);
    await flushMicrotasks();

    controller = current();
    expect(pending).toHaveLength(2);
    expect(pending[1].entries.map((entry) => entry.rawText)).toEqual(['second capture', 'first capture']);
    expect(stateValue<InboxEntry[]>(controller, 'inboxEntries').map((entry) => entry.rawText)).toEqual(['second capture', 'first capture']);
    pending[1].response.resolve(pending[1].entries);
    await flushMicrotasks();

    controller = current();
    expect(stateValue(controller, 'inboxStorageStatus')).toBe('saved');
    expect(stateValue<InboxEntry[]>(controller, 'inboxEntries').map((entry) => entry.rawText)).toEqual(['second capture', 'first capture']);
    expect(services.calls.events).toEqual(['save:start:first capture', 'save:start:second capture|first capture']);
    harness.unmount();
  });

  it('keeps the local capture after a Vault failure and retries with the current entries', async () => {
    const services = makeServices();
    services.deps.savePersistedInbox = (entries) => {
      services.calls.saves.push(entries);
      services.calls.events.push(`save:${entries.map((entry) => entry.id).join(',')}`);
      return services.calls.saves.length === 1 ? Promise.reject(new Error('Vault offline')) : Promise.resolve(entries);
    };
    const { harness, current } = makeActionHarness(services.deps);

    let controller = current();
    expect(action<(rawText: string) => boolean>(controller, 'addInboxEntry')('keep this capture')).toBe(true);
    await flushMicrotasks();
    controller = current();
    const captured = stateValue<InboxEntry[]>(controller, 'inboxEntries');
    expect(stateValue(controller, 'inboxStorageStatus')).toBe('failed');
    expect(stateValue(controller, 'inboxStorageError')).toBe('Vault offline');
    expect(loadInboxEntries()).toEqual(captured);

    action<() => void>(controller, 'retryInboxSave')();
    await flushMicrotasks();
    controller = current();
    expect(services.calls.saves.map((entries) => entries.map((entry) => entry.id))).toEqual([[captured[0].id], [captured[0].id]]);
    expect(stateValue<InboxEntry[]>(controller, 'inboxEntries')).toEqual(captured);
    expect(stateValue(controller, 'inboxStorageStatus')).toBe('saved');
    expect(stateValue(controller, 'inboxStorageError')).toBe('');
    harness.unmount();
  });

  it('gates organization by token and pending entries, batches four, and accepts a late response after discard', async () => {
    const oldEntry = makeEntry('old', 'already processed');
    const processed = applyInboxSuggestionsActual([oldEntry], [makeSuggestion(oldEntry.id, 'idea')], new Date('2026-10-01T12:00:00.000Z'))[0];
    const pending = [0, 1, 2, 3, 4].map((index) => makeEntry(`pending-${index}`, `raw ${index}`, `2026-09-${26 + index}T08:00:00.000Z`));
    const response = deferred<InboxSuggestion[]>();
    const services = makeServices();
    services.deps.organizeInboxEntries = async (entries, token) => {
      services.calls.organizes.push({ ids: entries.map((entry) => entry.id), token });
      services.calls.events.push('organize');
      return response.promise;
    };
    const { harness, current } = makeActionHarness(services.deps, [pending[0], processed, ...pending.slice(1)]);

    let controller = current();
    await action<() => Promise<void>>(controller, 'organizeInbox')();
    controller = current();
    expect(stateValue(controller, 'page')).toBe('inbox');
    expect(stateValue(controller, 'bridgeTokenWarning')).toContain('Local Bridge token이 없습니다.');
    expect(stateValue(controller, 'inboxAIError')).toBe('Local Bridge token이 없어 GPT 정리를 실행할 수 없습니다. Settings > 로컬 브리지에서 token을 저장해 주세요.');
    expect(services.calls.organizes).toEqual([]);

    fakeStorage.setItem('thesisBridgeToken', 'test-bridge-token');
    controller.setters.inboxEntries([processed]);
    controller = current();
    await action<() => Promise<void>>(controller, 'organizeInbox')();
    controller = current();
    expect(stateValue(controller, 'inboxAIError')).toBe('GPT로 정리할 새 항목이 없어.');
    expect(services.calls.organizes).toEqual([]);

    const lateSuggestions = pending.slice(0, 4).map((entry) => makeSuggestion(entry.id, 'idea'));
    controller.setters.inboxEntries([pending[0], processed, ...pending.slice(1)]);
    controller.setters.inboxPreview([makeSuggestion('old', 'other')]);
    controller = current();
    const organization = action<() => Promise<void>>(controller, 'organizeInbox')();
    controller = current();
    expect(services.calls.organizes).toEqual([{ ids: pending.slice(0, 4).map((entry) => entry.id), token: 'test-bridge-token' }]);
    expect(stateValue(controller, 'inboxOrganizing')).toBe(true);
    expect(stateValue(controller, 'inboxPreview')).toBe(null);

    action<() => void>(controller, 'discardInboxPreview')();
    expect(stateValue(current(), 'inboxPreview')).toBe(null);
    response.resolve(lateSuggestions);
    await organization;
    controller = current();
    expect(stateValue(controller, 'inboxOrganizing')).toBe(false);
    expect(stateValue(controller, 'inboxPreview')).toEqual(lateSuggestions);
    harness.unmount();
  });

  it('continues Planner and Calendar routing after a durable Inbox write fails (F9 baseline)', async () => {
    const todo = makeEntry('todo-1', '초안 작성');
    const dated = makeEntry('schedule-1', '2026-11-03 14:00 lab meeting');
    const relative = makeEntry('schedule-2', 'next Friday meeting');
    const other = makeEntry('other-1', 'reference note');
    const suggestions = [
      makeSuggestion(todo.id, 'todo', { title: 'Write draft', nextAction: 'Draft the results' }),
      makeSuggestion(dated.id, 'schedule', { title: 'Lab meeting', dueDate: '2026-11-03' }),
      makeSuggestion(relative.id, 'schedule', { title: 'Relative meeting', dueDate: '2026-11-06' }),
      makeSuggestion(other.id, 'other', { title: 'Reference' }),
    ];
    const services = makeServices();
    services.deps.savePersistedInbox = (entries) => {
      services.calls.saves.push(entries);
      services.calls.events.push('vault-save');
      return Promise.reject(new Error('Vault write failed'));
    };
    const { harness, current } = makeActionHarness(services.deps, [todo, dated, relative, other]);
    let controller = current();
    controller.setters.inboxPreview(suggestions);
    controller = current();

    await action<() => Promise<void>>(controller, 'applyInboxPreview')();
    controller = current();
    const applied = stateValue<InboxEntry[]>(controller, 'inboxEntries');
    expect(applied.map((entry) => entry.rawText)).toEqual(['초안 작성', '2026-11-03 14:00 lab meeting', 'next Friday meeting', 'reference note']);
    expect(applied.find((entry) => entry.id === relative.id)?.ai?.dueDate).toBe(null);
    expect(applied.find((entry) => entry.id === other.id)?.ai?.nextAction).toBe('');
    expect(stateValue(controller, 'inboxStorageStatus')).toBe('failed');
    expect(stateValue(controller, 'inboxStorageError')).toBe('Vault write failed');
    expect(services.calls.events).toEqual(['vault-save', 'planner:inbox:todo-1', 'calendar:inbox:schedule-1']);
    expect(stateValue(controller, 'inboxRouteMessage')).toBe('분류 저장 완료 · Planner 1건 · Calendar 1건. 원문에 명시된 날짜를 등록하고, 시간이 없으면 종일 일정으로 저장해.');
    expect(stateValue(controller, 'toast')).toBe('GPT 정리와 가능한 자동 전달을 마쳤어. 원문은 보존했어.');
    expect(stateValue(controller, 'inboxPreview')).toBe(null);
    harness.unmount();
  });

  it('stops applying when the browser cache cannot save the reviewed preview', async () => {
    const todo = makeEntry('cache-fail', 'write a paragraph');
    const suggestions = [makeSuggestion(todo.id, 'todo')];
    const services = makeServices();
    const { harness, current } = makeActionHarness(services.deps, [todo]);
    let controller = current();
    controller.setters.inboxPreview(suggestions);
    controller = current();
    failInboxStorageWritesForTest(true);

    await action<() => Promise<void>>(controller, 'applyInboxPreview')();
    controller = current();
    expect(stateValue<InboxEntry[]>(controller, 'inboxEntries')).toEqual([todo]);
    expect(stateValue(controller, 'inboxPreview')).toEqual(suggestions);
    expect(stateValue(controller, 'inboxAIError')).toBe('브라우저 저장 공간을 확인해줘. 원문과 미리보기는 그대로 남아 있어.');
    expect(services.calls.saves).toEqual([]);
    expect(services.calls.events).toEqual([]);
    harness.unmount();
  });

  it('keeps applied suggestions after routing errors and makes no automatic retry or rollback', async () => {
    const todo = makeEntry('route-todo', 'write the abstract');
    const schedule = makeEntry('route-calendar', '2026-11-03 14:00 review meeting');
    const suggestions = [
      makeSuggestion(todo.id, 'todo', { title: 'Abstract', nextAction: 'Draft abstract' }),
      makeSuggestion(schedule.id, 'schedule', { title: 'Review', dueDate: '2026-11-03' }),
    ];
    const services = makeServices();
    services.deps.addPlannerTask = async () => {
      services.calls.events.push('planner-attempt');
      throw new Error('Planner offline');
    };
    services.deps.addCalendarEvent = async () => {
      services.calls.events.push('calendar-attempt');
      throw new Error('Calendar quota');
    };
    const { harness, current } = makeActionHarness(services.deps, [todo, schedule]);
    let controller = current();
    controller.setters.inboxPreview(suggestions);
    controller = current();

    await action<() => Promise<void>>(controller, 'applyInboxPreview')();
    controller = current();
    expect(services.calls.events).toEqual([`save:${todo.id},${schedule.id}`, 'planner-attempt', 'calendar-attempt']);
    expect(services.calls.saves).toHaveLength(1);
    expect(stateValue(controller, 'inboxStorageStatus')).toBe('saved');
    expect(stateValue<InboxEntry[]>(controller, 'inboxEntries').every((entry) => entry.processed)).toBe(true);
    expect(stateValue(controller, 'inboxRouteMessage')).toBe('분류는 저장했어. 자동 전달 실패 2건: Abstract → Planner: Planner offline · Review → Calendar: Calendar quota');
    harness.unmount();
  });

  it('blocks delete during a pending write and preserves the stale delete ID after queued capture', async () => {
    const existing = makeEntry('delete-me', 'delete this row');
    const deleteResponse = deferred<InboxEntry[]>();
    const saveResponse = deferred<InboxEntry[]>();
    const services = makeServices();
    services.deps.deletePersistedInboxEntry = async (entryId) => {
      services.calls.deletes.push(entryId);
      services.calls.events.push(`delete-start:${entryId}`);
      return deleteResponse.promise;
    };
    services.deps.savePersistedInbox = async (entries) => {
      services.calls.saves.push(entries);
      services.calls.events.push(`save-start:${entries.map((entry) => entry.id).join(',')}`);
      return saveResponse.promise;
    };
    const { harness, current } = makeActionHarness(services.deps, [existing]);

    let controller = current();
    const deletion = action<(entryId: string) => Promise<boolean>>(controller, 'deleteInboxEntry')('delete-me');
    await flushMicrotasks();
    controller = current();
    expect(stateValue(controller, 'inboxStorageStatus')).toBe('saving');
    expect(stateValue(controller, 'inboxDeleteSavingId')).toBe('delete-me');
    expect(await action<(entryId: string) => Promise<boolean>>(controller, 'deleteInboxEntry')('other')).toBe(false);
    expect(services.calls.deletes).toEqual(['delete-me']);

    controller = current();
    expect(action<(rawText: string) => boolean>(controller, 'addInboxEntry')('capture during delete')).toBe(true);
    const capturedId = stateValue<InboxEntry[]>(current(), 'inboxEntries')[0].id;
    await flushMicrotasks();
    expect(services.calls.saves).toEqual([]);
    deleteResponse.resolve([]);
    expect(await deletion).toBe(false);
    await flushMicrotasks();

    expect(services.calls.events).toEqual(['delete-start:delete-me', `save-start:${capturedId},delete-me`]);
    expect(services.calls.saves[0].map((entry) => entry.id)).toEqual([capturedId, 'delete-me']);
    saveResponse.resolve(services.calls.saves[0]);
    await flushMicrotasks();

    controller = current();
    expect(stateValue<InboxEntry[]>(controller, 'inboxEntries').map((entry) => entry.id)).toEqual([capturedId, 'delete-me']);
    expect(stateValue(controller, 'inboxStorageStatus')).toBe('saved');
    expect(stateValue(controller, 'inboxDeleteSavingId')).toBe('delete-me');
    expect(loadInboxEntries().map((entry) => entry.id)).toEqual([capturedId, 'delete-me']);
    harness.unmount();
  });

  it('associates Inbox tasks in Planner-first order and reports project lookup and sync errors', async () => {
    const raw = makeEntry('association', 'email the advisor');
    const todo = applyInboxSuggestionsActual([raw], [makeSuggestion(raw.id, 'todo')], new Date('2026-10-01T12:00:00.000Z'))[0];
    const services = makeServices();
    const first = makeActionHarness(services.deps, [todo]);

    await action<(entryId: string, projectId: string) => Promise<void>>(first.current(), 'addInboxTaskToProject')('association', 'project-1');
    let controller = first.current();
    expect(services.calls.events).toEqual(['sync-planner', 'project:inbox:association:project-1']);
    expect(stateValue(controller, 'toast')).toBe('Planner와 Project One 다음 작업에 연결했어.');
    expect(stateValue(controller, 'projectTaskSavingId')).toBe(null);

    services.calls.events.length = 0;
    await action<(entryId: string, projectId: string) => Promise<void>>(controller, 'addInboxTaskToProject')('association', 'missing-project');
    controller = first.current();
    expect(services.calls.events).toEqual([]);
    expect(stateValue(controller, 'toast')).toBe('선택한 프로젝트를 찾지 못했어.');
    first.harness.unmount();

    const failingServices = makeServices();
    failingServices.deps.syncInboxPlannerTasks = async () => {
      failingServices.calls.events.push('sync-failed');
      throw new Error('Planner sync failed');
    };
    const second = makeActionHarness(failingServices.deps, [todo]);
    await action<(entryId: string, projectId: string) => Promise<void>>(second.current(), 'addInboxTaskToProject')('association', 'project-1');
    controller = second.current();
    expect(failingServices.calls.events).toEqual(['sync-failed']);
    expect(stateValue(controller, 'toast')).toBe('Planner sync failed');
    expect(stateValue(controller, 'projectTaskSavingId')).toBe(null);
    second.harness.unmount();
  });
});
