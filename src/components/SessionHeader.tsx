import { Session, TokenUsage, RemoteSessionInfo } from '../types';
import { useUIStore } from '../stores/uiStore';
import { useSessionStore } from '../stores/sessionStore';
import '../styles/header.css';

function formatTokens(usage: TokenUsage): string {
  const fmt = (n: number) => n >= 1000 ? (n / 1000).toFixed(1) + 'K' : String(n);
  return `${fmt(usage.input_tokens)} in / ${fmt(usage.output_tokens)} out · $${usage.total_cost_usd.toFixed(2)}`;
}

export default function SessionHeader({ session, remoteSession, isWide }: { session?: Session; remoteSession?: RemoteSessionInfo; isWide: boolean }) {
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen);
  const setSettingsOpen = useUIStore((s) => s.setSettingsOpen);
  const tokenUsage = useSessionStore((s) => session ? s.tokenUsage[session.id] : undefined);
  const cancelAgent = useSessionStore((s) => s.cancelAgent);

  const isRunning = session?.state === 'running' || session?.state === 'waiting_permission';

  return (
    <div className="session-header">
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
        <div className="header-info">
          <div className="header-title">{remoteSession.title || remoteSession.slug}</div>
          <div className="header-subtitle">{remoteSession.project || remoteSession.cwd}</div>
        </div>
      ) : (
        <div className="header-placeholder">CodeDeck</div>
      )}
    </div>
  );
}
