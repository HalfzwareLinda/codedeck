export interface DebugLogEntry {
  timestamp: number;
  level: 'info' | 'warn';
  tag: string;
  message: string;
}

const MAX_ENTRIES = 200;
const entries: DebugLogEntry[] = [];
const listeners = new Set<() => void>();

/** Frozen snapshot — only replaced when entries change, so useSyncExternalStore can compare by reference. */
let snapshot: DebugLogEntry[] = [];

function push(level: 'info' | 'warn', tag: string, message: string): void {
  entries.push({ timestamp: Date.now(), level, tag, message });
  if (entries.length > MAX_ENTRIES) entries.shift();
  snapshot = [...entries];
  listeners.forEach((cb) => cb());
}

export function dmLog(tag: string, message: string): void {
  push('info', tag, message);
}

export function dmWarn(tag: string, message: string): void {
  push('warn', tag, message);
}

/** Snapshot for useSyncExternalStore — stable reference until next push. */
export function getLogEntries(): DebugLogEntry[] {
  return snapshot;
}

/** Subscribe for useSyncExternalStore. Returns unsubscribe function. */
export function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function clearLog(): void {
  entries.length = 0;
  snapshot = [];
  listeners.forEach((cb) => cb());
}
