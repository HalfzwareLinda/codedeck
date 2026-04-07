# Done — Codedeck

## Bug Fixes (2026-03-01)

- [x] **Seq counters reset on bridge extension restart** — Fixed: `sessionWatcher.ts:loadFullHistory()` derives seq counters from JSONL content on restart, `extension.ts` persists `lastSeenTimestamp` in `globalState` for crash recovery.
- [x] **sendToClaudeTerminal ignores sessionId** — Fixed: `terminalBridge.ts` now has full session-to-terminal mapping via `TerminalRegistry`.
- [x] **Phone subscription should use `since` filter** — Fixed: `bridgeService.ts:connectToMachine()` uses `since: lastSeenTimestamp - 5` with 5-minute fallback window on first connect.

## Reliability Audit — Bridge (2026-03-03)

- [x] **Relay reconnection with exponential backoff** — `nostrRelay.ts` — `scheduleReconnect()` with 2s->30s cap.
- [x] **Output queue cap increased** — `nostrRelay.ts` — `MAX_OUTPUT_QUEUE_SIZE` raised from 200 to 500.
- [x] **TOCTOU fix in readNewLines** — `sessionWatcher.ts` — `openSync()` first, `fstatSync(fd)` second.
- [x] **Terminal liveness checks** — `terminalBridge.ts` — `exitStatus !== undefined` guard before each `sendText()`.
- [x] **Pending timer cleanup** — `terminalBridge.ts` — `pendingTimers` Set tracked and cleared in `dispose()`.
- [x] **Flush guard** — `terminalBridge.ts` — `flushingSession` Set prevents concurrent `flushPendingInputs()`.
- [x] **LRU history eviction** — `sessionWatcher.ts` — standalone 5-minute interval evicts idle sessions when total exceeds 10K entries.
- [x] **Dead session pruning** — `sessionWatcher.ts` — `pruneDeletedSessions()` checks `fs.existsSync` every ~36s.
- [x] **Dispose lifecycle** — `nostrRelay.ts` — `dispose()` method prevents reconnection after deactivation.

## Reliability Audit — Codedeck App (2026-03-03)

- [x] **Decryption failure tracking** — `bridgeService.ts` — After 5 consecutive failures, emits `onStatus('disconnected')`.
- [x] **Per-session card tracking** — `sessionStore.ts` + `OutputStream.tsx` — `respondedCards` is `Map<sessionId, Set<cardId>>`.
- [x] **History chunk tracker keyed by requestId** — `sessionStore.ts` — eliminates race when second history-request arrives before first completes.
- [x] **Capped seq dedup** — `sessionStore.ts` — `seenBridgeSeqs` Set capped at 1000 entries per session.
- [x] **Handler re-registration** — `sessionStore.ts` — `initBridgeService()` always re-registers handlers.
- [x] **Periodic rumor ID cleanup** — `nostrService.ts` — 5-minute interval evicts stale `sentRumorIds`.
- [x] **DM profile fetch timeout** — `nostrService.ts` — `fetchProfileName()` wrapped in `Promise.race()` with 5s timeout.

## Swipe-to-Delete Sessions (2026-03-06)

- [x] **Swipe-to-delete sessions** — New swipe gesture for session deletion with close-session protocol message to bridge (`2df9f35`, 2026-03-06)
- [x] **Undo toast UI** — Added missing undo toast for swipe-to-delete (`eb61726`, 2026-03-07)

## Mode Cycle & Plan Mode Overhaul (2026-03-07 — 2026-03-23)

