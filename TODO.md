# Codedeck TODO

## Known Bugs (from static analysis 2026-03-01)

- [ ] **processGiftWrap swallows exceptions silently** — `nostrService.ts:169` — NIP-17 gift-wrap decryption failures return `null` with minimal logging, making DM debugging hard. Added `console.warn` but could surface to UI.

- [ ] **Seq counters reset on bridge extension restart** — Both `sessionWatcher.ts:244` and `nostrRelay.ts:174` start seq at 0 on restart. Phone may receive duplicate entries after a bridge restart. Fix: persist seq counters in `context.globalState` or derive from loaded history.

- [ ] **sendToClaudeTerminal ignores sessionId** — `terminalBridge.ts:29-47` — Input from phone always goes to the first Claude terminal found, regardless of which session it targets. With multiple concurrent sessions, input goes to the wrong one. Fix: implement session-to-terminal mapping.

- [ ] **SettingsModal API key test has no timeout** — `SettingsModal.tsx:43-60` — `handleTestApiKey()` calls `api.testApiKey()` with no timeout mechanism. If the network hangs, the UI shows "Testing..." indefinitely.

- [ ] **App.tsx deep link errors silently swallowed** — `App.tsx:74-79` — `getCurrent()` and `onOpenUrl()` promise rejections are caught with empty `.catch(() => {})`. If deep link init fails, pairing via QR code won't work with no feedback.
