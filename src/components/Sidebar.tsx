import { useUIStore } from '../stores/uiStore';
import { useSessionStore } from '../stores/sessionStore';
import { Session } from '../types';
import '../styles/sidebar.css';

function StatusDot({ state }: { state: Session['state'] }) {
  if (state === 'idle' || state === 'completed' || state === 'error') return null;

  const cls = state === 'waiting_permission' ? 'status-dot waiting' : 'status-dot running';
  return <div className={cls} />;
}

function stateClass(state: Session['state']): string {
  switch (state) {
    case 'waiting_permission': return 'waiting';
    case 'running': return 'running';
    case 'error': return 'error';
    default: return '';
  }
}

function SessionCard({ session, isSelected }: { session: Session; isSelected: boolean }) {
  const setActiveSession = useSessionStore((s) => s.setActiveSession);
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen);

  const classes = [
    'session-card',
    isSelected ? 'selected' : '',
    stateClass(session.state),
  ].filter(Boolean).join(' ');

  return (
    <div className={classes} onClick={() => { setActiveSession(session.id); setSidebarOpen(false); }}>
      <div className="session-card-info">
        <div className="session-card-name">{session.name}</div>
        <div className="session-card-path">{session.workspace_path} · {session.branch}</div>
      </div>
      <StatusDot state={session.state} />
    </div>
  );
}

export default function Sidebar() {
  const sessions = useSessionStore((s) => s.sessions);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const setNewSessionOpen = useUIStore((s) => s.setNewSessionOpen);

  // Group sessions
  const groups: Record<string, Session[]> = {};
  for (const session of sessions) {
    const group = session.group || 'DEFAULT';
    if (!groups[group]) groups[group] = [];
    groups[group].push(session);
  }

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <span className="sidebar-title">Sessions</span>
        <button className="sidebar-add-btn" onClick={() => setNewSessionOpen(true)}>+</button>
      </div>

      <div className="sidebar-list">
        {Object.entries(groups).map(([group, groupSessions]) => (
          <div key={group}>
            <div className="group-heading">{group}</div>
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
          <div className="sidebar-empty">
            No sessions yet.<br />Tap + to create one.
          </div>
        )}
      </div>
    </div>
  );
}
