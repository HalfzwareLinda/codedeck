import { useEffect } from 'react';
import { useUIStore } from './stores/uiStore';
import { useSessionStore } from './stores/sessionStore';
import { useDmStore } from './stores/dmStore';
import { useMediaQuery } from './hooks/useMediaQuery';
import Sidebar from './components/Sidebar';
import MainPanel from './components/MainPanel';
import SettingsModal from './components/SettingsModal';
import NewSessionModal from './components/NewSessionModal';
import './styles/global.css';

export default function App() {
  const isWide = useMediaQuery('(min-width: 700px)');
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);
  const settingsOpen = useUIStore((s) => s.settingsOpen);
  const newSessionOpen = useUIStore((s) => s.newSessionOpen);
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen);
  const initEventListeners = useSessionStore((s) => s.initEventListeners);
  const loadSessions = useSessionStore((s) => s.loadSessions);
  const loadConfig = useSessionStore((s) => s.loadConfig);
  const initBridgeService = useSessionStore((s) => s.initBridgeService);
  const loadPersistedDms = useDmStore((s) => s.loadPersisted);
  const connectDms = useDmStore((s) => s.connect);

  useEffect(() => {
    loadSessions();
    loadConfig();
    initEventListeners();

    // Load persisted DMs first (includes Nostr private key), then init bridge
    loadPersistedDms().then(() => {
      const nostrConfig = useDmStore.getState().nostrConfig;
      if (nostrConfig.private_key_hex) {
        initBridgeService(nostrConfig.private_key_hex);
      }
      connectDms();
    });
  }, [loadSessions, loadConfig, initEventListeners, loadPersistedDms, connectDms, initBridgeService]);

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

      <MainPanel isWide={isWide} />

      {settingsOpen && <SettingsModal />}
      {newSessionOpen && <NewSessionModal />}
    </div>
  );
}
