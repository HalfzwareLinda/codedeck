import { useMemo } from 'react';
import { useSessionStore } from '../stores/sessionStore';
import { getOrderedSessionIds } from '../utils/getOrderedSessionIds';

/**
 * Shared hook that returns the flat ordered list of session IDs
 * matching the sidebar's visual order. Used by both MainPanel
 * (swipe navigation) and SessionHeader (attention indicators).
 */
export function useOrderedSessionIds() {
  const machines = useSessionStore((s) => s.machines);
  const remoteSessions = useSessionStore((s) => s.remoteSessions);
  const sessions = useSessionStore((s) => s.sessions);

  return useMemo(
    () => getOrderedSessionIds(machines, remoteSessions, sessions),
    [machines, remoteSessions, sessions],
  );
}
