import { Session } from '../types';
import { useSessionStore } from '../stores/sessionStore';
import '../styles/permission.css';

export default function PermissionBar({ session }: { session: Session }) {
  const respondPermission = useSessionStore((s) => s.respondPermission);
  const currentPerm = session.pending_permissions[0];
  if (!currentPerm) return null;

  const remaining = session.pending_permissions.length - 1;

  return (
    <div className="permission-bar">
      <div className="permission-header">
        <span className="permission-type">{currentPerm.tool_type}</span>
        <span className="permission-desc">{currentPerm.description}</span>
      </div>

      <div className="permission-command">{currentPerm.command}</div>

      <div className="permission-actions">
        <button
          className="btn-allow"
          onClick={() => respondPermission(session.id, currentPerm.id, true)}
        >
          Allow
        </button>
        <button
          className="btn-deny"
          onClick={() => respondPermission(session.id, currentPerm.id, false)}
        >
          Deny
        </button>
        {remaining > 0 && (
          <span className="permission-remaining">+ {remaining} more</span>
        )}
      </div>
    </div>
  );
}
