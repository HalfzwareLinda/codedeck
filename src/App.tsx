import { useEffect } from 'react';
import { useUIStore } from './stores/uiStore';
import { useSessionStore } from './stores/sessionStore';
import { useDmStore } from './stores/dmStore';
import { useMediaQuery } from './hooks/useMediaQuery';
import { parsePublicKey } from './services/nostrService';
import { initNotifications, setAppHidden } from './services/notificationService';
import { onOpenUrl, getCurrent } from '@tauri-apps/plugin-deep-link';
import * as nip19 from 'nostr-tools/nip19';
import type { RemoteMachine } from './types';
import Sidebar from './components/Sidebar';
import MainPanel from './components/MainPanel';
import SettingsModal from './components/SettingsModal';
import NewSessionModal from './components/NewSessionModal';
import ErrorBoundary from './components/ErrorBoundary';
import UndoToast from './components/UndoToast';
import './styles/global.css';

function handleDeepLink(url: string): void {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'codedeck:') return;

    const npub = parsed.searchParams.get('npub');
    const relaysParam = parsed.searchParams.get('relays');
    const machineName = parsed.searchParams.get('machine') || 'Remote';

    if (!npub) return;
    const pubkeyHex = parsePublicKey(npub);
    if (!pubkeyHex) return;

    const relays = relaysParam
      ? relaysParam.split(',').map(r => decodeURIComponent(r)).filter(r => r.startsWith('wss://') || r.startsWith('ws://'))
      : ['wss://relay.primal.net', 'wss://relay.nostr.band', 'wss://nos.lol'];

    const machine: RemoteMachine = {
      hostname: machineName,
      npub: npub.startsWith('npub1') ? npub : nip19.npubEncode(pubkeyHex),
      pubkeyHex,
      relays,
      connected: false,
    };

    useSessionStore.getState().addMachine(machine);
  } catch {
    // Malformed URL — ignore silently
  }
}

export default function App() {
  const isWide = useMediaQuery('(min-width: 700px)');
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);
  const settingsOpen = useUIStore((s) => s.settingsOpen);
  const newSessionOpen = useUIStore((s) => s.newSessionOpen);
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen);
  useEffect(() => {
    const sessionActions = useSessionStore.getState();
    sessionActions.loadSessions();
    sessionActions.loadConfig();
    sessionActions.initEventListeners();
    initNotifications();

    // Load persisted DMs first (includes Nostr private key), then init bridge
    useDmStore.getState().loadPersisted().then(() => {
      const dmState = useDmStore.getState();
      const nostrConfig = dmState.nostrConfig;
      if (nostrConfig.private_key_hex) {
        useSessionStore.getState().initBridgeService(nostrConfig.private_key_hex);
      }
      dmState.connect();
      dmState.resolveAllProfiles();

      // Handle deep links (codedeck://pair?npub=...&relays=...&machine=...)
      getCurrent().then(urls => {
        if (urls) urls.forEach(handleDeepLink);
      }).catch(() => {});
      onOpenUrl(urls => {
        urls.forEach(handleDeepLink);
      }).catch(() => {});
    });
  }, []);

  // Reconnect DM + bridge subscriptions when app returns to foreground
  useEffect(() => {
    const onVisibilityChange = () => {
      const dmState = useDmStore.getState();
      if (!dmState.nostrConfig.private_key_hex) return;

      setAppHidden(document.hidden);
      if (document.hidden) {
        dmState.disconnect();
      } else {
        dmState.connect();
        // Re-establish bridge subscriptions — Android kills WebSockets after ~30s background
        useSessionStore.getState().reconnectBridge();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  // Track keyboard visibility via Visual Viewport API (fallback for Android WebView)
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => {
      const offset = window.innerHeight - vv.height;
      document.documentElement.style.setProperty(
        '--keyboard-offset', `${Math.max(0, offset)}px`
      );
    };
    vv.addEventListener('resize', onResize);
    vv.addEventListener('scroll', onResize);
    onResize();
    return () => {
      vv.removeEventListener('resize', onResize);
      vv.removeEventListener('scroll', onResize);
    };
  }, []);

  return (
    <div style={{
      display: 'flex',
      height: '100%',
      width: '100%',
      overflow: 'hidden',
      background: 'var(--bg-black)',
    }}>
      {/* Sidebar - inline on wide, drawer on narrow */}
      <ErrorBoundary>
      {isWide ? (
        <Sidebar />
      ) : (
        <>
          {sidebarOpen && (
            <div
              style={{
                position: 'fixed',
                inset: 0,
                background: 'rgba(0,0,0,0.7)',
                zIndex: 99,
              }}
              onClick={() => setSidebarOpen(false)}
            />
          )}
          <div style={{
            position: 'fixed',
            left: sidebarOpen ? 0 : -280,
            top: 0,
            bottom: 0,
            width: 280,
            zIndex: 100,
            transition: 'left 0.2s ease',
          }}>
            <Sidebar />
          </div>
        </>
      )}
      </ErrorBoundary>

      <MainPanel isWide={isWide} />

      <UndoToast />

      <ErrorBoundary>
      {settingsOpen && <SettingsModal />}
      {newSessionOpen && <NewSessionModal />}
      </ErrorBoundary>
    </div>
  );
}
