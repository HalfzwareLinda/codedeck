import { useMemo } from 'react';
import { Session, TokenUsage, RemoteSessionInfo } from '../types';
import { useUIStore } from '../stores/uiStore';
import { useSessionStore } from '../stores/sessionStore';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { useOrderedSessionIds } from '../hooks/useOrderedSessionIds';
import '../styles/header.css';

function formatTokens(usage: TokenUsage): string {
  const fmt = (n: number) => n >= 1000 ? (n / 1000).toFixed(1) + 'K' : String(n);
  if (usage.total_cost_usd > 0) {
    return `${fmt(usage.input_tokens)} in / ${fmt(usage.output_tokens)} out · $${usage.total_cost_usd.toFixed(2)}`;
  }
  return `${fmt(usage.input_tokens)} in / ${fmt(usage.output_tokens)} out`;
}

/**
 * Checks if any session in the given direction needs attention
 * (unread or waiting_permission).
 */
function useAttentionDirection(sessionId: string | undefined) {
  const orderedIds = useOrderedSessionIds();
  const sessions = useSessionStore((s) => s.sessions);
  const unreadSessions = useSessionStore((s) => s.unreadSessions);

  return useMemo(() => {
    if (!sessionId) return { left: false, right: false };

    const currentIndex = orderedIds.indexOf(sessionId);
    if (currentIndex === -1 || orderedIds.length <= 1) return { left: false, right: false };

    const needsAttention = (id: string) => {
      if (unreadSessions.has(id)) return true;
      const local = sessions.find(s => s.id === id);
      if (local?.state === 'waiting_permission') return true;
      return false;
    };

    // Left = previous sessions (indices before current)
    let left = false;
    for (let i = 0; i < currentIndex; i++) {
      if (needsAttention(orderedIds[i])) { left = true; break; }
    }

    // Right = next sessions (indices after current)
    let right = false;
    for (let i = currentIndex + 1; i < orderedIds.length; i++) {
      if (needsAttention(orderedIds[i])) { right = true; break; }
    }

    return { left, right };
  }, [sessionId, orderedIds, sessions, unreadSessions]);
}

export default function SessionHeader({ session, remoteSession, isWide }: { session?: Session; remoteSession?: RemoteSessionInfo; isWide: boolean }) {
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen);
  const setSettingsOpen = useUIStore((s) => s.setSettingsOpen);
  const sessionId = session?.id ?? remoteSession?.id;
  const tokenUsage = useSessionStore((s) => sessionId ? s.tokenUsage[sessionId] : undefined);
  const cancelAgent = useSessionStore((s) => s.cancelAgent);
  const showModeBadge = useSessionStore((s) => s.config.show_mode_badge);
  const isTouchDevice = useMediaQuery('(pointer: coarse)');
  const attention = useAttentionDirection(sessionId);

  const isRunning = session?.state === 'running' || session?.state === 'waiting_permission';

  return (
    <div className="session-header">
      {isTouchDevice && attention.left && (
        <span className="session-nav-hint left" aria-hidden="true">{'\u2039'}</span>
      )}
      {isTouchDevice && attention.right && (
        <span className="session-nav-hint right" aria-hidden="true">{'\u203A'}</span>
      )}
      {!isWide && (
        <button className="header-btn header-hamburger" onClick={() => setSidebarOpen(true)}>
          &#9776;
        </button>
      )}

      <button className="header-btn header-settings" onClick={() => setSettingsOpen(true)}>
        &#9881;
      </button>

      {session ? (
        <>
          <div className="header-info">
            <div className="header-title">
              {session.name}
              {!session.workspace_ready && (
                <span className="header-cloning"> (cloning...)</span>
              )}
            </div>
            <div className="header-subtitle">
              {session.group}:{session.workspace_path} · {session.branch}
            </div>
          </div>
          {isRunning && (
            <button
              className="header-btn header-cancel"
              onClick={() => cancelAgent(session.id)}
              title="Cancel agent"
            >
              &#x25A0;
            </button>
          )}
          {tokenUsage && (tokenUsage.input_tokens > 0 || tokenUsage.output_tokens > 0) && (
            <div className="header-tokens">{formatTokens(tokenUsage)}</div>
          )}
        </>
      ) : remoteSession ? (
        <>
          <div className="header-info">
            <div className="header-title">
              {remoteSession.title || remoteSession.slug}
              {showModeBadge && remoteSession.permissionMode === 'default' && (
                <span className="header-bypass-badge">YOLO</span>
              )}
            </div>
            <div className="header-subtitle">{remoteSession.project || remoteSession.cwd}</div>
          </div>
          <button
            className="header-btn header-cancel"
            onClick={() => cancelAgent(remoteSession.id)}
            title="Interrupt session"
          >
            &#x25A0;
          </button>
          {tokenUsage && (tokenUsage.input_tokens > 0 || tokenUsage.output_tokens > 0) && (
            <div className="header-tokens">{formatTokens(tokenUsage)}</div>
          )}
        </>
      ) : (
        <div className="header-placeholder">CodeDeck</div>
      )}
    </div>
  );
}
