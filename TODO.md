# Codedeck TODO

## Known Bugs (from static analysis 2026-03-01)

- [ ] **processGiftWrap swallows exceptions silently** — `nostrService.ts:169` — NIP-17 gift-wrap decryption failures return `null` with minimal logging, making DM debugging hard. Added `console.warn` but could surface to UI.

- [ ] **Seq counters reset on bridge extension restart** — Both `sessionWatcher.ts:244` and `nostrRelay.ts:174` start seq at 0 on restart. Phone may receive duplicate entries after a bridge restart. Fix: persist seq counters in `context.globalState` or derive from loaded history.

- [ ] **sendToClaudeTerminal ignores sessionId** — `terminalBridge.ts:29-47` — Input from phone always goes to the first Claude terminal found, regardless of which session it targets. With multiple concurrent sessions, input goes to the wrong one. Fix: implement session-to-terminal mapping.

- [ ] **SettingsModal API key test has no timeout** — `SettingsModal.tsx:43-60` — `handleTestApiKey()` calls `api.testApiKey()` with no timeout mechanism. If the network hangs, the UI shows "Testing..." indefinitely.

- [ ] **Phone subscription should use `since` filter** — `bridgeService.ts` — On reconnect, the relay dumps all stored kind 29515 events. Should use `since: lastSeenTimestamp` in the subscription filter to avoid re-fetching events the phone already has. More impactful than NIP-40 expiration for performance.

- [ ] **App.tsx deep link errors silently swallowed** — `App.tsx:74-79` — `getCurrent()` and `onOpenUrl()` promise rejections are caught with empty `.catch(() => {})`. If deep link init fails, pairing via QR code won't work with no feedback.

## Future Protocol Improvement

- [ ] **Consider ephemeral event kind for real-time output** — Currently kind 4515 (regular/stored) is used for output events, which means relays store every output event and replay them all on reconnect (newest-first, requiring sorted insertion on the phone). A cleaner design: use an ephemeral kind (20000-29999) for the real-time stream so relays don't store it, and rely solely on the existing `history-request` pattern for catch-up. This would eliminate redundant replay, reduce relay storage, and remove the need for sorted insertion. Trade-off: breaking change to both sides of the protocol.
