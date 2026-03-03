import { useState, useRef, useCallback } from 'react';
import { useUIStore } from '../stores/uiStore';
import { useSessionStore } from '../stores/sessionStore';
import { useDmStore } from '../stores/dmStore';
import { parsePublicKey } from '../services/nostrService';
import { relativeTime } from '../utils/relativeTime';
import { Session, RemoteSessionInfo } from '../types';
import DmTile from './DmTile';
import '../styles/sidebar.css';
import '../styles/dm.css';

const PULL_THRESHOLD = 60;
const MAX_PULL = 100;

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
  const isUnread = useSessionStore((s) => s.unreadSessions.has(session.id));

  const classes = [
    'session-card',
    isSelected ? 'selected' : '',
    stateClass(session.state),
  ].filter(Boolean).join(' ');

  // Show unread dot only when StatusDot is absent (idle/completed/error)
  const showUnread = isUnread && session.state !== 'running' && session.state !== 'waiting_permission';

  return (
    <div className={classes} onClick={() => { setActiveSession(session.id); setPanelMode('session'); setSidebarOpen(false); }}>
      <div className="session-card-info">
        <div className="session-card-name">{session.name}</div>
        <div className="session-card-path">{session.workspace_path} · {session.branch}</div>
      </div>
      <StatusDot state={session.state} />
      {showUnread && <div className="session-unread-dot" />}
    </div>
  );
}

function RemoteSessionCard({ session, isSelected }: { session: RemoteSessionInfo; isSelected: boolean }) {
  const setActiveSession = useSessionStore((s) => s.setActiveSession);
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen);
  const setPanelMode = useUIStore((s) => s.setPanelMode);
  const requestSessionHistory = useSessionStore((s) => s.requestSessionHistory);
  const hasOutput = useSessionStore((s) => (s.outputs[session.id]?.length ?? 0) > 0);
  const isUnread = useSessionStore((s) => s.unreadSessions.has(session.id));

  const isPending = session.id.startsWith('pending:');

  const classes = ['session-card', isSelected ? 'selected' : '', isPending ? 'pending' : ''].filter(Boolean).join(' ');

  const handleClick = () => {
    if (isPending) return; // Non-clickable while pending
    setActiveSession(session.id);
    setPanelMode('session');
    setSidebarOpen(false);
    if (!hasOutput) {
      requestSessionHistory(session.id);
    }
  };

  if (isPending) {
    return (
      <div className={classes} style={{ opacity: 0.7, cursor: 'default' }}>
        <div className="session-card-info">
          <div className="session-card-name">Starting...</div>
          <div className="session-card-path">
            <span className="session-card-path-text">Waiting for Claude Code...</span>
          </div>
        </div>
        <div className="status-dot running" />
      </div>
    );
  }

  const noTerminal = session.hasTerminal === false;

  return (
    <div className={classes} onClick={handleClick} style={noTerminal ? { opacity: 0.6 } : undefined}>
      <div className="session-card-info">
        <div className="session-card-name">{session.title || session.slug}</div>
        <div className="session-card-path">
          <span className="session-card-path-text">{session.project}</span>
          {noTerminal && <span className="session-card-offline">offline</span>}
          {session.permissionMode === 'bypassPermissions' && <span className="session-card-bypass">BP</span>}
          <span className="session-card-time">{relativeTime(session.lastActivity)}</span>
        </div>
      </div>
      {isUnread && <div className="session-unread-dot" />}
    </div>
  );
}

