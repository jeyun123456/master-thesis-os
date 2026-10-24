'use client';

import Script from 'next/script';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { getP0Session, loginToP0, logoutFromP0, P0_SESSION_INVALID_EVENT } from '@/lib/p0-tasks-client';

type AuthStatus = 'loading' | 'unconfigured' | 'unauthenticated' | 'authenticated' | 'error';
type P0AuthContextValue = {
  authenticated: boolean;
  authBusy: boolean;
  logout: () => Promise<boolean>;
};

declare global {
  interface Window {
    google?: {
      accounts?: {
        id?: {
          initialize: (options: { client_id: string; callback: (response: { credential?: string }) => void }) => void;
          renderButton: (parent: HTMLElement, options: Record<string, string>) => void;
        };
      };
    };
  }
}

const P0AuthContext = createContext<P0AuthContextValue | null>(null);

export function useP0Auth() {
  const context = useContext(P0AuthContext);
  if (!context) throw new Error('useP0Auth must be used inside P0AuthGate');
  return context;
}

export function P0AuthGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [clientId, setClientId] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [error, setError] = useState('');
  const [gisReady, setGisReady] = useState(false);
  const googleButton = useRef<HTMLDivElement>(null);
  const initializedClientId = useRef<string | null>(null);
  const refreshGeneration = useRef(0);

  const refresh = useCallback(async () => {
    const generation = ++refreshGeneration.current;
    setStatus('loading');
    setError('');
    try {
      const session = await getP0Session();
      if (generation !== refreshGeneration.current) return;
      setClientId(session.googleClientId);
      setStatus(!session.configured ? 'unconfigured' : session.authenticated ? 'authenticated' : 'unauthenticated');
    } catch (reason) {
      if (generation !== refreshGeneration.current) return;
      setStatus('error');
      setError(reason instanceof Error ? reason.message : 'P0 연결을 확인하지 못했어.');
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    const onSessionInvalid = () => { void refresh(); };
    window.addEventListener(P0_SESSION_INVALID_EVENT, onSessionInvalid);
    return () => window.removeEventListener(P0_SESSION_INVALID_EVENT, onSessionInvalid);
  }, [refresh]);

  const handleCredential = useCallback(async (credential: string) => {
    setAuthBusy(true);
    setError('');
    try {
      await loginToP0(credential);
      initializedClientId.current = null;
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Google 로그인에 실패했어. 허용된 계정인지 확인해줘.');
    } finally {
      setAuthBusy(false);
    }
  }, [refresh]);

  const initializeGoogle = useCallback(() => {
    const googleId = window.google?.accounts?.id;
    const button = googleButton.current;
    if (!clientId || !googleId || !button || initializedClientId.current === clientId) return;
    initializedClientId.current = clientId;
    googleId.initialize({
      client_id: clientId,
      callback: (response) => {
        if (!response.credential) {
          setError('Google 로그인 응답을 받지 못했어. 다시 시도해줘.');
          return;
        }
        void handleCredential(response.credential);
      },
    });
    googleId.renderButton(button, { theme: 'outline', size: 'large', text: 'signin_with', shape: 'rectangular' });
  }, [clientId, handleCredential]);

  useEffect(() => {
    if (status === 'unauthenticated' && gisReady) initializeGoogle();
  }, [gisReady, initializeGoogle, status]);

  const logout = useCallback(async () => {
    setAuthBusy(true);
    setError('');
    try {
      const result = await logoutFromP0();
      initializedClientId.current = null;
      setStatus('unauthenticated');
      if (!result.serverRevoked) setError('브라우저 세션은 지웠지만 P0 서버에서 세션 해지를 확인하지 못했어. 서버가 복구되면 기기 세션 목록도 확인해줘.');
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'P0 로그아웃에 실패했어.');
      return false;
    } finally {
      setAuthBusy(false);
    }
  }, []);

  const value = useMemo(() => ({ authenticated: status === 'authenticated', authBusy, logout }), [authBusy, logout, status]);

  return <P0AuthContext.Provider value={value}>
    {clientId && <Script src="https://accounts.google.com/gsi/client" strategy="afterInteractive" onReady={() => setGisReady(true)} />}
    {status === 'authenticated' ? children : <main className="p0-auth-screen">
      <section className="card section p0-auth-card" aria-labelledby="p0-auth-title" aria-live="polite">
        <p className="p0-auth-brand">CHOCOMINT LAB</p>
        <h1 id="p0-auth-title">{status === 'loading' ? '로그인 확인 중' : '연구 작업실 로그인'}</h1>
        {status === 'loading' && <p className="note">P0 서버에서 로그인 상태를 확인하고 있어.</p>}
        {status === 'unconfigured' && <>
          <p className="error" role="alert">P0 Google 로그인이 설정되지 않았어. Windows P0 서버의 Google OAuth 설정을 확인해줘.</p>
          <button className="btn" type="button" onClick={() => void refresh()}>다시 확인</button>
        </>}
        {status === 'error' && <>
          <p className="error" role="alert">P0 서버에 연결할 수 없어. Windows 서버와 Cloudflare Access 연결을 확인해줘. 로그인 없이 보호된 화면을 열지는 않을게.</p>
          {error && <p className="note">{error}</p>}
          <button className="btn" type="button" onClick={() => void refresh()}>다시 연결</button>
        </>}
        {status === 'unauthenticated' && <>
          <p className="note">허용된 Google 계정 하나로 로그인하면 홈·연구·자료·Planner를 사용할 수 있어.</p>
          <div className="p0-auth-google" ref={googleButton} />
          {authBusy && <p className="note" role="status">로그인 중…</p>}
          {error && <p className="error" role="alert">{error}</p>}
          <button className="btn" type="button" disabled={authBusy} onClick={() => void refresh()}>세션 다시 확인</button>
        </>}
      </section>
    </main>}
  </P0AuthContext.Provider>;
}
