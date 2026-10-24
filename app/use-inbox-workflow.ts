'use client';

import { useEffect, useRef, useState } from 'react';
import {
  applyInboxSuggestions,
  createInboxEntry,
  INBOX_AI_BATCH_SIZE,
  loadInboxEntries,
  mergeInboxEntries,
  saveInboxEntries,
  type InboxEntry,
  type InboxSuggestion,
} from '../lib/inbox';
import { organizeInboxEntries } from '../lib/inbox-ai-client';
import {
  deletePersistedInboxEntry,
  InboxPersistenceError,
  loadPersistedInbox,
  readBridgeToken,
  savePersistedInbox,
} from '../lib/inbox-persistence-client';
import { loadPlannerTaskStore } from '../lib/planner-tasks-client';
import { plannerTaskFromInboxEntry } from '../lib/planner-tasks';
import { createP0Task, p0InboxTaskId, updateP0Task } from '../lib/p0-tasks-client';
import { calendarInputForInboxEntry } from '../lib/inbox-calendar';
import { addCalendarEvent } from '../lib/calendar-client';
import { BridgeApiVersionMismatchError, bridgeApiVersionMismatchMessage, checkLocalBridgeApiVersion } from '../lib/bridge-status';
import type { ResearchProject } from '../lib/projects';
import type { InboxStorageStatus } from './inbox-panel';

type UseInboxWorkflowOptions = {
  projects: ResearchProject[];
  onNotice: (message: string) => void;
  onOpenInbox: () => void;
};

async function createP0InboxTask(entry: InboxEntry) {
  const plannerTask = plannerTaskFromInboxEntry({ ...entry, p0TaskId: null });
  if (!plannerTask) return null;
  const id = entry.p0TaskId || p0InboxTaskId(entry.id);
  const result = await createP0Task({
    id,
    op_id: `mtos-inbox-${id}`,
    fields: {
      title: plannerTask.title.slice(0, 500),
      status: 'open',
      due_date: plannerTask.dueDate,
      is_today: false,
      category: 'personal',
      memo: plannerTask.description,
    },
  });
  return { id, task: result.task };
}

