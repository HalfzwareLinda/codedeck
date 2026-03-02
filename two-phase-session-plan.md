# Two-Phase Session Creation: Immediate Ack System (v2)

## Context

For 10+ commits, new sessions initiated from the Codedeck Android app spawn a Claude Code terminal in VSCode but never appear on the phone.

### Why the Current System Fails

The chain has 5 serial blocking dependencies, any one of which can break it:

1. **Nostr relay delivery** — phone → bridge (1-2s, can fail silently)
2. **Terminal open** — `claude-vscode.terminal.open` VSCode command (~200ms, can hang)
3. **Claude Code boot** — writes first JSONL line (3-10s, unpredictable)
4. **FileSystemWatcher** — detects new `.jsonl` file (unreliable on some systems)
5. **indexSession()** — reads metadata from first 20 lines (empty file = fails)

The bridge `onCreateSession` awaits all 5 steps (up to 60s) before publishing the session list. Meanwhile the phone's `NewSessionModal` times out after 10s and silently closes. Even if the bridge eventually publishes, the phone has already given up.

### The Fix

Split session creation into two phases — an **immediate acknowledgment** when the terminal opens (sub-second), followed by a **background upgrade** when the JSONL file appears (seconds later). The phone shows the session immediately in a "Starting..." state.

## Architecture

```
Phone                          Relay              VSCode Bridge
  |                              |                      |
  |-- create-session ----------->|--------------------->|
  |                              |                      | generates pendingId
  |                              |                      | try: await terminal.open (~200ms)
  |                              |                      | onDidOpenTerminal fires
  |                              |                      |   (only maps if isClaudeTerminal)
  |<---- session-pending --------|<---------------------|  (NIP-40: expires in 2min)
  |  (shows "Starting...")       |                      |
  |                              |                      | ... Claude Code boots ...
  |                              |                      | JSONL file appears (~3-10s)
  |                              |                      | SessionWatcher detects it
  |                              |                      | getPendingId(sessionId) → match
  |<---- session-ready ----------|<---------------------|  (NIP-40: expires in 1min)
  |  (upgrades to real session)  |                      |
  |                              |                      |
  --- ON FAILURE: ---
  |                              |                      | terminal.open throws
  |<---- session-failed ---------|<---------------------|  (reason: 'terminal-failed')
  |  (placeholder removed)       |                      |
  |                              |                      |
  |                              |                      | 30s timeout expires
  |<---- session-failed ---------|<---------------------|  (reason: 'timeout')
  |  (placeholder removed)       |                      |
```

## Changes

### 1. Bridge types — add 3 new message types
**File**: [types.ts](codedeck-bridge-vscode/src/types.ts)

Add to `BridgeOutbound` union:
```typescript
interface SessionPendingMessage {
  type: 'session-pending';
  pendingId: string;    // bridge-generated UUID
  machine: string;
  createdAt: string;    // ISO timestamp
}
interface SessionReadyMessage {
  type: 'session-ready';
  pendingId: string;
  session: RemoteSessionInfo;
}
interface SessionFailedMessage {
  type: 'session-failed';
  pendingId: string;
  reason: string;       // 'timeout' | 'terminal-failed'
}
```

### 2. Bridge core — replace blocking wait with pending-session map
**File**: [core.ts](codedeck-bridge-vscode/src/core.ts)

**Remove**: `awaitNewSession()`, `pendingNewSession` field, `cancelPendingNewSession()` — the entire blocking machinery (lines 49-54, 187-239).

**Add**: `pendingSessions: Map<string, { pendingId, timeoutHandle }>` — non-blocking tracking.

**Replace `onCreateSession`** (lines 70-94):
```
1. Generate pendingId
2. try { await terminal.createSession(pendingId) } catch → publish session-failed('terminal-failed'), return
3. Publish session-pending  (sub-second, terminal confirmed open)
4. Start 30s timeout → publish session-failed('timeout')
5. Return immediately — no blocking await
```

> **v1 risk (await vs fire-and-forget)**: v1 published `session-pending` *before* confirming the terminal opened, creating ghost sessions if `terminal.createSession()` failed. v2 awaits the terminal open first (~200ms cost) and only publishes if it succeeds. If it throws, `session-failed` is published immediately with reason `'terminal-failed'`.

> **v1 risk (90s timeout)**: v1 used a 90s timeout. A user staring at "Starting..." for 90 seconds is terrible UX — Claude Code typically boots in 3-10s. If it hasn't appeared in 30s, something is wrong. **v2 uses 30s.**

**Replace `onNewSession`** (lines 171-177): When `SessionWatcher` detects a new JSONL, use `terminalBridge.getPendingId(sessionId)` to find the matching `pendingId`. Publish `session-ready` with that `pendingId` and clear the timeout. If no `pendingId` match exists (user opened terminal manually), just publish the session list.

