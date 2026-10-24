import { afterEach, describe, expect, it, vi } from 'vitest';
import { P0ApiError, p0Fetch } from './p0-server';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('p0Fetch service authentication', () => {
  it('requires Access credentials before contacting an external HTTPS upstream', async () => {
    vi.stubEnv('P0_API_URL', 'https://p0.example.test');
    vi.stubEnv('P0_ACCESS_CLIENT_ID', '');
    vi.stubEnv('P0_ACCESS_CLIENT_SECRET', '');
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);

    await expect(p0Fetch('/api/config')).rejects.toMatchObject({ status: 503 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('adds server-side Access credentials and rejects redirects for an external upstream', async () => {
    vi.stubEnv('P0_API_URL', 'https://p0.example.test');
    vi.stubEnv('P0_ACCESS_CLIENT_ID', 'test-access-client-id');
    vi.stubEnv('P0_ACCESS_CLIENT_SECRET', 'test-access-client-secret');
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await p0Fetch('/api/config', {
      headers: {
        'CF-Access-Client-Id': 'caller-supplied-id',
        'CF-Access-Client-Secret': 'caller-supplied-secret',
      },
    });

    const [url, init] = fetchMock.mock.calls[0];
    const headers = new Headers(init?.headers);
    expect(String(url)).toBe('https://p0.example.test/api/config');
    expect(headers.get('CF-Access-Client-Id')).toBe('test-access-client-id');
    expect(headers.get('CF-Access-Client-Secret')).toBe('test-access-client-secret');
    expect(init?.redirect).toBe('error');
    expect(init?.cache).toBe('no-store');
  });

  it('never forwards Access credentials to the local loopback P0 server', async () => {
    vi.stubEnv('P0_API_URL', 'http://127.0.0.1:8787');
    vi.stubEnv('P0_ACCESS_CLIENT_ID', 'test-access-client-id');
    vi.stubEnv('P0_ACCESS_CLIENT_SECRET', 'test-access-client-secret');
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await p0Fetch('/api/config', {
      headers: {
        'CF-Access-Client-Id': 'caller-supplied-id',
        'CF-Access-Client-Secret': 'caller-supplied-secret',
      },
    });

    const [, init] = fetchMock.mock.calls[0];
    const headers = new Headers(init?.headers);
    expect(headers.has('CF-Access-Client-Id')).toBe(false);
    expect(headers.has('CF-Access-Client-Secret')).toBe(false);
  });

  it('rejects incomplete credentials and non-loopback HTTP before contacting the upstream', async () => {
    vi.stubEnv('P0_API_URL', 'https://p0.example.test');
    vi.stubEnv('P0_ACCESS_CLIENT_ID', 'test-access-client-id');
    vi.stubEnv('P0_ACCESS_CLIENT_SECRET', '');
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);

    await expect(p0Fetch('/api/config')).rejects.toBeInstanceOf(P0ApiError);
    expect(fetchMock).not.toHaveBeenCalled();

    vi.stubEnv('P0_API_URL', 'http://p0.example.test');
    vi.stubEnv('P0_ACCESS_CLIENT_SECRET', 'test-access-client-secret');
    await expect(p0Fetch('/api/config')).rejects.toMatchObject({ status: 503 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
