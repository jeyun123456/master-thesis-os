'use client';

import { useEffect } from 'react';

type ResolutionMessage = {
  channel?: string;
  action?: string;
  preset?: string;
  density?: string;
  width?: number;
  height?: number;
  isAuto?: boolean;
  zoomFactor?: number;
};

function mapPresetToDensity(preset?: string): string {
  if (!preset) return 'comfortable';
  const cleaned = preset.trim().toLowerCase().replace(/[\s×]/g, 'x');
  switch (cleaned) {
    case '1280x720':
    case '1280x800':
      return 'relaxed';
    case '2560x1440':
      return 'compact';
    case '3200x1800':
      return 'dense';
    case '3840x2160':
      return 'ultra-dense';
    default:
      return 'comfortable';
  }
}

export function ResolutionSync() {
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const root = document.documentElement;

    // Ensure initial density attribute exists
    if (!root.getAttribute('data-density')) {
      const existingPreset = root.style.getPropertyValue('--app-resolution-preset');
      const initialDensity = root.style.getPropertyValue('--app-density') || mapPresetToDensity(existingPreset);
      root.setAttribute('data-density', initialDensity);
      root.style.setProperty('--app-density', initialDensity);
    }

    const applyPayload = (payload: ResolutionMessage) => {
      if (!payload || typeof payload !== 'object') return;
      if (payload.channel !== 'master-thesis-os.resolution.v1' || payload.action !== 'resolutionChanged') return;

      const density = payload.density || mapPresetToDensity(payload.preset);
      root.setAttribute('data-density', density);
      root.style.setProperty('--app-density', density);

      if (payload.width && payload.height) {
        root.style.setProperty('--app-logical-width', `${payload.width}px`);
        root.style.setProperty('--app-logical-height', `${payload.height}px`);
      }
      if (payload.preset) {
        root.style.setProperty('--app-resolution-preset', payload.preset);
      }
      if (payload.isAuto !== undefined) {
        root.style.setProperty('--app-resolution-is-auto', String(payload.isAuto));
      }
      if (payload.zoomFactor !== undefined) {
        root.style.setProperty('--app-zoom-factor', String(payload.zoomFactor));
      }

      window.dispatchEvent(new Event('resize'));
    };

    const handleWebMessage = (event: { data: unknown }) => {
      try {
        const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        applyPayload(data as ResolutionMessage);
      } catch {
        // ignore parse errors
      }
    };

    const handleCustomEvent = (event: Event) => {
      const customEvent = event as CustomEvent;
      if (customEvent.detail) {
        applyPayload({
          channel: 'master-thesis-os.resolution.v1',
          action: 'resolutionChanged',
          ...customEvent.detail,
        });
      }
    };

    const webview = (window as unknown as { chrome?: { webview?: { addEventListener: (name: string, fn: (ev: { data: unknown }) => void) => void; removeEventListener: (name: string, fn: (ev: { data: unknown }) => void) => void } } }).chrome?.webview;

    if (webview?.addEventListener) {
      webview.addEventListener('message', handleWebMessage);
    }
    window.addEventListener('app:resolution-changed', handleCustomEvent);

    return () => {
      if (webview?.removeEventListener) {
        webview.removeEventListener('message', handleWebMessage);
      }
      window.removeEventListener('app:resolution-changed', handleCustomEvent);
    };
  }, []);

  return null;
}
