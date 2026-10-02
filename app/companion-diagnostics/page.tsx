'use client';

import { useEffect, useState } from 'react';
import {
  checkLocalBridgeApiVersion,
  SUPPORTED_LOCAL_BRIDGE_API_VERSION,
  type BridgeApiVersionCheck,
} from '../../lib/bridge-status';

type DiagnosticBridgeStatus =
  | { state: 'checking' }
  | { state: 'connected'; apiVersion: number }
  | { state: 'unavailable' }
  | { state: 'mismatch'; apiVersion: number };

function isLocalBridgeConfigured(): boolean {
  const base = process.env.NEXT_PUBLIC_LOCAL_BRIDGE_URL || 'http://127.0.0.1:38471';
  try {
    const url = new URL(base);
    return url.protocol === 'http:' &&
      (url.hostname === '127.0.0.1' || url.hostname === 'localhost') &&
      Boolean(url.port) &&
      (url.pathname === '' || url.pathname === '/') &&
      !url.search && !url.hash && !url.username && !url.password;
  } catch {
    return false;
  }
}

async function readDiagnosticBridgeStatus(
  check: typeof checkLocalBridgeApiVersion = checkLocalBridgeApiVersion,
): Promise<DiagnosticBridgeStatus> {
  if (!isLocalBridgeConfigured()) return { state: 'unavailable' };
  const result: BridgeApiVersionCheck = await check();
  if (result.state === 'compatible') return { state: 'connected', apiVersion: result.apiVersion };
  if (result.state === 'outdated') return { state: 'mismatch', apiVersion: result.apiVersion };
  return { state: 'unavailable' };
}

function CompanionDiagnosticsView({ status }: { status: DiagnosticBridgeStatus }) {
  return (
    <main className="main">
      <header className="top">
        <div>
          <h2>Companion Diagnostics</h2>
          <p>Local shell and Bridge health check</p>
        </div>
      </header>

      <div className="grid2">
        <section className="card section" aria-labelledby="diagnostics-web-title">
          <div className="head">
            <h3 id="diagnostics-web-title">Web UI</h3>
            <span role="status">Loaded</span>
          </div>
          <p>Companion WebView rendered this local diagnostic page.</p>
        </section>

        <section className="card section" aria-labelledby="diagnostics-bridge-title">
          <div className="head">
            <h3 id="diagnostics-bridge-title">Local Bridge</h3>
            <span role="status">
              {status.state === 'checking' && 'Checking'}
              {status.state === 'connected' && 'Connected'}
              {status.state === 'unavailable' && 'Unavailable'}
              {status.state === 'mismatch' && 'Version mismatch'}
            </span>
          </div>
          {status.state === 'connected' && <p>API v{status.apiVersion} · required v{SUPPORTED_LOCAL_BRIDGE_API_VERSION}+</p>}
          {status.state === 'mismatch' && <p>API v{status.apiVersion} · required v{SUPPORTED_LOCAL_BRIDGE_API_VERSION}+</p>}
          {status.state === 'unavailable' && <p>Local Bridge health endpoint did not return a supported version.</p>}
          {status.state === 'checking' && <p>Checking the local health endpoint…</p>}
        </section>
      </div>
    </main>
  );
}

export default function CompanionDiagnosticsPage() {
  const [status, setStatus] = useState<DiagnosticBridgeStatus>({ state: 'checking' });

  useEffect(() => {
    let active = true;
    void readDiagnosticBridgeStatus().then((result) => {
      if (active) setStatus(result);
    }).catch(() => {
      if (active) setStatus({ state: 'unavailable' });
    });
    return () => { active = false; };
  }, []);

  return <CompanionDiagnosticsView status={status} />;
}
