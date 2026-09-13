'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  detectShortcutType,
  isRepositoryShortcut,
  loadShortcutState,
  saveShortcutState,
  shortcutTitleFromTarget,
  type Shortcut,
  type ShortcutType,
} from '@/lib/shortcuts';
import { launchExternalShortcut, pickShortcutTarget } from '@/lib/native-shortcut';

type OpenLocal = (path: string) => void;
type EditSource = Shortcut | 'new' | null;

type ContextState = {
  shortcut: Shortcut;
  x: number;
  y: number;
} | null;

export function ShortcutsPanel({ shortcuts, onOpenFile, onOpenFolder }: {
  shortcuts: Shortcut[];
  onOpenFile: OpenLocal;
  onOpenFolder: OpenLocal;
}) {
  const [items, setItems] = useState<Shortcut[]>(shortcuts);
  const [editing, setEditing] = useState<EditSource>(null);
  const [context, setContext] = useState<ContextState>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

  useEffect(() => setItems(loadShortcutState(shortcuts)), []);
  useEffect(() => {
    if (!context) return;
    const close = () => setContext(null);
    window.addEventListener('click', close);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('blur', close);
    };
  }, [context]);

  function pop(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(''), 1800);
  }

  function commit(next: Shortcut[]) {
    const normalized = next.map((item, index) => ({ ...item, order: index }));
    setItems(normalized);
    saveShortcutState(normalized);
  }

  async function open(shortcut: Shortcut) {
    const result = await openShortcut(shortcut, onOpenFile, onOpenFolder);
    if (result) pop(result);
  }

  function duplicate(shortcut: Shortcut) {
    const duplicateItem: Shortcut = {
      ...shortcut,
      id: createShortcutId(),
      title: `${shortcut.title} 복사본`,
      order: items.length,
    };
    commit([...items, duplicateItem]);
    pop('바로가기를 복제했어.');
  }

  function remove(shortcut: Shortcut) {
    if (!window.confirm(`“${shortcut.title}” 바로가기를 삭제할까?`)) return;
    commit(items.filter((item) => item.id !== shortcut.id));
    setContext(null);
    pop('바로가기를 삭제했어.');
  }

  function reorder(targetId: string) {
    if (!draggedId || draggedId === targetId) return;
    const from = items.findIndex((item) => item.id === draggedId);
    const to = items.findIndex((item) => item.id === targetId);
    if (from < 0 || to < 0) return;
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    commit(next);
  }

  return <div className="shortcuts-shell">
    <div className="card section shortcuts-intro">
      <div><h3>바로가기</h3><p>웹 · 프로그램 · 파일 · 폴더 · 명령어를 바탕화면 아이콘처럼 실행해.</p></div>
      <span>{items.length}개 · 이 기기에 저장</span>
    </div>

    <section className="card section section-gap shortcut-desktop">
      <div className="shortcut-grid" role="list">
        {items.map((shortcut) => <ShortcutTile
          key={shortcut.id}
          shortcut={shortcut}
          dragged={draggedId === shortcut.id}
          onOpen={() => void open(shortcut)}
          onDragStart={() => setDraggedId(shortcut.id)}
          onDragEnd={() => setDraggedId(null)}
          onDrop={() => reorder(shortcut.id)}
          onContextMenu={(event) => {
            event.preventDefault();
            setContext({ shortcut, x: event.clientX, y: event.clientY });
          }}
        />)}
        <button className="shortcut-tile shortcut-add-tile" type="button" onClick={() => setEditing('new')} aria-label="바로가기 추가">
          <span className="shortcut-tile-icon shortcut-add-icon" aria-hidden="true">＋</span>
          <span className="shortcut-tile-title">추가</span>
        </button>
      </div>
      {notice && <div className="shortcut-notice" role="status">{notice}</div>}
    </section>

    {context && <div className="shortcut-context-menu" style={{ left: context.x, top: context.y }} onClick={(event) => event.stopPropagation()}>
      <button type="button" onClick={() => { setContext(null); void open(context.shortcut); }}>열기</button>
      <button type="button" onClick={() => { setEditing(context.shortcut); setContext(null); }}>편집</button>
      <button type="button" onClick={() => { duplicate(context.shortcut); setContext(null); }}>복제</button>
      <span />
      <button className="danger" type="button" onClick={() => remove(context.shortcut)}>삭제</button>
    </div>}

    {editing && <ShortcutEditDialog
      source={editing === 'new' ? undefined : editing}
      nextOrder={items.length}
      onNotice={pop}
      onClose={() => setEditing(null)}
      onSave={(shortcut) => {
        const exists = items.some((item) => item.id === shortcut.id);
        commit(exists ? items.map((item) => item.id === shortcut.id ? shortcut : item) : [...items, shortcut]);
        setEditing(null);
        pop(exists ? '바로가기를 수정했어.' : '바로가기를 추가했어.');
      }}
    />}
  </div>;
}