function NewDmInput({ onClose }: { onClose: () => void }) {
  const [pubkey, setPubkey] = useState('');
  const [error, setError] = useState('');
  const startConversation = useDmStore((s) => s.startConversation);
  const setPanelMode = useUIStore((s) => s.setPanelMode);
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen);

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
    setSidebarOpen(false);
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
  const machines = useSessionStore((s) => s.machines);
  const remoteSessions = useSessionStore((s) => s.remoteSessions);
  const refreshing = useSessionStore((s) => s.refreshing);
  const requestRefreshSessions = useSessionStore((s) => s.requestRefreshSessions);
  const [showNewDm, setShowNewDm] = useState(false);

  // --- Pull-to-refresh (ref-based to avoid per-frame re-renders) ---
  const listRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLDivElement>(null);
  const touchStartY = useRef(0);
  const pullRef = useRef(0);
  const isPullingRef = useRef(false);
  // Only used for the refreshing spinner (low-frequency state)
  const [triggered, setTriggered] = useState(false);

  const hasRemoteMachines = machines.length > 0;

  const updateIndicator = useCallback((distance: number) => {
    const el = indicatorRef.current;
    if (!el) return;
    if (distance > 0) {
      el.style.height = `${distance}px`;
      el.style.display = 'flex';
      const icon = el.querySelector('.pull-indicator-icon') as HTMLElement | null;
      const text = el.querySelector('.pull-indicator-text') as HTMLElement | null;
      if (icon) {
        icon.textContent = distance >= PULL_THRESHOLD ? '\u2191' : '\u2193';
        icon.className = `pull-indicator-icon${distance >= PULL_THRESHOLD ? ' ready' : ''}`;
      }
      if (text) {
        text.textContent = distance >= PULL_THRESHOLD ? 'Release to refresh' : 'Pull to refresh';
      }
    } else {
      el.style.height = '0px';
      el.style.display = 'none';
    }
  }, []);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (!hasRemoteMachines) return;
    const el = listRef.current;
    // scrollTop <= 0 handles both 0 and negative values (iOS bounce)
    if (el && el.scrollTop <= 0) {
      touchStartY.current = e.touches[0].clientY;
      isPullingRef.current = true;
    }
  }, [hasRemoteMachines]);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isPullingRef.current) return;
    const el = listRef.current;
    if (!el || el.scrollTop > 0) {
      isPullingRef.current = false;
      pullRef.current = 0;
      updateIndicator(0);
      return;
    }
    const dy = Math.max(0, e.touches[0].clientY - touchStartY.current);
    const dampened = Math.min(MAX_PULL, Math.sqrt(dy) * 5);
    pullRef.current = dampened;
    updateIndicator(dampened);
  }, [updateIndicator]);

  const onTouchEnd = useCallback(() => {
    if (!isPullingRef.current) return;
    if (pullRef.current >= PULL_THRESHOLD && !refreshing) {
      requestRefreshSessions();
      setTriggered(true);
    }
    pullRef.current = 0;
    isPullingRef.current = false;
    updateIndicator(0);
  }, [refreshing, requestRefreshSessions, updateIndicator]);

  // Reset triggered state when refreshing completes
  if (triggered && !refreshing) {
    setTriggered(false);
  }

  // Group local sessions
  const groups: Record<string, Session[]> = {};
  for (const session of sessions) {
    const group = session.group || 'DEFAULT';
    if (!groups[group]) groups[group] = [];
    groups[group].push(session);
  }

  const sortedConversations = [...conversations].sort(
    (a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime(),
  );

  const hasLocalSessions = sessions.length > 0;

  return (
    <div className="sidebar">
      {/* Sessions header */}
      <div className="sidebar-header">
        <span className="sidebar-title">Sessions</span>
        <button className="sidebar-add-btn" onClick={() => setNewSessionOpen(true)}>+</button>
      </div>

      {/* Sessions list — fills remaining space above DMs */}
      <div
        className="sidebar-list"
        ref={listRef}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {/* Pull-to-refresh indicator (height driven by ref, not state) */}
        {hasRemoteMachines && (
          <div
            ref={indicatorRef}
            className={`pull-indicator${refreshing ? ' spinning' : ''}`}
            style={{ height: refreshing ? 32 : 0, display: refreshing ? 'flex' : 'none' }}
          >
            <span className={`pull-indicator-icon${refreshing ? ' spinning' : ''}`}>
              {refreshing ? '...' : '\u2193'}
            </span>
            <span className="pull-indicator-text">{refreshing ? 'Refreshing...' : 'Pull to refresh'}</span>
          </div>
        )}
        {/* Remote machines */}
        {machines.map((machine) => {
          const machineSessions = [...(remoteSessions[machine.pubkeyHex] || [])].sort(
            (a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime(),
          );
          return (
            <div key={machine.pubkeyHex}>
              <div className="group-heading" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span className={`dm-connection-dot ${machine.connected ? 'connected' : 'disconnected'}`} />
                <span style={{ flex: 1 }}>{machine.hostname}</span>
                {machine.connected && (
                  <button
                    className="sidebar-add-btn"
                    style={{ fontSize: 14, padding: '0 4px', lineHeight: 1 }}
                    onClick={(e) => { e.stopPropagation(); setNewSessionOpen(true, machine); }}
                  >+</button>
                )}
              </div>
              {machineSessions.map((session) => (
                <RemoteSessionCard
                  key={session.id}
                  session={session}
                  isSelected={panelMode === 'session' && session.id === activeSessionId}
                />
              ))}
              {machineSessions.length === 0 && (
                <div className="sidebar-empty" style={{ fontSize: 11, padding: '4px 16px' }}>
                  {machine.connected ? 'No sessions' : 'Connecting...'}
                </div>
              )}
            </div>
          );
        })}

        {/* Local sessions */}
        {hasRemoteMachines && hasLocalSessions && (
          <div className="group-heading" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="dm-connection-dot connected" />
            This device
          </div>
        )}
        {Object.entries(groups).map(([group, groupSessions]) => (
          <div key={group}>
            {!hasRemoteMachines && <div className="group-heading">{group}</div>}
            {hasRemoteMachines && group !== 'DEFAULT' && <div className="group-heading" style={{ paddingLeft: 24 }}>{group}</div>}
            {groupSessions.map((session) => (
              <SessionCard
                key={session.id}
                session={session}
                isSelected={panelMode === 'session' && session.id === activeSessionId}
              />
            ))}
          </div>
        ))}
        {!hasLocalSessions && !hasRemoteMachines && (
          <div className="sidebar-empty">
            No sessions yet.<br />Tap + to create one.
          </div>
        )}
      </div>

      {/* DMs section — pinned to bottom, 2-tile height */}
      <div className="dm-section">
        <div className="dm-section-header">
          <span className="dm-section-title">
            <span className={`dm-connection-dot ${connectionStatus}`} />
            DMs
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