> **v1 risk (oldest-first matching)**: v1 matched by finding the "oldest pending session." If user creates sessions A then B rapidly and B's JSONL appears before A's, the oldest-first heuristic maps B's file to A's pendingId — a permanent mismatch. **v2 matches by terminal identity**: the `pendingTerminals` map links `pendingId → terminal`. When `onNewSession(sessionId, cwd)` fires, it matches against the terminal's cwd, not by ordering.

Update `TerminalSender.createSession` signature to accept optional `pendingId: string`.

### 3. Terminal registry — track pending terminals by ID
**File**: [terminalBridge.ts](codedeck-bridge-vscode/src/terminalBridge.ts)

**Add field**: `private nextPendingId: string | null = null`
**Add field**: `private pendingTerminals: Map<string, vscode.Terminal> = new Map()`
**Add field**: `private nextPendingExpiry: NodeJS.Timeout | null = null`

**Update `createSession()`**: Accept `pendingId` param, store it in `nextPendingId`. **Start a 5s expiry timer** — if `onDidOpenTerminal` hasn't fired in 5s, clear `nextPendingId` to prevent stale mappings.

**Update `onDidOpenTerminal` handler** (line 72): **Only consume `nextPendingId` if `isClaudeTerminal(t)` returns true** — ignore non-Claude terminals entirely. Map `pendingId -> terminal` in `pendingTerminals`, clear `nextPendingId` and the expiry timer.

> **v1 risk (fragile terminal matching)**: v1 mapped `nextPendingId` to *whatever* terminal opens next. If the user opens a non-Claude terminal in that window, the wrong terminal gets mapped. **v2 adds the `isClaudeTerminal()` guard and a 5s expiry** to prevent both wrong-terminal and stale mappings.

**Update `onNewSession()`** (line 100): Check `pendingTerminals` first (strongest signal — we know exactly which terminal was opened for this request). Fall back to existing temporal proximity if no pending match.

**Add method**: `getPendingId(sessionId): string | undefined` — looks up the `pendingId` for a given session by matching the terminal's cwd against the session's cwd. This is the **deterministic** link between pending tracking and session resolution.

### 4. Nostr relay — add 3 publish methods + NIP-40 expiration
**File**: [nostrRelay.ts](codedeck-bridge-vscode/src/nostrRelay.ts)

Add `publishSessionPending()`, `publishSessionReady()`, `publishSessionFailed()`. All use `OUTPUT_EVENT_KIND` (4515, regular events — stored and forwarded by relays).

**All events include NIP-40 expiration tags**:
```typescript
['expiration', String(Math.floor(Date.now() / 1000) + 120)]  // 2 minutes
```

> **v1 risk (stale events on reconnect)**: v1 used regular events with no expiration. If the phone reconnects to the relay 5 minutes later, it receives stale `session-pending` events from the past and shows ghost "Starting..." entries. **v2 adds NIP-40 expiration** (2 minutes) so relays auto-discard them. The phone's 2-minute stale cleanup (§8) handles any that slip through.

Extract a `publishToAllPhones(msg)` helper from the duplicate encrypt-sign-publish logic to avoid code duplication.

### 5. Extension wiring — pass pendingId through
**File**: [extension.ts](codedeck-bridge-vscode/src/extension.ts)

Update the `TerminalSender` object (lines 74-78) to pass `pendingId` to `terminalRegistry.createSession(pendingId)`.

### 6. Phone types — add 3 new inbound message variants
**File**: [types.ts](codedeck/src/types.ts)

Add to `BridgeInboundMessage` union:
```typescript
| { type: 'session-pending'; pendingId: string; machine: string; createdAt: string }
| { type: 'session-ready'; pendingId: string; session: RemoteSessionInfo }
| { type: 'session-failed'; pendingId: string; reason: string }
```

### 7. Phone bridge service — dispatch new message types
**File**: [bridgeService.ts](codedeck/src/services/bridgeService.ts)

Add 3 new handler types (`SessionPendingHandler`, `SessionReadyHandler`, `SessionFailedHandler`) + variables. Extend `setBridgeHandlers()` with **optional** params for the 3 new handlers (backward compatible). Add `case` branches in `handleBridgeEvent()` switch.

### 8. Phone session store — pending session lifecycle
**File**: [sessionStore.ts](codedeck/src/stores/sessionStore.ts)

**Add field**: `pendingSessions: Map<string, { pendingId, machine, createdAt, timeoutId }>` (Map, not Record — easier cleanup).

**Register 3 new handlers in `initBridgeService()`**:

- **`onSessionPending`**: Insert a placeholder `RemoteSessionInfo` with `id: "pending:<pendingId>"` into `remoteSessions[machine.pubkeyHex]`. Track in `pendingSessions`. Start a 2-minute client-side cleanup timer for this entry.

- **`onSessionReady`**: In a **single `set()` call**: remove the `pending:*` placeholder, insert the real `RemoteSessionInfo`, set it as active session, switch panel mode. Remove from `pendingSessions`. **Also check if the real session already exists** in the array (from a concurrent `onSessionList`) and deduplicate.

