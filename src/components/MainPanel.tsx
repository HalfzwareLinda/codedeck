import { useSessionStore } from '../stores/sessionStore';
import { useDmStore } from '../stores/dmStore';
import { useUIStore } from '../stores/uiStore';
import SessionHeader from './SessionHeader';
import OutputStream from './OutputStream';
import PermissionBar from './PermissionBar';
import InputBar from './InputBar';
import DmConversationView from './DmConversationView';
import ErrorBoundary from './ErrorBoundary';

export default function MainPanel({ isWide }: { isWide: boolean }) {
  const panelMode = useUIStore((s) => s.panelMode);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const sessions = useSessionStore((s) => s.sessions);
  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const activeConversationId = useDmStore((s) => s.activeConversationId);

  return (
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      minWidth: 0,
      background: 'var(--bg-black)',
    }}>
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
          <InputBar session={activeSession} />
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