export function ShortcutList({ shortcuts, onOpenFile, onOpenFolder }: {
  shortcuts: Shortcut[];
  onOpenFile: OpenLocal;
  onOpenFolder: OpenLocal;
}) {
  if (!shortcuts.length) return <div className="empty compact-empty">활성화된 바로가기가 없어.</div>;
  return <div className="shortcut-list">{shortcuts.map((shortcut) => <div className="shortcut-row" key={shortcut.id}>
    <ShortcutIcon shortcut={shortcut} compact />
    <div className="shortcut-main"><b>{shortcut.title}</b><small>{shortcut.description || shortcut.target || typeLabel(shortcut.type)}</small><code>{shortcut.target || 'Vault root'}</code></div>
    <span className="shortcut-type">{typeLabel(shortcut.type)}</span>
    <button className="mini shortcut-action" type="button" onClick={() => void openShortcut(shortcut, onOpenFile, onOpenFolder)}>열기</button>
  </div>)}</div>;
}

function ShortcutTile({ shortcut, dragged, onOpen, onContextMenu, onDragStart, onDragEnd, onDrop }: {
  shortcut: Shortcut;
  dragged: boolean;
  onOpen: () => void;
  onContextMenu: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDrop: () => void;
}) {
  return <button
    className={`shortcut-tile${dragged ? ' dragging' : ''}`}
    type="button"
    draggable
    title={`${shortcut.title}\n${shortcut.target}`}
    onClick={onOpen}
    onContextMenu={onContextMenu}
    onDragStart={(event) => { event.dataTransfer.effectAllowed = 'move'; onDragStart(); }}
    onDragEnd={onDragEnd}
    onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; }}
    onDrop={(event) => { event.preventDefault(); onDrop(); }}
    role="listitem"
  >
    <ShortcutIcon shortcut={shortcut} />
    <span className="shortcut-tile-title">{shortcut.title}</span>
  </button>;
}

function ShortcutEditDialog({ source, nextOrder, onSave, onClose, onNotice }: {
  source?: Shortcut;
  nextOrder: number;
  onSave: (shortcut: Shortcut) => void;
  onClose: () => void;
  onNotice: (message: string) => void;
}) {
  const [mode, setMode] = useState<ShortcutType | 'auto'>(source?.type || 'auto');
  const [target, setTarget] = useState(source?.target || '');
  const [title, setTitle] = useState(source?.title || '');
  const [titleDirty, setTitleDirty] = useState(Boolean(source));
  const [icon, setIcon] = useState(source?.icon || '');
  const [description, setDescription] = useState(source?.description || '');
  const [args, setArgs] = useState(source?.args || '');
  const [workingDirectory, setWorkingDirectory] = useState(source?.workingDirectory || '');
  const [runAsAdmin, setRunAsAdmin] = useState(source?.runAsAdmin === true);
  const type = useMemo(() => mode === 'auto' ? detectShortcutType(target) : mode, [mode, target]);
  const preview: Shortcut = {
    id: source?.id || 'preview', title: title || shortcutTitleFromTarget(target, type) || '새 바로가기', type, target,
    icon: icon || undefined, description: description || undefined, args: args || undefined, workingDirectory: workingDirectory || undefined,
    runAsAdmin, pinnedToHome: source?.pinnedToHome || false, enabled: true, order: source?.order ?? nextOrder,
  };

  function updateTarget(value: string, forcedType?: ShortcutType) {
    setTarget(value);
    const nextType = forcedType || (mode === 'auto' ? detectShortcutType(value) : mode);
    if (!titleDirty) setTitle(shortcutTitleFromTarget(value, nextType));
  }

  async function browse() {
    if (type !== 'app' && type !== 'file' && type !== 'folder') return;
    const result = await pickShortcutTarget(type);
    if (!result.available) {
      onNotice('찾아보기는 Windows Wallpaper Host에서 사용할 수 있어.');
      return;
    }
    if (result.error) {
      onNotice(result.error);
      return;
    }
    if (!result.path) return;
    if (mode === 'auto') setMode(type);
    if (result.icon) setIcon(result.icon);
    updateTarget(result.path, type);
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const cleanTarget = target.trim();
    const cleanTitle = title.trim() || shortcutTitleFromTarget(cleanTarget, type);
    if (!cleanTarget || !cleanTitle) {
      onNotice('이름과 대상을 확인해줘.');
      return;
    }
    if (type === 'command' && !source && !window.confirm(`이 명령어 바로가기를 저장할까?\n\n${cleanTarget}`)) return;
    onSave({
      id: source?.id || createShortcutId(),
      title: cleanTitle,
      type,
      target: cleanTarget,
      icon: icon.trim() || undefined,
      description: description.trim() || undefined,
      args: args.trim() || undefined,
      workingDirectory: workingDirectory.trim() || undefined,
      runAsAdmin: (type === 'app' || type === 'command') && runAsAdmin,
      pinnedToHome: source?.pinnedToHome || false,
      enabled: true,
      order: source?.order ?? nextOrder,
    });
  }

  const canBrowse = type === 'app' || type === 'file' || type === 'folder';
  const showLaunchOptions = type === 'app' || type === 'command';

  return <div className="shortcut-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
    <form className="shortcut-dialog" onSubmit={submit}>
      <div className="shortcut-dialog-preview"><ShortcutIcon shortcut={preview} /><b>{preview.title}</b><small>{typeLabel(type)}</small></div>
      <div className="shortcut-form-row">
        <label>유형<select value={mode} onChange={(event) => setMode(event.target.value as ShortcutType | 'auto')}>
          <option value="auto">자동 감지</option><option value="web">웹사이트</option><option value="app">프로그램</option><option value="file">파일</option><option value="folder">폴더</option><option value="command">명령어</option>
        </select></label>
      </div>
      <div className="shortcut-form-row shortcut-target-row">
        <label>대상<input value={target} onChange={(event) => updateTarget(event.target.value)} placeholder={targetPlaceholder(type)} autoFocus /></label>
        {canBrowse && <button className="btn shortcut-browse" type="button" onClick={() => void browse()}>찾아보기</button>}
      </div>
      <div className="shortcut-form-row"><label>이름<input value={title} onChange={(event) => { setTitleDirty(true); setTitle(event.target.value); }} placeholder="표시 이름" /></label></div>

      <details className="shortcut-advanced">
        <summary>추가 옵션</summary>
        {showLaunchOptions && <>
          {type === 'app' && <div className="shortcut-form-row"><label>실행 인자<input value={args} onChange={(event) => setArgs(event.target.value)} placeholder="예: --profile thesis" /></label></div>}
          <div className="shortcut-form-row"><label>작업 폴더<input value={workingDirectory} onChange={(event) => setWorkingDirectory(event.target.value)} placeholder="예: D:\\master-thesis-os" /></label></div>
          <label className="shortcut-checkbox"><input type="checkbox" checked={runAsAdmin} onChange={(event) => setRunAsAdmin(event.target.checked)} />관리자 권한으로 실행</label>
        </>}
        <div className="shortcut-form-row"><label>설명<input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="선택 사항" /></label></div>
        <div className="shortcut-form-row"><label>아이콘<input value={icon} onChange={(event) => setIcon(event.target.value)} placeholder="이모지, 이미지 URL 또는 data URL" /></label></div>
      </details>

      <div className="shortcut-dialog-actions"><button className="btn" type="button" onClick={onClose}>취소</button><button className="btn primary" type="submit">{source ? '저장' : '추가'}</button></div>
    </form>
  </div>;
}

