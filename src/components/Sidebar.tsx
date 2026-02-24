import { useSessionStore } from '../stores/sessionStore';
import { Session } from '../types';

function StatusDot({ state }: { state: Session['state'] }) {
  if (state === 'idle' || state === 'completed' || state === 'error') return null;

  const isWaiting = state === 'waiting_permission';
  return (
    <div style={{
      width: 10,
      height: 10,
      borderRadius: '50%',
      background: isWaiting ? 'var(--status-waiting)' : 'var(--status-running)',
      animation: isWaiting ? 'pulse 1.5s ease-in-out infinite' : undefined,
      flexShrink: 0,
    }} />
  );
}

function accentColor(state: Session['state'], isSelected: boolean): string {
  if (isSelected) return '#FFFFFF';
  switch (state) {
    case 'waiting_permission': return '#FFFFFF';
    case 'running': return '#999999';
    case 'error': return '#666666';
    default: return '#333333';
  }
}

function SessionCard({ session, isSelected }: { session: Session; isSelected: boolean }) {
  const setActiveSession = useSessionStore((s) => s.setActiveSession);
  const setSidebarOpen = useSessionStore((s) => s.setSidebarOpen);

  return (
    <div
      onClick={() => {
        setActiveSession(session.id);
        setSidebarOpen(false);
      }}
      style={{
        display: 'flex',
        alignItems: 'center',
        height: 64,
        padding: '0 12px',
        cursor: 'pointer',
        background: isSelected ? 'var(--bg-selected)' : 'transparent',
        borderLeft: `3px solid ${accentColor(session.state, isSelected)}`,
        gap: 8,
        transition: 'background 0.15s',
      }}
      onMouseEnter={(e) => {
        if (!isSelected) e.currentTarget.style.background = 'var(--bg-hover)';
      }}
      onMouseLeave={(e) => {
        if (!isSelected) e.currentTarget.style.background = 'transparent';
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 15,
          fontWeight: 700,
          color: 'var(--text-primary)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}>
          {session.name}
        </div>
        <div style={{
          fontSize: 12,
          color: 'var(--text-secondary)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}>
          {session.workspace_path} · {session.branch}
        </div>
      </div>
      <StatusDot state={session.state} />
    </div>
  );
}

export default function Sidebar() {
  const sessions = useSessionStore((s) => s.sessions);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const setNewSessionOpen = useSessionStore((s) => s.setNewSessionOpen);

  // Group sessions
  const groups: Record<string, Session[]> = {};
  for (const session of sessions) {
    const group = session.group || 'DEFAULT';
    if (!groups[group]) groups[group] = [];
    groups[group].push(session);
  }

  return (
    <div style={{
      width: 260,
      height: '100%',
      background: 'var(--bg-black)',
      borderRight: '1px solid var(--border-subtle)',
      display: 'flex',
      flexDirection: 'column',
      flexShrink: 0,
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '16px 16px 12px',
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>
          Sessions
        </span>
        <button
          onClick={() => setNewSessionOpen(true)}
          style={{
            width: 48,
            height: 48,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 24,
            color: 'var(--text-primary)',
            cursor: 'pointer',
            borderRadius: 4,
          }}
          onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
          onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
        >
          +
        </button>
      </div>

      {/* Session list */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {Object.entries(groups).map(([group, groupSessions]) => (
          <div key={group}>
            <div style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
              color: 'var(--text-muted)',
              padding: '16px 16px 8px',
            }}>
              {group}
            </div>
            {groupSessions.map((session) => (
              <SessionCard
                key={session.id}
                session={session}
                isSelected={session.id === activeSessionId}
              />
            ))}
          </div>
        ))}
        {sessions.length === 0 && (
          <div style={{
            padding: '32px 16px',
            color: 'var(--text-muted)',
            fontSize: 13,
            textAlign: 'center',
          }}>
            No sessions yet.<br />Tap + to create one.
          </div>
        )}
      </div>
    </div>
  );
}
