import { useCallback, useMemo } from 'react';
import { useSessionStore } from '../stores/sessionStore';
import { useDmStore } from '../stores/dmStore';
import { useUIStore } from '../stores/uiStore';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { useSwipeToNavigate } from '../hooks/useSwipeToNavigate';
import { useOrderedSessionIds } from '../hooks/useOrderedSessionIds';
import { useVoiceMode } from '../hooks/useVoiceMode';
import { cycleIndex } from '../utils/cycleIndex';
import { RemoteSessionInfo } from '../types';
import SessionHeader from './SessionHeader';
import OutputStream from './OutputStream';
import PermissionBar from './PermissionBar';
import InputBar from './InputBar';
import DmConversationView from './DmConversationView';
import ErrorBoundary from './ErrorBoundary';

/** Isolated component so useVoiceMode can sit inside an ErrorBoundary.
 *  If voice mode crashes, the rest of MainPanel keeps working. */
function VoiceModeRunner() {
  useVoiceMode();
  return null;
}

export default function MainPanel({ isWide }: { isWide: boolean }) {
  const panelMode = useUIStore((s) => s.panelMode);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const sessions = useSessionStore((s) => s.sessions);
  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const activeConversationId = useDmStore((s) => s.activeConversationId);
  const conversations = useDmStore((s) => s.conversations);
  const setActiveConversation = useDmStore((s) => s.setActiveConversation);
  const remoteSessions = useSessionStore((s) => s.remoteSessions);
  const remoteSessionModes = useSessionStore((s) => s.remoteSessionModes);
  const remoteSessionEffort = useSessionStore((s) => s.remoteSessionEffort);
  const defaultMode = useSessionStore((s) => s.config.default_mode);
  const setActiveSession = useSessionStore((s) => s.setActiveSession);
  const requestSessionHistory = useSessionStore((s) => s.requestSessionHistory);
  const setPanelMode = useUIStore((s) => s.setPanelMode);
  const isTouchDevice = useMediaQuery('(pointer: coarse)');

  const orderedIds = useOrderedSessionIds();

  const navigateSession = useCallback((direction: 'next' | 'prev') => {
    if (orderedIds.length <= 1 || !activeSessionId) return;
    const currentIndex = orderedIds.indexOf(activeSessionId);
    if (currentIndex === -1) return;

    const newIndex = direction === 'next' ? currentIndex + 1 : currentIndex - 1;
    if (newIndex < 0 || newIndex >= orderedIds.length) return;
    const newSessionId = orderedIds[newIndex];
    setActiveSession(newSessionId);
    setPanelMode('session');

    // Only request history for remote sessions without output
    const state = useSessionStore.getState();
    const isLocal = state.sessions.some(s => s.id === newSessionId);
    if (!isLocal && (state.outputs[newSessionId]?.length ?? 0) === 0) {
      requestSessionHistory(newSessionId);
    }
  }, [orderedIds, activeSessionId, setActiveSession, setPanelMode, requestSessionHistory]);

  // Ordered conversation IDs — sorted by most recent message (same order as sidebar)
  const orderedConvIds = useMemo(
    () => [...conversations]
      .sort((a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime())
      .map(c => c.id),
    [conversations],
  );

  const navigateConversation = useCallback((direction: 'next' | 'prev') => {
    if (orderedConvIds.length <= 1 || !activeConversationId) return;
    const currentIndex = orderedConvIds.indexOf(activeConversationId);
    if (currentIndex === -1) return;

    setActiveConversation(orderedConvIds[cycleIndex(currentIndex, orderedConvIds.length, direction === 'next' ? 1 : -1)]);
  }, [orderedConvIds, activeConversationId, setActiveConversation]);

  const { containerRef, touchHandlers } = useSwipeToNavigate({
    onSwipeLeft: () => panelMode === 'dm' ? navigateConversation('next') : navigateSession('next'),
    onSwipeRight: () => panelMode === 'dm' ? navigateConversation('prev') : navigateSession('prev'),
    enabled: isTouchDevice && (panelMode === 'session' || panelMode === 'dm'),
  });

  // Find remote session info if not a local session
  let remoteSession: RemoteSessionInfo | undefined;
  if (activeSessionId && !activeSession) {
    for (const sessions of Object.values(remoteSessions)) {
      remoteSession = sessions?.find(s => s.id === activeSessionId);
      if (remoteSession) break;
    }
  }

  // Tracked mode for remote session, defaulting to config's default_mode
  const remoteMode = remoteSession
    ? (remoteSessionModes[remoteSession.id] ?? defaultMode)
    : undefined;
  const remoteEffort = remoteSession
    ? (remoteSessionEffort[remoteSession.id] ?? 'auto')
    : undefined;

  return (
    <div
      ref={containerRef}
      {...touchHandlers}
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        height: 'var(--app-height, 100%)',
        minWidth: 0,
        background: 'var(--bg-black)',
      }}
    >
      <ErrorBoundary><VoiceModeRunner /></ErrorBoundary>
      <ErrorBoundary>
      {panelMode === 'dm' && activeConversationId ? (
        <DmConversationView conversationId={activeConversationId} isWide={isWide} />
      ) : panelMode === 'session' && activeSession ? (
        <>
          <SessionHeader session={activeSession} isWide={isWide} />
          <OutputStream sessionId={activeSession.id} />
          {activeSession.state === 'waiting_permission' && activeSession.pending_permissions.length > 0 && (
            <PermissionBar session={activeSession} />
          )}
          <InputBar sessionId={activeSession.id} mode={activeSession.mode} effort={undefined} />
        </>
      ) : panelMode === 'session' && remoteSession ? (
        <>
          <SessionHeader remoteSession={remoteSession} isWide={isWide} />
          <OutputStream sessionId={remoteSession.id} />
          <InputBar sessionId={remoteSession.id} mode={remoteMode} effort={remoteEffort} />
        </>
      ) : (
        <>
          <SessionHeader isWide={isWide} />
          <div style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text-muted)',
            fontSize: 15,
          }}>
            Select or create a session to get started
          </div>
        </>
      )}
      </ErrorBoundary>
    </div>
  );
}