function ShortcutIcon({ shortcut, compact = false }: { shortcut: Shortcut; compact?: boolean }) {
  const custom = shortcut.icon?.trim();
  const image = custom && (/^(?:https?:|data:image\/)/i.test(custom));
  const favicon = !custom && shortcut.type === 'web' ? faviconUrl(shortcut.target) : null;
  const source = image ? custom : favicon;
  return <span className={compact ? 'shortcut-icon' : 'shortcut-tile-icon'} aria-hidden="true">
    {image ? typeIcon(shortcut.type) : custom || typeIcon(shortcut.type)}
    {source && <img src={source} alt="" onError={(event) => { event.currentTarget.style.display = 'none'; }} />}
  </span>;
}

async function openShortcut(shortcut: Shortcut, onOpenFile: OpenLocal, onOpenFolder: OpenLocal) {
  if (shortcut.type === 'web') {
    window.open(shortcut.target, '_blank', 'noopener,noreferrer');
    return '';
  }
  if (isRepositoryShortcut(shortcut)) {
    if (shortcut.type === 'file') onOpenFile(shortcut.target);
    else onOpenFolder(shortcut.target);
    return '';
  }
  const result = await launchExternalShortcut(shortcut);
  return result.message;
}

function faviconUrl(target: string) {
  try { return `${new URL(target).origin}/favicon.ico`; } catch { return null; }
}

function targetPlaceholder(type: ShortcutType) {
  if (type === 'web') return 'https://example.com';
  if (type === 'app') return 'C:\\Program Files\\App\\App.exe';
  if (type === 'folder') return 'D:\\Research';
  if (type === 'command') return 'npm run dev';
  return 'D:\\Research\\paper.pdf';
}

function typeLabel(type: ShortcutType) {
  return type === 'web' ? '웹' : type === 'app' ? '프로그램' : type === 'file' ? '파일' : type === 'folder' ? '폴더' : '명령어';
}

function typeIcon(type: ShortcutType) {
  return type === 'web' ? '🌐' : type === 'app' ? '▣' : type === 'file' ? '📄' : type === 'folder' ? '📁' : '>_';
}

function createShortcutId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `shortcut-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
