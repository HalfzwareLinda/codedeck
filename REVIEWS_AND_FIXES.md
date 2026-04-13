# Codedeck Reviews and Fixes

Consolidated findings from four independent reviews of Codedeck (Tauri v2 app) and Codedeck Bridge (VSCode extension). Covers efficiency, security, and UX — with every finding traced to specific files and lines.

---

## Table of Contents

1. [Efficiency Optimization](#1-efficiency-optimization)
2. [Security Audit (Consolidated)](#2-security-audit-consolidated)
3. [Security Audit (Authentication & Hardening)](#3-security-audit-authentication--hardening)
4. [UX Review](#4-ux-review)

---

## 1. Efficiency Optimization

*Source: serialized-growing-moore.md — 25 efficiency issues across data structures, unnecessary work, memory leaks, Nostr protocol usage, React rendering, and build configuration.*

### Group 1: Data Structure Replacements (Bridge)

#### Step 1.1 — Replace output queue with circular buffer
**Files:** `codedeck-bridge-vscode/src/nostrRelay.ts`
**Problem:** `outputQueue` uses `Array.splice(0, n)` for overflow (line 425) and flush dequeue (line 489) — both O(n).
**Fix:** Create a `CircularBuffer<T>` class backed by a fixed-size array with head/tail indices. Must support: `push()`, `shift()`, `drain(n)`, `unshift()`, `length`. Capacity = `MAX_OUTPUT_QUEUE_SIZE` (500).

#### Step 1.2 — Cache stringified sizes in splitIfOversized
**Files:** `codedeck-bridge-vscode/src/nostrRelay.ts`
**Problem:** `splitIfOversized` (line 824-835) calls `JSON.stringify(chunk)` at each recursion level = O(n²) total.
**Fix:** Compute `JSON.stringify(entry).length` once per entry. Pass a parallel sizes array with prefix sums for O(1) range checks.

#### Step 1.3 — Use generation-swap bounded Set for processedEventIds
**Files:** `codedeck-bridge-vscode/src/nostrRelay.ts`
**Problem:** `processedEventIds` Set (line 847-854) prunes one entry at a time using iteration-order first (not oldest).
**Fix:** Replace with two-generation Set approach: `current` and `previous`. When `current.size > MAX/2`, swap.

#### Step 1.4 — Replace history array with circular buffer in SdkSession
**Files:** `codedeck-bridge-vscode/src/sdkSession.ts`
**Problem:** History capping (line 600-603) uses `slice(-500)` on every overflow — O(n) array copy.
**Fix:** Replace with circular buffer of capacity 500 supporting ordered iteration.

#### Step 1.5 — Batch-prune answeredQuestions Set
**Files:** `codedeck-bridge-vscode/src/sdkSession.ts`
**Problem:** `answeredQuestions` prunes only 1 entry when >50 (line 256-259).
**Fix:** When size > 50, delete the oldest 25 entries. Reduces pruning frequency by 25x.

### Group 2: Unnecessary Work / Polling (Bridge)

#### Step 2.1 — Only persist timestamp on change
**Files:** `codedeck-bridge-vscode/src/extension.ts`
**Problem:** 30s interval (line 277-283) persists `lastSeenTimestamp` unconditionally.
**Fix:** Track `lastPersistedTs`, skip persist if unchanged.

#### Step 2.2 — Track dirty flag for heartbeat session list
**Files:** `codedeck-bridge-vscode/src/extension.ts`
**Problem:** 60s heartbeat (line 286-293) publishes full session list even when unchanged.
**Fix:** Add `sessionListDirty` flag. Max-staleness fallback: publish at least every 5 minutes.

#### Step 2.3 — Add relay equality check before reconnecting
**Files:** `codedeck-bridge-vscode/src/nostrRelay.ts`
**Problem:** `updateRelays()` unconditionally reconnects even when relays haven't changed.
**Fix:** Compare sorted new relays against current. Return early if equal.

#### Step 2.4 — Replace custom hex helpers with Buffer methods
**Files:** `codedeck-bridge-vscode/src/pairing.ts`
**Problem:** Custom `hexToBytes`/`bytesToHex` (line 211-221) are slower than native `Buffer` methods.
**Fix:** Replace with `Buffer.from(hex, 'hex')` and `Buffer.from(bytes).toString('hex')`.

### Group 3: Memory Leaks / Unbounded Growth (Codedeck App)

#### Step 3.1 — Prune bridgeService Maps on machine disconnect
**Files:** `codedeck/src/services/bridgeService.ts`
**Problem:** `lastSeenTimestamps`, `lastSessionListTimestamps`, `consecutiveDecryptFailures` grow indefinitely.
**Fix:** Delete the machine's pubkey from all three Maps in `disconnectFromMachine()`.

#### Step 3.2 — Switch sentRumorIds to lazy cleanup
**Files:** `codedeck/src/services/nostrService.ts`
**Problem:** 5-minute interval runs even when idle just to clean `sentRumorIds`.
**Fix:** Remove interval. On each `set()`, if `size > 100`, delete entries older than 10 minutes.

#### Step 3.3 — Self-cleaning recentNotifications Map
**Files:** `codedeck/src/services/notificationService.ts`
**Problem:** `recentNotifications` Map only prunes at size > 50.
**Fix:** Delete expired entries on lookup.

#### Step 3.4 — Remove redundant stale cleanup interval for pending sessions
**Files:** `codedeck/src/stores/sessionStore.ts`
**Problem:** Dual cleanup: per-session `setTimeout` AND a 30s global `setInterval`. Redundant.
**Fix:** Remove the `staleCleanupInterval`.

#### Step 3.5 — Index-based circular buffer for debugLog
**Files:** `codedeck/src/services/debugLog.ts`
**Problem:** `entries.shift()` is O(n) for n=200. `snapshot = [...entries]` copies on every log.
**Fix:** Use fixed-size array with head/count indices. Only create snapshot on read.

### Group 4: Nostr Protocol Optimizations

#### Step 4.1 — Cache NIP-44 conversation keys per machine
**Files:** `codedeck/src/services/bridgeService.ts`
**Problem:** `getConversationKey()` (ECDH + HKDF) recomputed on every `publishToMachine` call.
**Fix:** Cache per machine pubkey. Clear on disconnect or keypair change.

#### Step 4.2 — Remove SESSION_LIST_EVENT_KIND from bridge subscription
**Files:** `codedeck-bridge-vscode/src/nostrRelay.ts`
**Problem:** Bridge subscribes to session list events but is the publisher — never needs to receive them.
**Fix:** Remove from subscription filter.

#### Step 4.3 — Reduce NIP-59 grace window in dmStore
**Files:** `codedeck/src/stores/dmStore.ts`
**Problem:** 48-hour grace window causes massive historical replay on reconnect.
**Fix:** Reduce to 24 hours (still catches 99%+ of messages). Document trade-off.

### Group 5: React Rendering Optimizations (Codedeck App)

#### Step 5.1 — Wrap OutputStream entry components in React.memo
**Files:** `codedeck/src/components/OutputStream.tsx`
**Problem:** Plain function components re-render on every parent re-render, triggering markdown re-parsing.
**Fix:** Wrap with `React.memo()`. Add `useCallback` for callback props.

#### Step 5.2 — Hoist regex patterns to module-level constants
**Files:** `codedeck/src/components/OutputStream.tsx`
**Problem:** `isFreeTextOption()` compiles regex patterns inline on every call.
**Fix:** Extract to module-level `const` declarations.

#### Step 5.3 — Clean up setTimeout calls on unmount in InputBar
**Files:** `codedeck/src/components/InputBar.tsx`
**Problem:** `setTimeout` calls for UI cooldowns lack cleanup on unmount.
**Fix:** Store timeout IDs in `useRef`, clear in `useEffect` cleanup.

#### Step 5.4 — requestAnimationFrame for pull-to-refresh indicator
**Files:** `codedeck/src/components/Sidebar.tsx`
**Problem:** `updateIndicator` directly mutates DOM on every touch move = layout thrashing.
**Fix:** Wrap in `requestAnimationFrame` with `rafPending` guard.

### Group 6: Zustand Store Optimizations (Codedeck App)

#### Step 6.1 — Track maxSeq alongside seenBridgeSeqs
**Files:** `codedeck/src/stores/sessionStore.ts`
**Problem:** `seenBridgeSeqs` pruning iterates entire Set to find maxSeq, then iterates again to prune.
**Fix:** Track `maxSeq` alongside the Set. Pruning becomes single-pass.

#### Step 6.2 — Parallelize profile resolution in dmStore
**Files:** `codedeck/src/stores/dmStore.ts`
**Problem:** `resolveAllProfiles` calls relay fetches sequentially per conversation.
**Fix:** `Promise.allSettled()` with concurrency limit of 5.

#### Step 6.3 — Single-pass dedup in dmStore.addMessage
**Files:** `codedeck/src/stores/dmStore.ts`
**Problem:** `addMessage` does 3 separate scans: ID dedup, content dedup, conversation lookup.
**Fix:** Combine into single loop, break early on match.

### Group 7: Build & Dependency Optimizations

#### Step 7.1 — Add Vite build optimization config
**Files:** `codedeck/vite.config.ts`
**Problem:** Zero build optimization in config. No code splitting.
**Fix:** Add `manualChunks` splitting markdown/nostr vendors, `target: 'es2022'`, `sourcemap: false` for prod.

#### Step 7.2 — Fix bridge package.json dependency classification
**Files:** `codedeck-bridge-vscode/package.json`
**Problem:** `nostr-tools` and `qrcode-svg` in `devDependencies` but used at runtime.
**Fix:** Move to `dependencies`.

#### Step 7.3 — Add stricter TypeScript options to bridge tsconfig
**Files:** `codedeck-bridge-vscode/tsconfig.json`
**Fix:** Add `noUnusedLocals` and `noUnusedParameters`. Prefix unused params with `_`.

#### Step 7.4 — Add Cargo release profile + narrow tokio features
**Files:** `codedeck/src-tauri/Cargo.toml`
**Fix:** Add `[profile.release]` with `lto = true`, `codegen-units = 1`, `strip = "symbols"`. Narrow tokio features.

#### Step 7.5 — Lazy-load react-markdown (CD-008 related)
**Files:** `codedeck/src/components/OutputStream.tsx`
**Problem:** `react-markdown` + `rehype-highlight` (~150KB+) imported eagerly.
**Fix:** `React.lazy()` + dynamic import with plain text fallback.

---

## 2. Security Audit (Consolidated)

*Source: distributed-wandering-taco.md — 32 findings across 4 severity levels.*

### CRITICAL

#### SEC-01: Stronghold encrypted vault (not unencrypted store)
**File:** `codedeck/src-tauri/src/lib.rs:20-46`
**Problem:** `stronghold_get/set` use `client.store()` (unencrypted key-value store). API keys and GitHub PATs stored in plaintext.
**Fix:** Replace with `client.vault()` + `RecordPath` for encrypted storage using Argon2-derived key.

#### SEC-02: Move bridge secret key to VSCode SecretStorage
**File:** `codedeck-bridge-vscode/src/pairing.ts:201-209`
**Problem:** Bridge's Nostr private key stored as hex in `context.globalState` — plaintext JSON on disk. May sync to cloud.
**Fix:** Use `context.secrets.get/store()` (OS keychain). Add one-time migration from globalState.

#### SEC-03: Session ownership validation on all inbound messages
**Files:** `codedeck-bridge-vscode/src/nostrRelay.ts`, `core.ts`, `sdkSession.ts`
**Problem:** Any paired phone can send commands for ANY session — no ownership validation.
**Fix:** Track `creatorPubkey` per session. Validate on every inbound message handler.

### HIGH

#### SEC-04: Stop persisting Nostr private key in plaintext
**File:** `codedeck/src/stores/dmStore.ts:76, 275`
**Problem:** `nostrConfig.private_key_hex` persisted to `codedeck-data.json` in plaintext.
**Fix:** Move to Stronghold. Persist only public key in JSON.

#### SEC-05: Don't expose secrets in FullConfig IPC
**File:** `codedeck/src-tauri/src/config.rs:59-106`
**Problem:** `get_config()` returns plaintext API keys to frontend JavaScript.
**Fix:** Split into `SafeConfig` with `has_anthropic_key: bool` flags.

#### SEC-06: Enforce WSS-only relay connections
**Files:** `codedeck/src/App.tsx:38`, `SettingsModal.tsx:140`
**Problem:** `ws://` (unencrypted WebSocket) accepted. MITM risk.
**Fix:** Reject `ws://` except `ws://localhost` for dev.

#### SEC-07: Deep link pairing confirmation dialog
**File:** `codedeck/src/App.tsx:24-69`
**Problem:** `handleDeepLink()` calls `addMachine()` immediately with no confirmation.
**Fix:** Show confirmation modal before pairing. Add relay URL length validation.

#### SEC-08: Path traversal guard for image uploads
**File:** `codedeck-bridge-vscode/src/core.ts:373-383`
**Problem:** No final path containment check after `path.join()`.
**Fix:** Add `path.resolve()` containment check + `totalChunks <= 100` limit.

### MEDIUM

#### SEC-09: Restrict CSP connect-src
**File:** `codedeck/src-tauri/tauri.conf.json:23`
**Problem:** `connect-src https: wss:` allows connections to ANY endpoint.
**Fix:** Explicit allowlist for known domains.

#### SEC-10: Per-phone rate limiting on bridge inbound events
**File:** `codedeck-bridge-vscode/src/nostrRelay.ts`
**Problem:** No rate limiting. Compromised phone can DoS the bridge.
**Fix:** Sliding-window rate limiter: max 20 events/second per pubkey.

#### SEC-11: Color-code permission cards by danger level
**File:** `codedeck/src/components/PermissionBar.tsx`
**Problem:** All permission cards look identical regardless of danger.
**Fix:** Green (Read), yellow (Edit/Write/Git), red (Bash). 2-second hold for red.

#### SEC-12: Redact sensitive content in notifications
**File:** `codedeck/src/services/notificationService.ts`
**Fix:** Generic notification text: "Action requires your approval". Details only in-app.

#### SEC-13: Input length validation
**File:** `codedeck/src/components/InputBar.tsx`
**Fix:** `maxLength={50000}`, character count > 40000, reject > 50000.

#### SEC-14: Speech recognition privacy warning
**File:** `codedeck/src/hooks/useSpeechRecognition.ts`
**Fix:** One-time dialog about cloud audio processing.

#### SEC-15: Credential redaction in bridge logs
**Files:** Throughout `codedeck-bridge-vscode/src/`
**Fix:** `redact()` utility masking hex > 32 chars, Bearer tokens, `sk-*` keys, `nsec1*` keys.

### LOW

#### SEC-16: Validate pubkey on manual pairing
**File:** `codedeck-bridge-vscode/src/extension.ts`
**Fix:** Validate 32-byte hex after `nip19.decode()`.

#### SEC-17: Blossom fetch URL validation and timeout
**File:** `codedeck-bridge-vscode/src/core.ts:350-357`
**Fix:** Reject non-HTTPS URLs, 30s timeout, 10MB body limit.

#### SEC-18: Profile cache expiration in DM store
**File:** `codedeck/src/stores/dmStore.ts:313-316`
**Fix:** Hourly cleanup removing entries older than 7 days.

---

## 3. Security Audit (Authentication & Hardening)

*Source: zany-gliding-tower.md — 18 findings focused on authentication, event verification, and mobile hardening.*

### TIER 1: CRITICAL

#### AUTH-01: Add Nostr event signature verification
**Files:** `codedeck-bridge-vscode/src/nostrRelay.ts:837-861`
**Problem:** Events checked only by pubkey string match — never cryptographically verified. Forging possible on shared relays.
**Fix:** Import `verifyEvent` from `nostr-tools/pure`. Verify before pubkey lookup.

#### AUTH-02: Change default permission mode from YOLO to plan
**Files:** `codedeck-bridge-vscode/src/sdkSession.ts:716-721`
**Problem:** Default mode returns `{ behavior: 'allow' }` for ALL tools including Bash. Compromised phone = full RCE.
**Fix:** Default to `'plan'` mode. Add `DANGEROUS_TOOLS` set that always prompts.

#### AUTH-03: Path traversal protection in image upload
*(Overlaps with SEC-08)*
**Files:** `codedeck-bridge-vscode/src/core.ts:373-383`
**Fix:** `path.resolve()` containment check after `path.join()`.

#### AUTH-04: Timestamp-based event deduplication
**Files:** `codedeck-bridge-vscode/src/nostrRelay.ts:845-854`
**Problem:** Only 1000 IDs tracked. Events replayed after Set rolls over.
**Fix:** Replace Set with Map (id → created_at). Evict entries > 1 hour. Tighten freshness to 60s.

#### AUTH-05: Prevent secret persistence in browser fallback
**Files:** `codedeck/src/services/persistStore.ts`, `dmStore.ts`
**Fix:** Strip secrets before localStorage writes in non-Tauri mode.

#### AUTH-06: Move Nostr private key to Stronghold
*(Overlaps with SEC-04)*

#### AUTH-07: Tighten HTTP capability and CSP
*(Overlaps with SEC-09)*

#### AUTH-08: Deep link validation + confirmation + QR expiry
**Files:** `codedeck/src/App.tsx`, `codedeck-bridge-vscode/src/pairing.ts`
**Problem:** No confirmation, no nonce, no expiry. QR codes reusable forever.
**Fix:** Add UUID nonce + 10-min expiry to QR. Confirmation dialog. Track used nonces.

### TIER 2: HIGH

#### AUTH-09: Session ID validation + per-phone rate limiting
**Files:** `codedeck-bridge-vscode/src/nostrRelay.ts`, `core.ts`
**Fix:** UUID v4 validation on all sessionIds. Per-phone rate limiter: max 60 events/min.

#### AUTH-10: Session metadata JSON validation + Blossom size limit
**Files:** `codedeck-bridge-vscode/src/sdkSession.ts:203-204`, `core.ts:349-357`
**Fix:** Strict schema on metadata (topic ≤50 chars, project ≤50 chars). 100MB Blossom limit.

#### AUTH-11: Blossom auth expiry reduction + rumor dedup cap
**Files:** `codedeck/src/utils/blossomUpload.ts:69`, `nostrService.ts:18-31`
**Fix:** Reduce auth window from 300s to 60s. Cap `sentRumorIds` at 5000.

#### AUTH-12: Reconnection race condition fix
**Files:** `codedeck/src/App.tsx:106-126`, `sessionStore.ts`, `InputBar.tsx`
**Fix:** Add `reconnecting` state. Disable input during reconnect.

#### AUTH-13: Signing config validation + network security config
**Files:** `codedeck/src-tauri/gen/android/app/build.gradle.kts`
**Fix:** Fail release build if keystore missing. Add `network_security_config.xml` with `cleartextTrafficPermitted="false"`.

### TIER 3: MEDIUM

#### AUTH-14: Key rotation prompt
**Files:** `codedeck-bridge-vscode/src/extension.ts:35-44`
**Fix:** Prompt key rotation after 30 days.

#### AUTH-15: Config file permissions + Stronghold comment fix
**Files:** `codedeck/src-tauri/src/lib.rs:20-46`
**Fix:** `#[cfg(unix)]` set config dir to 0o700, files to 0o600.

#### AUTH-16: Relay URL validation + content dedup tightening
**Files:** `codedeck/src/components/SettingsModal.tsx:140`, `dmStore.ts:13`
**Fix:** Reject private IPs for relays. Reduce content dedup from 60s to 10s.

#### AUTH-17: Notification privacy + speech disclosure + manifest restrictions
**Files:** `notificationService.ts`, `useSpeechRecognition.ts`, `AndroidManifest.xml`
**Fix:** Generic notification text. Speech privacy notice. Restrict deep link intent filter.

#### AUTH-18: Mutual authentication (challenge-response)
**Files:** `nostrRelay.ts`, `types.ts`, `bridgeService.ts`
**Fix:** Bridge sends 32-byte nonce challenge on reconnect. Phone signs with Nostr key.

---

## 4. UX Review

*Source: crispy-zooming-dusk.md — 30 findings across silent failures, missing feedback, accessibility, design system gaps, and performance.*

### A. Critical: Silent Failures That Break User Trust

| # | Issue | Location | Impact |
|---|-------|----------|--------|
| A1 | **Optimistic message display before bridge ACK** | `sessionStore.ts:501-551` | User thinks message was sent |
| A2 | **Permission response cleared from unread before send** | `sessionStore.ts:1546-1558` | Agent stalls, no indication |
| A3 | **Session deletion send failure unhandled** | `sessionStore.ts:1410-1497` | Zombie session on bridge |
| A4 | **Session appears ready before SDK initializes** | `core.ts:144-189`, `sdkSession.ts:543-551` | Input silently queued |
| A5 | **Mode change unverified** | `sdkSession.ts:318-331` | Phone shows wrong mode |

### B. High: Missing User Feedback

| # | Issue | Location | Impact |
|---|-------|----------|--------|
| B1 | **History loading has no progress indicator** | `sessionStore.ts:924-943` | User sees blank session |
| B2 | **History idle timeout silently truncates** | `sessionStore.ts:1020-1074` | Partial history, no indication |
| B3 | **Decryption failures → silent disconnect** | `bridgeService.ts:574-584` | User sees "offline" but bridge is running |
| B4 | **DM gift wrap failures silently dropped** | `nostrService.ts:268-304` | User thinks nobody messaged |
| B5 | **Refresh timeout gives false "complete"** | `sessionStore.ts:1380-1399` | User thinks refresh worked |
| B6 | **Output queue overflow drops entries silently** | `nostrRelay.ts:421-440` | Misleading error message |

### C. Medium: Accessibility & Inclusivity

| # | Issue | Location | Impact |
|---|-------|----------|--------|
| C1 | **Muted text fails WCAG AA** | `global.css:13, 5` | ~3.9:1 contrast (needs 4.5:1) |
| C2 | **No visible focus rings on most buttons** | `modal.css:143-145` (only place) | Keyboard nav unusable |
| C3 | **All font sizes in px** | Throughout CSS | No rem/em scaling |
| C4 | **Hardcoded language `en-US`** | `useSpeechRecognition.ts:202` | Non-English voice blocked |
| C5 | **Hardcoded TTS strings** | `useVoiceMode.ts:139, 154+` | No localization |

### D. Medium: Design System Gaps

| # | Issue | Location |
|---|-------|----------|
| D1 | **Hardcoded colors outside CSS variables** | `output.css:462`, `sidebar.css:152`, etc. |
| D2 | **No spacing scale** | Throughout |
| D3 | **Inconsistent button sizes** (28/32/48/56px) | `header.css`, `input.css`, etc. |
| D4 | **Inconsistent border-radius** | Multiple files |
| D5 | **Z-index unmanaged** — modal and toast both 200 | `modal.css:8`, `sidebar.css:297` |
| D6 | **Sidebar width mismatch** — CSS 260px vs JS 280px | `global.css:44` vs `App.tsx:184` |
| D7 | **Textarea heights duplicated** in JS and CSS | `InputBar.tsx:102-103`, `input.css:68-69` |
| D8 | **DM mono font different from global** | `dm.css:73` |

### E. Low: Performance & Edge Cases

| # | Issue | Location |
|---|-------|----------|
| E1 | **Output throttle effective rate ~3.5/s** | `nostrRelay.ts:81-83` |
| E2 | **Session list publish blocks output for up to 5s** | `nostrRelay.ts:314-326` |
| E3 | **Max 2 restart attempts** — flaky network kills session | `sdkSession.ts:129` |
| E4 | **Seq dedup pruning can lose old seqs** | `sessionStore.ts:407-418` |
| E5 | **Output buffer hard-capped at 5000** | `sessionStore.ts:344-430` |
| E6 | **SettingsModal uses 14 useState hooks** | `SettingsModal.tsx` |
| E7 | **Dead code: auto-approve holdoff** | `nostrRelay.ts:455` |
| E8 | **Permission timeout 5 minutes, no indicator** | `sdkSession.ts:130` |

### UX Fix Plan (Ordered Steps)

1. **Fix Silent Permission Response Failure (A2)** — Move `clearUnread` to after successful send. Re-show card on failure.
2. **Add "Failed" State to Sent Messages (A1)** — Add `status: 'sent' | 'failed'` to user messages. Style failed messages with retry icon.
3. **Fix Sidebar Width Mismatch (D6)** — Replace hardcoded 280px with `var(--sidebar-width)`.
4. **Fix Muted Text Contrast (C1)** — Change `--text-muted` to #777777 (~5.2:1 ratio).
5. **Add Focus-Visible Rings Globally (C2)** — Global `:focus-visible` rule.
6. **Consolidate Hardcoded Colors (D1)** — Add `--color-success`, `--color-warning`, `--color-info` variables.
7. **Fix DM Mono Font (D8)** — Replace raw font-family with `var(--font-mono)`.
8. **Unify Textarea Height Source of Truth (D7)** — CSS variables for both JS and CSS.
9. **Add Border-Radius Consistency (D4)** — Map all values to `--radius-sm/md/lg`.
10. **Add Reconnection Context to Decrypt Failures (B3)** — Show "Key mismatch — re-pair this machine".
11. **Add History Loading Progress (B1, B2)** — Show chunk progress, increase timeout, warn on truncation.
12. **Handle Session Deletion Failure (A3)** — Restore session on send failure.
13. **Fix Session-Ready Timing (A4)** — Wait for SDK init before publishing `session-ready`.
14. **Add Z-Index Documentation (D5)** — CSS variable scale, bump toast above modal.
15. **Clean Up Dead Auto-Approve Holdoff (E7)** — Remove or wire up.
16. **Improve Refresh Failure Feedback (B5)** — Show "Refresh timed out" instead of silent stop.
17. **Add Spacing Scale Variables (D2)** — Define `--space-*` tokens.

---

## Cross-Cutting Verification

After implementing any group of fixes:

```bash
cd "codedeck-bridge-vscode" && npm test        # Bridge unit tests
cd "codedeck" && npm test                       # App unit tests
cd "codedeck" && ./dev.sh check                 # TS + Vite + Rust
cd "codedeck-bridge-vscode" && npm run typecheck  # tsc --noEmit
```

**End-to-end:** Pair phone → create session → send input → verify output → test permissions → test DMs → test history catch-up.

## Overlap Notes

Several findings appear in multiple audits (noted with cross-references):
- **Path traversal** (SEC-08 / AUTH-03) — identical finding
- **Nostr private key in plaintext** (SEC-04 / AUTH-06) — identical finding
- **CSP tightening** (SEC-09 / AUTH-07) — identical finding
- **Deep link confirmation** (SEC-07 / AUTH-08) — AUTH-08 adds nonce + expiry
- **Rate limiting** (SEC-10 / AUTH-09) — different thresholds, use the stricter

When implementing, deduplicate overlapping fixes and use the most thorough version.