export function useInboxWorkflow({ projects, onNotice, onOpenInbox }: UseInboxWorkflowOptions) {
  const [inboxEntries, setInboxEntries] = useState<InboxEntry[]>([]);
  const [inboxPreview, setInboxPreview] = useState<InboxSuggestion[] | null>(null);
  const [inboxLoaded, setInboxLoaded] = useState(false);
  const [inboxStorageStatus, setInboxStorageStatus] = useState<InboxStorageStatus>('loading');
  const [inboxStorageError, setInboxStorageError] = useState('');
  const [bridgeApiWarning, setBridgeApiWarning] = useState('');
  const [bridgeTokenWarning, setBridgeTokenWarning] = useState('');
  const [inboxLoadAttempt, setInboxLoadAttempt] = useState(0);
  const inboxSaveRevision = useRef(0);
  const inboxWriteQueue = useRef<Promise<void>>(Promise.resolve());
  const [inboxOrganizing, setInboxOrganizing] = useState(false);
  const [inboxAIError, setInboxAIError] = useState('');
  const [inboxRouteMessage, setInboxRouteMessage] = useState('');
  const [projectTaskSavingId, setProjectTaskSavingId] = useState<string | null>(null);
  const [inboxDeleteSavingId, setInboxDeleteSavingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!readBridgeToken().trim()) {
      setBridgeTokenWarning('Local Bridge token이 없습니다. Settings > 로컬 브리지에서 token을 저장해 주세요. token을 저장하기 전에는 Vault 저장과 GPT 정리를 사용할 수 없습니다.');
    }
    void checkLocalBridgeApiVersion().then((result) => {
      if (cancelled) return;
      setBridgeApiWarning(result.state === 'outdated' ? bridgeApiVersionMismatchMessage(result.apiVersion) : '');
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const cached = loadInboxEntries();
    setInboxEntries(cached);

    async function loadVaultInbox() {
      try {
        const persisted = await loadPersistedInbox();
        if (cancelled) return;
        const merged = mergeInboxEntries(persisted, cached);
        setInboxEntries(merged);
        const cacheSaved = saveInboxEntries(merged);
        setInboxStorageStatus(cacheSaved ? 'saved' : 'failed');
        setInboxStorageError(cacheSaved ? '' : 'Vault에는 연결됐지만 브라우저 캐시를 갱신하지 못했어요.');
        setBridgeTokenWarning('');
        setBridgeApiWarning('');
        setInboxLoaded(true);
        if (JSON.stringify(merged) !== JSON.stringify(persisted)) void persistInboxToVault(merged);
      } catch (error) {
        if (cancelled) return;
        if (error instanceof InboxPersistenceError && error.code === 'bridge_auth') {
          setBridgeTokenWarning(readBridgeToken().trim()
            ? '저장된 Local Bridge token이 거부됐습니다. Settings > 로컬 브리지에서 token을 확인해 주세요.'
            : 'Local Bridge token이 없습니다. Settings > 로컬 브리지에서 token을 저장해 주세요. token을 저장하기 전에는 Vault 저장과 GPT 정리를 사용할 수 없습니다.');
        }
        if (error instanceof InboxPersistenceError && error.code === 'bridge_outdated') {
          setBridgeApiWarning(error.message);
        }
        setInboxStorageStatus('failed');
        setInboxStorageError(error instanceof Error ? error.message : 'Vault 인박스를 불러오지 못했어요. 브라우저 캐시는 유지됩니다.');
        setInboxLoaded(true);
      }
    }

    void loadVaultInbox();
    return () => { cancelled = true; };
  }, [inboxLoadAttempt]);

  function queueInboxWrite<T>(write: () => Promise<T>): Promise<T> {
    const operation = inboxWriteQueue.current.then(write, write);
    inboxWriteQueue.current = operation.then(() => undefined, () => undefined);
    return operation;
  }

  async function persistInboxToVault(entries: InboxEntry[]): Promise<boolean> {
    const revision = ++inboxSaveRevision.current;
    setInboxStorageStatus('saving');
    setInboxStorageError('');
    try {
      const persisted = await queueInboxWrite(() => savePersistedInbox(entries));
      if (revision !== inboxSaveRevision.current) return false;
      setInboxEntries(persisted);
      const cacheSaved = saveInboxEntries(persisted);
      setInboxStorageStatus(cacheSaved ? 'saved' : 'failed');
      setInboxStorageError(cacheSaved ? '' : 'Vault에는 저장됐지만 브라우저 캐시를 갱신하지 못했어요.');
      setBridgeTokenWarning('');
      setBridgeApiWarning('');
      return true;
    } catch (error) {
      if (revision !== inboxSaveRevision.current) return false;
      if (error instanceof InboxPersistenceError && error.code === 'bridge_auth') {
        setBridgeTokenWarning(readBridgeToken().trim()
          ? '저장된 Local Bridge token이 거부됐습니다. Settings > 로컬 브리지에서 token을 확인해 주세요.'
          : 'Local Bridge token이 없습니다. Settings > 로컬 브리지에서 token을 저장해 주세요. token을 저장하기 전에는 Vault 저장과 GPT 정리를 사용할 수 없습니다.');
      }
      if (error instanceof InboxPersistenceError && error.code === 'bridge_outdated') {
        setBridgeApiWarning(error.message);
      }
      setInboxStorageStatus('failed');
      setInboxStorageError(error instanceof Error ? error.message : 'Vault 저장에 실패했어요. 브라우저 캐시는 유지됩니다.');
      return false;
    }
  }

  function addInboxEntry(rawText: string) {
    if (!inboxLoaded) return false;
    try {
      const entry = createInboxEntry(rawText);
      const next = [entry, ...inboxEntries];
      if (!saveInboxEntries(next)) {
        onNotice('브라우저 저장 공간을 확인해줘');
        return false;
      }
      setInboxEntries(next);
      void persistInboxToVault(next);
      onNotice('인박스에 추가했어. Vault에 저장 중이야.');
      return true;
    } catch (error) {
      onNotice(error instanceof Error ? error.message : '인박스에 저장하지 못했어');
      return false;
    }
  }

  async function organizeInbox() {
    onOpenInbox();
    setInboxAIError('');
    setInboxPreview(null);
    setInboxRouteMessage('');
    const token = readBridgeToken();
    if (!token.trim()) {
      setBridgeTokenWarning('Local Bridge token이 없습니다. Settings > 로컬 브리지에서 token을 저장해 주세요. token을 저장하기 전에는 Vault 저장과 GPT 정리를 사용할 수 없습니다.');
      setInboxAIError('Local Bridge token이 없어 GPT 정리를 실행할 수 없습니다. Settings > 로컬 브리지에서 token을 저장해 주세요.');
      return;
    }
    setBridgeTokenWarning('');
    const pending = inboxEntries.filter((entry) => !entry.processed).slice(0, INBOX_AI_BATCH_SIZE);
    if (!pending.length) {
      setInboxAIError('GPT로 정리할 새 항목이 없어.');
      return;
    }
    setInboxOrganizing(true);
    try {
      setInboxPreview(await organizeInboxEntries(pending, token));
    } catch (error) {
      if (error instanceof BridgeApiVersionMismatchError) setBridgeApiWarning(error.message);
      setInboxAIError(error instanceof Error ? error.message : 'AI 정리 요청을 처리하지 못했어.');
    } finally {
      setInboxOrganizing(false);
    }
  }

  async function applyInboxPreview() {
    if (!inboxPreview) return;
    const suggestions = inboxPreview;
    const next = applyInboxSuggestions(inboxEntries, suggestions);
    if (!saveInboxEntries(next)) {
      setInboxAIError('브라우저 저장 공간을 확인해줘. 원문과 미리보기는 그대로 남아 있어.');
      return;
    }
    setInboxEntries(next);
    setInboxPreview(null);
    setInboxAIError('');
    await persistInboxToVault(next);

    const routeErrors: string[] = [];
    let p0Count = 0;
    let legacyPlannerCount = 0;
    let calendarCount = 0;
    let legacyPlannerStore: Awaited<ReturnType<typeof loadPlannerTaskStore>> | null | undefined;
    const routedToP0 = new Map<string, string>();
    for (const suggestion of suggestions) {
      const entry = next.find((value) => value.id === suggestion.entryId);
      if (!entry?.ai) continue;
      if (entry.ai.category === 'todo') {
        const plannerTask = plannerTaskFromInboxEntry(entry);
        if (!plannerTask) continue;
        try {
          if (legacyPlannerStore === undefined) legacyPlannerStore = await loadPlannerTaskStore();
          if (!legacyPlannerStore) throw new Error('기존 Planner와 중복인지 확인하지 못해 P0 저장을 보류했어.');
          if (legacyPlannerStore.tasks.some((task) => task.id === plannerTask.id)) {
            legacyPlannerCount += 1;
            continue;
          }
          const created = await createP0InboxTask(entry);
          if (!created) continue;
          routedToP0.set(entry.id, created.id);
          p0Count += 1;
        } catch (error) {
          routeErrors.push(`${entry.ai.title || '할 일'} → P0 SQLite: ${error instanceof Error ? error.message : '저장 실패'}`);
        }
      } else if (entry.ai.category === 'schedule') {
        const calendarInput = calendarInputForInboxEntry(entry);
        if (!calendarInput) continue;
        try {
          await addCalendarEvent(calendarInput);
          calendarCount += 1;
        } catch (error) {
          routeErrors.push(`${entry.ai.title || '일정'} → Calendar: ${error instanceof Error ? error.message : '등록 실패'}`);
        }
      }
    }
    if (routedToP0.size) {
      const routedEntries = next.map((entry) => routedToP0.has(entry.id) ? { ...entry, p0TaskId: routedToP0.get(entry.id)! } : entry);
      if (!saveInboxEntries(routedEntries)) {
        routeErrors.push('P0 할 일은 저장됐지만 Inbox의 중복 방지 표식을 브라우저에 저장하지 못했어.');
      } else {
        setInboxEntries(routedEntries);
        if (!await persistInboxToVault(routedEntries)) routeErrors.push('P0 할 일은 저장됐지만 Inbox의 중복 방지 표식을 Vault에 저장하지 못했어.');
      }
    }
    setInboxRouteMessage(routeErrors.length
      ? `분류는 저장했어. 자동 전달 실패 ${routeErrors.length}건: ${routeErrors.join(' · ')}`
      : `분류 저장 완료 · P0 SQLite ${p0Count}건 · 기존 Planner 보존 ${legacyPlannerCount}건 · Calendar ${calendarCount}건. 원문은 그대로 보존했어.`);
    onNotice(routeErrors.length ? '분류는 끝났어. 자동 전달 경고를 확인해줘.' : 'GPT 정리와 P0·Calendar 전달을 마쳤어. 원문은 보존했어.');
  }

  function discardInboxPreview() {
    setInboxPreview(null);
  }

  function retryInboxSave() {
    void persistInboxToVault(inboxEntries);
  }

  async function deleteInboxEntry(entryId: string): Promise<boolean> {
    if (!inboxLoaded || inboxOrganizing || inboxStorageStatus === 'saving' || inboxDeleteSavingId !== null) return false;
    const revision = ++inboxSaveRevision.current;
    setInboxDeleteSavingId(entryId);
    setInboxStorageStatus('saving');
    setInboxStorageError('');
    try {
      const persisted = await queueInboxWrite(() => deletePersistedInboxEntry(entryId));
      if (revision !== inboxSaveRevision.current) return false;
      setInboxEntries(persisted);
      const cacheSaved = saveInboxEntries(persisted);
      setInboxStorageStatus(cacheSaved ? 'saved' : 'failed');
      setInboxStorageError(cacheSaved ? '' : 'Vault에서는 삭제됐지만 브라우저 캐시를 갱신하지 못했어요.');
      setBridgeTokenWarning('');
      setBridgeApiWarning('');
      onNotice('Inbox 항목을 삭제했어.');
      return true;
    } catch (error) {
      if (revision !== inboxSaveRevision.current) return false;
      setInboxStorageStatus('failed');
      setInboxStorageError(error instanceof Error ? error.message : 'Inbox 항목을 삭제하지 못했어요.');
      onNotice(error instanceof Error ? error.message : 'Inbox 항목을 삭제하지 못했어.');
      return false;
    } finally {
      if (revision === inboxSaveRevision.current) setInboxDeleteSavingId(null);
    }
  }

  async function addInboxTaskToProject(entryId: string, projectId: string) {
    const entry = inboxEntries.find((value) => value.id === entryId);
    if (!entry?.ai || entry.ai.category !== 'todo') return;
    setProjectTaskSavingId(entryId);
    try {
      const project = projects.find((value) => value.id === projectId);
      if (!project) throw new Error('선택한 프로젝트를 찾지 못했어.');
      if (!entry.p0TaskId) {
        const legacy = await loadPlannerTaskStore();
        if (legacy.tasks.some((task) => task.id === `inbox:${entryId}`)) {
          throw new Error('기존 Vault Planner 항목이 있어. 자동 복제는 막았고 원본은 그대로 뒀어.');
        }
      }
      const created = await createP0InboxTask(entry);
      if (!created) throw new Error('P0 할 일로 바꿀 내용을 찾지 못했어.');
      if (!entry.p0TaskId) {
        const routedEntries = inboxEntries.map((value) => value.id === entryId ? { ...value, p0TaskId: created.id } : value);
        if (!saveInboxEntries(routedEntries)) throw new Error('P0에는 저장됐지만 Inbox 중복 방지 표식을 브라우저에 저장하지 못했어.');
        setInboxEntries(routedEntries);
        if (!await persistInboxToVault(routedEntries)) throw new Error('P0에는 저장됐지만 Inbox 중복 방지 표식을 Vault에 저장하지 못했어.');
      }
      await updateP0Task(created.id, {
        base_version: created.task.version,
        changes: { project_id: projectId },
        op_id: `mtos-inbox-project-${created.id}-${projectId}`,
      });
      onNotice(`P0 할 일을 ${project.title} 프로젝트에 연결했어.`);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : '프로젝트에 추가하지 못했어. Inbox 원문은 유지돼.');
    } finally {
      setProjectTaskSavingId(null);
    }
  }

  function bridgeTokenSaved() {
    const hasToken = Boolean(readBridgeToken().trim());
    setBridgeTokenWarning(hasToken ? '' : 'Local Bridge token이 없습니다. Settings > 로컬 브리지에서 token을 저장해 주세요. token을 저장하기 전에는 Vault 저장과 GPT 정리를 사용할 수 없습니다.');
    if (hasToken) setInboxLoadAttempt((attempt) => attempt + 1);
    onNotice('브리지 토큰을 저장했어');
  }

  return {
    inboxEntries,
    inboxPreview,
    inboxLoaded,
    inboxStorageStatus,
    inboxStorageError,
    bridgeApiWarning,
    bridgeTokenWarning,
    inboxOrganizing,
    inboxAIError,
    inboxRouteMessage,
    projectTaskSavingId,
    inboxDeleteSavingId,
    addInboxEntry,
    organizeInbox,
    applyInboxPreview,
    discardInboxPreview,
    retryInboxSave,
    deleteInboxEntry,
    addInboxTaskToProject,
    bridgeTokenSaved,
  };
}
