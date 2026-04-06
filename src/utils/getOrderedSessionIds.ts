import { Session, RemoteMachine, RemoteSessionInfo } from '../types';

/**
 * Returns a flat ordered list of session IDs matching the sidebar's visual order:
 * 1. Remote sessions per machine (each sorted by lastActivity desc)
 * 2. Local sessions (grouped by session.group)
 * Pending sessions are excluded.
 */
export function getOrderedSessionIds(
  machines: RemoteMachine[],
  remoteSessions: Record<string, RemoteSessionInfo[]>,
  sessions: Session[],
): string[] {
  const ids: string[] = [];

  // Remote sessions per machine, sorted by lastActivity desc
  for (const machine of machines) {
    const machineSessions = [...(remoteSessions[machine.pubkeyHex] || [])].sort(
      (a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime(),
    );
    for (const s of machineSessions) {
      if (!s.id.startsWith('pending:')) {
        ids.push(s.id);
      }
    }
  }

  // Local sessions grouped by session.group
  const groups: Record<string, Session[]> = {};
  for (const session of sessions) {
    const group = session.group || 'DEFAULT';
    if (!groups[group]) groups[group] = [];
    groups[group].push(session);
  }
  for (const groupSessions of Object.values(groups)) {
    for (const s of groupSessions) {
      ids.push(s.id);
    }
  }

  return ids;
}
