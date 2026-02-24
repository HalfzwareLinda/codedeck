import { Session } from '../types';
import { useSessionStore } from '../stores/sessionStore';

export default function SessionHeader({ session, isWide }: { session?: Session; isWide: boolean }) {
  const setSidebarOpen = useSessionStore((s) => s.setSidebarOpen);
  const setSettingsOpen = useSessionStore((s) => s.setSettingsOpen);

  return (
    <div style={{
      height: 56,
      display: 'flex',
      alignItems: 'center',
      padding: '0 16px',
      borderBottom: '1px solid var(--border-subtle)',
      flexShrink: 0,
      gap: 12,
    }}>
      {!isWide && (
        <button
          onClick={() => setSidebarOpen(true)}
          style={{
            width: 48,
            height: 48,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 20,
            cursor: 'pointer',
            color: 'var(--text-primary)',
          }}
        >
          ☰
        </button>
      )}

      <button
        onClick={() => setSettingsOpen(true)}
        style={{
          width: 48,
          height: 48,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 18,
          cursor: 'pointer',
          color: 'var(--text-secondary)',
        }}
      >
        ⚙
      </button>

      {session ? (
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>
            {session.name}
          </div>
          <div style={{
            fontSize: 12,
            color: 'var(--text-secondary)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>
            {session.group}:{session.workspace_path} · {session.branch}
          </div>
        </div>
      ) : (
        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-muted)' }}>
          CodeDeck
        </div>
      )}
    </div>
  );
}
