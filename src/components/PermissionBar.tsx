import { Session } from '../types';
import { useSessionStore } from '../stores/sessionStore';

export default function PermissionBar({ session }: { session: Session }) {
  const respondPermission = useSessionStore((s) => s.respondPermission);
  const currentPerm = session.pending_permissions[0];
  if (!currentPerm) return null;

  const remaining = session.pending_permissions.length - 1;

  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '2px solid var(--border-strong)',
      borderRadius: 8,
      padding: 12,
      margin: '0 16px 8px',
      flexShrink: 0,
    }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', marginBottom: 4 }}>
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 14,
          fontWeight: 700,
          color: 'var(--text-primary)',
        }}>
          {currentPerm.tool_type}
        </span>
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 14,
          color: 'var(--text-secondary)',
        }}>
          {currentPerm.description}
        </span>
      </div>

      <div style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 13,
        color: 'var(--text-primary)',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-all',
        marginBottom: 12,
      }}>
        {currentPerm.command}
      </div>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <button
          onClick={() => respondPermission(session.id, currentPerm.id, true)}
          style={{
            background: 'var(--allow-bg)',
            color: 'var(--allow-text)',
            fontWeight: 700,
            fontSize: 14,
            padding: '0 24px',
            height: 56,
            minWidth: 120,
            borderRadius: 4,
            cursor: 'pointer',
          }}
        >
          ✓ Allow
        </button>
        <button
          onClick={() => respondPermission(session.id, currentPerm.id, false)}
          style={{
            background: 'var(--deny-bg)',
            color: 'var(--deny-text)',
            fontWeight: 700,
            fontSize: 14,
            padding: '0 24px',
            height: 56,
            minWidth: 120,
            borderRadius: 4,
            border: '2px solid var(--deny-border)',
            cursor: 'pointer',
          }}
        >
          ✗ Deny
        </button>
        {remaining > 0 && (
          <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            + {remaining} more
          </span>
        )}
      </div>
    </div>
  );
}
