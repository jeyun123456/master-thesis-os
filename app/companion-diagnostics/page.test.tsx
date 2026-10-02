import * as React from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

const healthUrl = 'http://127.0.0.1:38471/health';

function installFailClosedFetch(response: () => Promise<Response>) {
  const requests: string[] = [];
  const violations: string[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    requests.push(url);
    if (url !== healthUrl || (init?.method && init.method !== 'GET')) {
      violations.push(url);
      throw new Error(`Unexpected diagnostics request: ${url}`);
    }
    return response();
  });
  return { requests, violations };
}

async function mountPageWithHookHarness() {
  let state: unknown;
  let effectStarted = false;
  let resolveStateUpdate!: () => void;
  const stateUpdated = new Promise<void>((resolve) => { resolveStateUpdate = resolve; });

  vi.doMock('react', () => ({
    useState(initial: unknown) {
      if (state === undefined) state = initial;
      return [state, (next: unknown) => { state = next; resolveStateUpdate(); }];
    },
    useEffect(effect: () => unknown) {
      if (!effectStarted) {
        effectStarted = true;
        effect();
      }
    },
  }));

  const { default: Page } = await import('./page');
  const initialMarkup = renderToStaticMarkup(Page());
  return {
    initialMarkup,
    stateUpdated,
    renderUpdated: () => renderToStaticMarkup(Page()),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.doUnmock('react');
  vi.resetModules();
});

describe('Companion diagnostics route', () => {
  it('renders the shell as Loaded while Bridge status starts at Checking', async () => {
    vi.stubEnv('NEXT_PUBLIC_LOCAL_BRIDGE_URL', 'http://127.0.0.1:38471');
    installFailClosedFetch(async () => new Response(JSON.stringify({ ok: true, apiVersion: 7 }), { status: 200 }));

    const page = await mountPageWithHookHarness();

    expect(page.initialMarkup).toContain('Companion Diagnostics');
    expect(page.initialMarkup).toContain('Loaded');
    expect(page.initialMarkup).toContain('Checking');
    await page.stateUpdated;
  });

  it('shows Connected and API v7 after the single allowed health request', async () => {
    vi.stubEnv('NEXT_PUBLIC_LOCAL_BRIDGE_URL', 'http://127.0.0.1:38471');
    const guard = installFailClosedFetch(async () => new Response(JSON.stringify({ ok: true, apiVersion: 7 }), { status: 200 }));

    const page = await mountPageWithHookHarness();
    await page.stateUpdated;
    const markup = page.renderUpdated();

    expect(markup).toContain('Web UI');
    expect(markup).toContain('Connected');
    expect(markup).toContain('API v7');
    expect(guard.requests).toEqual([healthUrl]);
    expect(guard.violations).toEqual([]);
  });

  it('shows Unavailable when the local health request fails', async () => {
    vi.stubEnv('NEXT_PUBLIC_LOCAL_BRIDGE_URL', 'http://127.0.0.1:38471');
    const guard = installFailClosedFetch(async () => { throw new TypeError('local Bridge unavailable'); });

    const page = await mountPageWithHookHarness();
    await page.stateUpdated;
    const markup = page.renderUpdated();

    expect(markup).toContain('Web UI');
    expect(markup).toContain('Loaded');
    expect(markup).toContain('Unavailable');
    expect(guard.requests).toEqual([healthUrl]);
    expect(guard.violations).toEqual([]);
  });

  it('shows an API mismatch and version when Bridge is older than required', async () => {
    vi.stubEnv('NEXT_PUBLIC_LOCAL_BRIDGE_URL', 'http://127.0.0.1:38471');
    const guard = installFailClosedFetch(async () => new Response(JSON.stringify({ ok: true, apiVersion: 6 }), { status: 200 }));

    const page = await mountPageWithHookHarness();
    await page.stateUpdated;
    const markup = page.renderUpdated();

    expect(markup).toContain('Version mismatch');
    expect(markup).toContain('API v6');
    expect(markup).toContain('required v7+');
    expect(guard.requests).toEqual([healthUrl]);
    expect(guard.violations).toEqual([]);
  });

  it('does not call a configured non-loopback Bridge URL', async () => {
    vi.stubEnv('NEXT_PUBLIC_LOCAL_BRIDGE_URL', 'https://bridge.example/api');
    const guard = installFailClosedFetch(async () => new Response(JSON.stringify({ ok: true, apiVersion: 7 }), { status: 200 }));

    const page = await mountPageWithHookHarness();
    await page.stateUpdated;

    expect(page.renderUpdated()).toContain('Unavailable');
    expect(guard.requests).toEqual([]);
    expect(guard.violations).toEqual([]);
  });

  it('fails closed if any request other than local Bridge health is attempted', async () => {
    vi.stubEnv('NEXT_PUBLIC_LOCAL_BRIDGE_URL', 'http://127.0.0.1:38471');
    const guard = installFailClosedFetch(async () => new Response(JSON.stringify({ ok: true, apiVersion: 7 }), { status: 200 }));
    const page = await mountPageWithHookHarness();
    await page.stateUpdated;

    await expect(fetch('/api/calendar/events')).rejects.toThrow('Unexpected diagnostics request');
    expect(guard.violations).toEqual(['/api/calendar/events']);
    expect(guard.requests).toEqual([healthUrl, '/api/calendar/events']);
  });

  it('has no direct fetch or product data client in the route module', () => {
    const sourcePath = fileURLToPath(new URL('./page.tsx', import.meta.url));
    const source = readFileSync(sourcePath, 'utf8');

    expect(source).toContain('checkLocalBridgeApiVersion');
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/dashboardApi|calendarApi|mailApi|portalApi|inboxApi|plannerApi|researchApi|resultsApi/i);
  });
});
