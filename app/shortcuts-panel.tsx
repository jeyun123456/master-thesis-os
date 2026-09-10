'use client';

import type { Shortcut, ShortcutType } from '@/lib/shortcuts';

export function ShortcutsPanel({ shortcuts, onOpenFile, onOpenFolder }: {
  shortcuts: Shortcut[];
  onOpenFile: (path: string) => void;
  onOpenFolder: (path: string) => void;
}) {
  return <div className="shortcuts-shell">
    <div className="card section shortcuts-intro"><div><h3>바로가기</h3><p>반복해서 여는 웹 주소와 연구 저장소의 파일·폴더를 한곳에서 관리해.</p></div><span>config/shortcuts.json</span></div>
    <section className="card section section-gap"><div className="head"><h3>사용 가능한 바로가기</h3><span>{shortcuts.length}개</span></div><ShortcutList shortcuts={shortcuts} onOpenFile={onOpenFile} onOpenFolder={onOpenFolder} /></section>
  </div>;
}

export function ShortcutList({ shortcuts, onOpenFile, onOpenFolder }: {
  shortcuts: Shortcut[];
  onOpenFile: (path: string) => void;
  onOpenFolder: (path: string) => void;
}) {
  if (!shortcuts.length) return <div className="empty compact-empty">활성화된 바로가기가 없어.</div>;
  return <div className="shortcut-list">{shortcuts.map((shortcut) => <ShortcutRow key={shortcut.id} shortcut={shortcut} onOpenFile={onOpenFile} onOpenFolder={onOpenFolder} />)}</div>;
}

function ShortcutRow({ shortcut, onOpenFile, onOpenFolder }: {
  shortcut: Shortcut;
  onOpenFile: (path: string) => void;
  onOpenFolder: (path: string) => void;
}) {
  const action = shortcut.type === 'web'
    ? <a className="mini shortcut-action" href={shortcut.target} target="_blank" rel="noreferrer">열기</a>
    : <button className="mini shortcut-action" type="button" onClick={() => shortcut.type === 'file' ? onOpenFile(shortcut.target) : onOpenFolder(shortcut.target)}>열기</button>;
  return <div className="shortcut-row">
    <span className="shortcut-icon" aria-hidden="true">{shortcut.icon || typeIcon(shortcut.type)}</span>
    <div className="shortcut-main"><b>{shortcut.title}</b><small>{shortcut.description || shortcut.target || typeLabel(shortcut.type)}</small><code>{shortcut.target || 'Vault root'}</code></div>
    <span className="shortcut-type">{typeLabel(shortcut.type)}</span>
    {action}
  </div>;
}

function typeLabel(type: ShortcutType) {
  return type === 'web' ? '웹' : type === 'file' ? '파일' : '폴더';
}

function typeIcon(type: ShortcutType) {
  return type === 'web' ? '↗' : type === 'file' ? '▤' : '⌂';
}
