'use client';

import { useCallback, useEffect, useId, useRef, useState, type ReactNode, type Ref } from 'react';
import { createPortal } from 'react-dom';
import { agentErrorText } from '../lib/mtos-client';
import styles from './detail-drawer.module.css';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])';

/** Right-hand slide-over: 45% wide on desktop, full screen on phones. Content is supplied by the caller. */
export function DetailDrawer({ open, title, onClose, footer, children, compact = false }: { open: boolean; title: string; onClose: () => void; footer?: ReactNode; children: ReactNode; compact?: boolean }) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopPropagation(); onClose(); return; }
      if (event.key !== 'Tab' || !panel.current) return;
      const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (!items.length) { event.preventDefault(); return; }
      const first = items[0]; const last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || panel.current?.contains(target)) return;
      // Rows of the list stay clickable while the panel is open: they swap the content instead of closing it.
      if (target.closest('.school-mail-row-button, [data-detail-item]')) return;
      onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointerDown);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('pointerdown', onPointerDown); document.body.style.overflow = previousOverflow; };
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;
  // Rendered on <body>: an ancestor's transform/overflow/stacking context can no longer hide or clip a fixed panel.
  return createPortal(<DrawerPanel title={title} titleId={titleId} onClose={onClose} footer={footer} panelRef={panel} compact={compact}>{children}</DrawerPanel>, document.body);
}

/** The dialog markup itself (kept separate so it can be rendered and tested without a browser). */
export function DrawerPanel({ title, titleId, onClose, footer, panelRef, children, compact = false }: { title: string; titleId: string; onClose: () => void; footer?: ReactNode; panelRef?: Ref<HTMLDivElement>; children: ReactNode; compact?: boolean }) {
  return <>
    <div className={styles.overlay} aria-hidden="true" />
    <div className={`${styles.drawer} ${compact ? styles.compact : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} ref={panelRef}>
      <div className={styles.header}>
        <h2 id={titleId}>{title}</h2>
        <button type="button" className={styles.close} onClick={onClose} aria-label="상세 패널 닫기">✕</button>
      </div>
      <div className={styles.body}>{children}</div>
      {footer && <div className={styles.footer}>{footer}</div>}
    </div>
  </>;
}

/**
 * Selection state for one list. Opening pushes a single history entry (no URL change, so the app router is left alone); picking another item
 * replaces it, so Back closes the panel instead of stepping through every item. Focus returns to the clicked row.
 */
export function useDetailSelection(kind: string) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const pushed = useRef(false);
  const selected = useRef<string | null>(null);
  selected.current = selectedId;

  const restoreFocus = useCallback(() => {
    const el = trigger.current;
    trigger.current = null;
    if (el && document.contains(el)) setTimeout(() => el.focus(), 0);
  }, []);

  const select = useCallback((id: string) => {
    try {
      if (selected.current === null) {
        trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        window.history.pushState({ ...(window.history.state ?? {}), detail: kind }, '');
        pushed.current = true;
      } else {
        window.history.replaceState({ ...(window.history.state ?? {}), detail: kind }, '');
      }
    } catch { /* history is a nicety; the panel works without it */ }
    setSelectedId(id);
  }, [kind]);

  const close = useCallback(() => {
    if (selected.current === null) return;
    setSelectedId(null);
    if (pushed.current) {
      pushed.current = false;
      try { window.history.back(); } catch { /* ignore */ }
    } else {
    }
    restoreFocus();
  }, [kind, restoreFocus]);

  useEffect(() => {
    const onPop = () => {
      if (selected.current !== null && window.history.state?.detail !== kind) {
        pushed.current = false;
        setSelectedId(null);
        restoreFocus();
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [kind, restoreFocus]);

  return { selectedId, select, close };
}

type Loaded<T> = { data: T | null; loading: boolean; error: string | null };

/** Fetches one item when it is selected. Results are cached per id so re-opening an item costs no request. */
export function useSelectedDetail<T>(id: string | null, fetcher: (id: string) => Promise<T>, failure: string) {
  const cache = useRef(new Map<string, T>());
  const [state, setState] = useState<Loaded<T>>({ data: null, loading: false, error: null });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (id === null) { setState({ data: null, loading: false, error: null }); return undefined; }
    const hit = cache.current.get(id);
    if (hit) { setState({ data: hit, loading: false, error: null }); return undefined; }
    let alive = true;
    setState({ data: null, loading: true, error: null });
    fetcher(id)
      .then((data) => { cache.current.set(id, data); if (alive) setState({ data, loading: false, error: null }); })
      .catch((e) => { if (alive) setState({ data: null, loading: false, error: agentErrorText(e, failure) }); });
    return () => { alive = false; };
  // fetcher is a stable module-level call; reruns are driven by the selected id and manual retry only
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, attempt]);
  return { ...state, retry: useCallback(() => setAttempt((n) => n + 1), []) };
}