> **v1 risk (overwrite & duplication)**: v1's `onSessionReady` replaced the placeholder and set the session active, but didn't account for a concurrent `onSessionList` that may have already added the real session — causing duplicates. v1 also performed the replacement and navigation as separate state updates, which could cause the `NewSessionModal` subscription to fire on the intermediate state (placeholder removed but real session not yet inserted). **v2 does everything in a single `set()` call** and deduplicates against concurrent session list arrivals.

- **`onSessionFailed`**: Remove the placeholder. Remove from `pendingSessions`. Clear the cleanup timer. Optionally show toast/snackbar with reason.

**Update `onSessionList` handler** (line 480): When merging incoming sessions, preserve any pending placeholders that haven't been resolved yet. **Also**: remove any placeholders whose `pendingId` matches a real session that just arrived (dedup from the other direction).

**Add stale cleanup**: `setInterval` every 30s that removes pending placeholders older than 2 minutes (defensive against lost relay events).

### 9. NewSessionModal — close on pending ack
**File**: [NewSessionModal.tsx](codedeck/src/components/NewSessionModal.tsx)

Replace the current 10s timeout subscription (lines 31-57) with a subscription that **watches for `loading` becoming false** (set by the store on `onSessionReady`), not for pending entries directly. This decouples the modal from internal pending state.

Close modal as soon as a `pending:*` entry appears in `remoteSessions` (~1s). Keep a **15s** fallback timeout.

After 10s of waiting, **show elapsed time** ("Starting... (15s)") and a **"Cancel" button** after 15s.

> **v1 risk (modal race)**: v1's modal watched for `pending:*` entries to close itself. But `onSessionReady` replaces the `pending:*` entry with the real one. If the modal's subscription fires on the removal of the pending entry, it might not find the new session to navigate to. **v2 decouples the modal** — it closes on the pending ack, and navigation is handled by the store's `onSessionReady` in a single atomic state update.

### 10. Sidebar — render pending sessions
**File**: [Sidebar.tsx](codedeck/src/components/Sidebar.tsx)

Update `RemoteSessionCard` (line 53): Detect `session.id.startsWith('pending:')`. Show "Starting..." as title, "Waiting for Claude Code..." as subtitle, add a pulsing status dot. Make it non-clickable while pending.

## Timing Comparison

| Phase | Current | v1 Plan | v2 Plan |
|-------|---------|---------|---------|
| Phone sees session | 5-15s (or never) | ~800ms (placeholder) | ~1s (placeholder, after terminal confirmed) |
| Session fully ready | same | 3-11s (background upgrade) | 3-11s (background upgrade) |
| Phone modal closes | 10s timeout | ~1s (on ack) | ~1s (on ack) |
| Failure detection | never (hangs) | 90s timeout | 30s timeout + immediate on terminal fail |

## Files to Modify

| File | Changes |
|------|---------|
| `codedeck-bridge-vscode/src/types.ts` | Add 3 outbound message types |
| `codedeck-bridge-vscode/src/core.ts` | Replace `onCreateSession`/`awaitNewSession` with non-blocking pending flow |
| `codedeck-bridge-vscode/src/terminalBridge.ts` | Add pendingId tracking, `isClaudeTerminal` guard, `getPendingId()` method |
| `codedeck-bridge-vscode/src/nostrRelay.ts` | Add 3 publish methods + `publishToAllPhones` helper + NIP-40 expiration |
| `codedeck-bridge-vscode/src/extension.ts` | Pass `pendingId` through `TerminalSender` |
| `codedeck/src/types.ts` | Add 3 inbound message variants |
| `codedeck/src/services/bridgeService.ts` | Add 3 handler types + dispatch cases |
| `codedeck/src/stores/sessionStore.ts` | Pending session lifecycle (insert/upgrade/remove/dedup) |
| `codedeck/src/components/NewSessionModal.tsx` | Close on pending ack, 15s timeout, elapsed time display |
| `codedeck/src/components/Sidebar.tsx` | Render pending cards with pulsing state |

## Verification

1. **Happy path**: Create session from phone → "Starting..." in sidebar within ~1s → upgrades to real session within ~10s → tap to open
2. **Terminal failure**: Claude Code extension not installed → `session-failed` within ~500ms → placeholder removed
3. **Slow boot**: Claude Code takes 15s → "Starting..." shows elapsed time → upgrades when ready
4. **Force-kill Claude Code**: "Starting..." for 30s → `session-failed('timeout')` → placeholder removed
5. **Bridge restart during pending**: Phone's 2-min cleanup removes orphan placeholders
6. **Rapid double-create**: Each gets own `pendingId` and resolves independently (no oldest-first guessing)
7. **Relay reconnect**: NIP-40 expiration prevents stale `session-pending` from showing ghost entries
8. **Manual terminal open**: No `pendingId`, no placeholder — just publishes session list as before
9. **Non-Claude terminal during pending**: `isClaudeTerminal` guard prevents wrong-terminal mapping
10. **Concurrent `onSessionList` + `onSessionReady`**: Dedup logic prevents duplicate session entries
