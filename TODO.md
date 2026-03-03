# Codedeck TODO

## Known Bugs (from static analysis 2026-03-01)

- [ ] **processGiftWrap swallows exceptions silently** — `nostrService.ts:169` — NIP-17 gift-wrap decryption failures return `null` with minimal logging, making DM debugging hard. Added `console.warn` but could surface to UI.

- [x] ~~**Seq counters reset on bridge extension restart**~~ — Fixed: `sessionWatcher.ts:loadFullHistory()` now derives seq counters from JSONL content on restart, and `extension.ts` persists `lastSeenTimestamp` in `globalState` for crash recovery.

- [x] ~~**sendToClaudeTerminal ignores sessionId**~~ — Fixed: `terminalBridge.ts` now has full session-to-terminal mapping via `TerminalRegistry`.

- [ ] **SettingsModal API key test has no timeout** — `SettingsModal.tsx:43-60` — `handleTestApiKey()` calls `api.testApiKey()` with no timeout mechanism. If the network hangs, the UI shows "Testing..." indefinitely.

- [x] ~~**Phone subscription should use `since` filter**~~ — Fixed: `bridgeService.ts:connectToMachine()` uses `since: lastSeenTimestamp - 5` with 5-minute fallback window on first connect.

- [ ] **App.tsx deep link errors silently swallowed** — `App.tsx:74-79` — `getCurrent()` and `onOpenUrl()` promise rejections are caught with empty `.catch(() => {})`. If deep link init fails, pairing via QR code won't work with no feedback.

## Reliability Audit Fixes (2026-03-03)

### Bridge (`codedeck-bridge-vscode/`)
- [x] **Relay reconnection with exponential backoff** — `nostrRelay.ts` — `scheduleReconnect()` with 2s→30s cap. Called from `connect()` catch and `onclose`. Reset on `oneose` and successful publish.
- [x] **Output queue cap increased** — `nostrRelay.ts` — `MAX_OUTPUT_QUEUE_SIZE` raised from 200 to 500 (matches history buffer).
- [x] **TOCTOU fix in readNewLines** — `sessionWatcher.ts` — `openSync()` first, `fstatSync(fd)` second. Catches ENOENT to clean up stale offsets.
- [x] **Terminal liveness checks** — `terminalBridge.ts` — `exitStatus !== undefined` guard before each `sendText()` in `submitToTerminal()`.
- [x] **Pending timer cleanup** — `terminalBridge.ts` — `pendingTimers` Set tracked and cleared in `dispose()`.
- [x] **Flush guard** — `terminalBridge.ts` — `flushingSession` Set prevents concurrent `flushPendingInputs()`.
- [x] **LRU history eviction** — `sessionWatcher.ts` — standalone 5-minute interval evicts idle sessions when total history exceeds 10K entries.
- [x] **Dead session pruning** — `sessionWatcher.ts` — `pruneDeletedSessions()` checks `fs.existsSync` every ~36s.
- [x] **Dispose lifecycle** — `nostrRelay.ts` — `dispose()` method prevents reconnection after deactivation.

### Codedeck (`codedeck/`)
- [x] **Decryption failure tracking** — `bridgeService.ts` — After 5 consecutive failures, emits `onStatus('disconnected')`.
- [x] **Per-session card tracking** — `sessionStore.ts` + `OutputStream.tsx` — `respondedCards` is `Map<sessionId, Set<cardId>>` (was flat Set with composite keys).
- [x] **History chunk tracker keyed by requestId** — `sessionStore.ts` — eliminates race when second history-request arrives before first completes.
- [x] **Capped seq dedup** — `sessionStore.ts` — `seenBridgeSeqs` Set capped at 1000 entries per session, pruned below `max - 1000`.
- [x] **Handler re-registration** — `sessionStore.ts` — `initBridgeService()` always re-registers handlers (safe after key change).
- [x] **Periodic rumor ID cleanup** — `nostrService.ts` — 5-minute interval evicts stale `sentRumorIds`.
- [x] **DM profile fetch timeout** — `nostrService.ts` — `fetchProfileName()` wrapped in `Promise.race()` with 5s timeout.

## Future UX Improvements

- [ ] **Session badge/counter for background activity** — When viewing one session, show a badge on other sessions in the sidebar that have received new output since last viewed.

- [ ] **Better error surfacing** — Several silent failures (gift-wrap decryption, deep link init, API key timeout) should show toast notifications or inline error messages instead of logging to console.

- [ ] **TodoWrite checklist rendering** — Render Claude's `TodoWrite` tool output as a proper checklist card in the output stream instead of raw tool_use content.

- [ ] **Session pinning / archiving** — Pin active sessions to the top of the sidebar, archive old ones to reduce clutter.

## Future Protocol Improvement

- [ ] **Consider ephemeral event kind for real-time output** — Currently kind 4515 (regular/stored) is used for output events, which means relays store every output event and replay them all on reconnect (newest-first, requiring sorted insertion on the phone). A cleaner design: use an ephemeral kind (20000-29999) for the real-time stream so relays don't store it, and rely solely on the existing `history-request` pattern for catch-up. This would eliminate redundant replay, reduce relay storage, and remove the need for sorted insertion. Trade-off: breaking change to both sides of the protocol.
