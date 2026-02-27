import { useState } from 'react';
import { useUIStore } from '../stores/uiStore';
import { useSessionStore } from '../stores/sessionStore';
import { useDmStore } from '../stores/dmStore';
import { parsePublicKey } from '../services/nostrService';
import { Session } from '../types';
import DmTile from './DmTile';
import '../styles/sidebar.css';
import '../styles/dm.css';

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
  const setPanelMode = useUIStore((s) => s.setPanelMode);

  const classes = [
    'session-card',
    isSelected ? 'selected' : '',
    stateClass(session.state),
  ].filter(Boolean).join(' ');

  return (
    <div className={classes} onClick={() => { setActiveSession(session.id); setPanelMode('session'); setSidebarOpen(false); }}>
      <div className="session-card-info">
        <div className="session-card-name">{session.name}</div>
        <div className="session-card-path">{session.workspace_path} · {session.branch}</div>
      </div>
      <StatusDot state={session.state} />
    </div>
  );
}

function NewDmInput({ onClose }: { onClose: () => void }) {
  const [pubkey, setPubkey] = useState('');
  const [error, setError] = useState('');
  const startConversation = useDmStore((s) => s.startConversation);
  const setPanelMode = useUIStore((s) => s.setPanelMode);

  const handleSubmit = () => {
    const trimmed = pubkey.trim();
    if (!trimmed) return;

    const parsedHex = parsePublicKey(trimmed);
    if (!parsedHex) {
      setError('Invalid public key (npub or hex)');
      return;
    }

    startConversation(parsedHex);
    setPanelMode('dm');
    setPubkey('');
    setError('');
    onClose();
  };

  return (
    <div className="new-dm-input">
      <input
        autoFocus
        className="new-dm-field"
        value={pubkey}
        onChange={(e) => { setPubkey(e.target.value); setError(''); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleSubmit();
          if (e.key === 'Escape') onClose();
        }}
        placeholder="npub or hex pubkey"
      />
      {error && <div style={{ color: '#ef4444', fontSize: 11, padding: '2px 8px' }}>{error}</div>}
    </div>
  );
}

export default function Sidebar() {
  const sessions = useSessionStore((s) => s.sessions);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const setNewSessionOpen = useUIStore((s) => s.setNewSessionOpen);
  const panelMode = useUIStore((s) => s.panelMode);
  const conversations = useDmStore((s) => s.conversations);
  const activeConversationId = useDmStore((s) => s.activeConversationId);
  const connectionStatus = useDmStore((s) => s.connectionStatus);
  const [showNewDm, setShowNewDm] = useState(false);

  // Group sessions
  const groups: Record<string, Session[]> = {};
  for (const session of sessions) {
    const group = session.group || 'DEFAULT';
    if (!groups[group]) groups[group] = [];
    groups[group].push(session);
  }

  const sortedConversations = [...conversations].sort(
    (a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime(),
  );

  return (
    <div className="sidebar">
      {/* Sessions header */}
      <div className="sidebar-header">
        <span className="sidebar-title">Sessions</span>
        <button className="sidebar-add-btn" onClick={() => setNewSessionOpen(true)}>+</button>
      </div>

      {/* Sessions list — fills remaining space above DMs */}
      <div className="sidebar-list">
        {Object.entries(groups).map(([group, groupSessions]) => (
          <div key={group}>
            <div className="group-heading">{group}</div>
            {groupSessions.map((session) => (
              <SessionCard
                key={session.id}
                session={session}
                isSelected={panelMode === 'session' && session.id === activeSessionId}
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

      {/* DMs section — pinned to bottom, 2-tile height */}
      <div className="dm-section">
        <div className="dm-section-header">
          <span className="dm-section-title">
            DMs
            <span className={`dm-connection-dot ${connectionStatus}`} />
          </span>
          <button className="sidebar-add-btn dm-add-btn" onClick={() => setShowNewDm(!showNewDm)}>+</button>
        </div>

        {showNewDm && <NewDmInput onClose={() => setShowNewDm(false)} />}

        <div className="dm-section-list">
          {sortedConversations.map((conv) => (
            <DmTile
              key={conv.id}
              conversation={conv}
              isSelected={panelMode === 'dm' && conv.id === activeConversationId}
            />
          ))}
          {conversations.length === 0 && !showNewDm && (
            <div className="dm-section-empty">No conversations yet.</div>
          )}
        </div>
      </div>
    </div>
  );
}
