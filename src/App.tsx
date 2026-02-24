import { useEffect } from 'react';
import { useSessionStore } from './stores/sessionStore';
import { useMediaQuery } from './hooks/useMediaQuery';
import Sidebar from './components/Sidebar';
import MainPanel from './components/MainPanel';
import SettingsModal from './components/SettingsModal';
import NewSessionModal from './components/NewSessionModal';
import './styles/global.css';

export default function App() {
  const isWide = useMediaQuery('(min-width: 700px)');
  const sidebarOpen = useSessionStore((s) => s.sidebarOpen);
  const settingsOpen = useSessionStore((s) => s.settingsOpen);
  const newSessionOpen = useSessionStore((s) => s.newSessionOpen);
  const setSidebarOpen = useSessionStore((s) => s.setSidebarOpen);
  const initEventListeners = useSessionStore((s) => s.initEventListeners);
  const loadSessions = useSessionStore((s) => s.loadSessions);
  const loadConfig = useSessionStore((s) => s.loadConfig);

  useEffect(() => {
    loadSessions();
    loadConfig();
    initEventListeners();
  }, [loadSessions, loadConfig, initEventListeners]);

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