- [x] **Correct mode cycle order** — Fixed to PLAN→BYPASS→EDITS with plan as default fallback (`dea1ecf`, 2026-03-07)
- [x] **Prevent bridge overwriting phone bypass mode** — Bridge no longer overwrites phone's mode with default (`e276e75`, 2026-03-07)
- [x] **Plan approval card matches Claude Code 4-option menu** — Updated card to reflect Claude Code's actual options (`1a27209`, 2026-03-07)
- [x] **Auto-approve read-only tools in plan mode** — Read/Glob/Grep/etc. auto-approved (`cd7df2d`, 2026-03-08)
- [x] **Hide auto-approved permission cards in plan mode** — Cards no longer flash on screen (`223fccc`, 2026-03-08)
- [x] **Handle session-replaced events** — Merge plan option 1 sessions correctly (`83bf067`, 2026-03-08)
- [x] **Initialize session mode on creation** — Plan auto-approve works for fresh sessions (`eb89ff1`, 2026-03-09)
- [x] **Sync mobile UI mode on plan approval** — Mobile mode state stays in sync (`76ae9d4`, 2026-03-09)
- [x] **Remove ExitPlanMode from auto-approve set** — Prevents unintended plan exits (`1826c72`, 2026-03-23)
- [x] **CD-014: Remove phone-side auto-approve logic** — Phone no longer auto-approves; bridge is sole authority. Removed PLAN_AUTO_APPROVE set, mode subscription, useEffect dispatch from PermissionRequestEntry (`1713db0`, 2026-03-29)

## Question Card UX & Free-Text Input (2026-03-08 — 2026-03-23)

- [x] **Free-text input on question cards** — Cards now support typed answers, not just button choices (`5a7d856`, 2026-03-08)
- [x] **Plan revision text input** — Dedicated "Type your revision below" field for plan revision option (`1af519c`, 2026-03-08)
- [x] **Detect free-text options at any position** — Free-text option no longer required at end of menu (`9daa467`, 2026-03-09)
- [x] **Tabbed multi-question cards** — Multiple AskUserQuestion prompts grouped into tabbed card (`b0e778c`, 2026-03-23)

## Blossom Upload Fixes (2026-03-08 — 2026-03-15)

- [x] **AES-256-GCM for Blossom uploads** — Switched from NIP-44 to AES-256-GCM encryption (`0c91091`, 2026-03-08)
- [x] **HTTPS in CSP for Blossom** — Updated Content Security Policy to allow HTTPS Blossom endpoints (`845fc51`, 2026-03-15)

## Misc Fixes (2026-03-06 — 2026-03-09)

- [x] **Notification dot accuracy** — Only shows when session actually needs user input (`b244a8b`, 2026-03-07)
- [x] **TypeScript build fix** — Removed unused `DISMISSED_TTL_MS` constant (`5533ceb`, 2026-03-06)
- [x] **Speech-recognizer permission cleanup** — Removed nonexistent `allow-register-listener`, fixed `scrollToRow` stale index crash (`c341cd5`, `350513c`, 2026-03-09)

## Auto-Scroll Fix (2026-03-31)

- [x] **CD-023: Auto-scroll chat on new incoming messages** — Added `useEffect` watching `display.length` to trigger `safeScrollToEnd()` directly, bypassing unreliable ResizeObserver on mobile WebView (`ea3af0d`, 2026-03-31)

## Completed (2026-03-31)

- [x] **CD-020: Set up Nostr relay for Codedeck on Cloudflare** — Deployed dedicated Nostr relay on Cloudflare for Codedeck bridge traffic (2026-03-31)
- [x] **CD-025: Add build mode effort functionality** — Added build mode effort setting/control in the Codedeck UI (2026-03-31)

## Pairing Improvements (2026-04-02)

- [x] **CD-027: Apply blossom + relay config from pairing deep link** — Deep link handler now merges pairing relays into DM relay list and applies Blossom server URL in a single atomic config update (`30682c3`, 2026-04-02)

## DM Swipe Navigation (2026-04-07)

- [x] **CD-028: Swipe left/right to navigate between DM conversations** — Reuses existing `useSwipeToNavigate` hook for DM panel mode, cycling through conversations sorted by most recent message (`a0fecb9`, 2026-04-07)

## TODO Cleanup (2026-04-07)

- [x] **CD-018: Increase DM row height in sidebar** — Direct message rows in the left column height increased for better readability (2026-04-07)
- [x] **CD-024: Fix excess "1111111" in terminal tool approval** — Fixed excess `1111111` characters in the tool approval UI (2026-04-07)
