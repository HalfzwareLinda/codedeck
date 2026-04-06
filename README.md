# CodeDeck

Multi-session agentic coding interface for Android and desktop, built with Tauri v2 (React 19 + Rust).

Control Claude Code sessions on your laptop from your phone over encrypted Nostr relays. Designed for the Google Pixel 9 Pro Fold inner display (landscape), but works on any Android device or desktop.

## Download

**[Download the latest CodeDeck for Android (APK)](https://github.com/HalfzwareLinda/codedeck/releases/latest)** — ~20 MB, arm64

Requirements: Android 7.0+, ARM64 device.

See all releases: [Releases](https://github.com/HalfzwareLinda/codedeck/releases)

## How It Works

Codedeck pairs with the [Codedeck Bridge](https://github.com/HalfzwareLinda/codedeck-bridge-vscode) VSCode extension. The bridge uses the **Claude Agent SDK** to spawn Claude Code as a subprocess with structured JSON communication — no terminal emulation. All communication between phone and bridge is **NIP-44 encrypted** over configurable Nostr relays.

```
Phone (Codedeck)  <── Nostr NIP-44 ──>  VSCode (Bridge Extension)
                                         │
                                         └── Claude Agent SDK → Claude Code subprocess
```

### Pairing

1. Install the [Codedeck Bridge](https://github.com/HalfzwareLinda/codedeck-bridge-vscode) extension in VSCode
2. Run **Codedeck: Pair Phone** from the command palette — a QR code appears
3. Scan the QR code with the Codedeck app — relay and Blossom config are applied automatically
4. Your Claude Code sessions appear on the phone in real-time

## Features

### Session Management
- Multiple concurrent Claude Code sessions across multiple machines
- Create, close, stop/interrupt, and monitor remote sessions from the phone
- Two-phase session creation with pending/ready lifecycle
- Sidebar with sessions grouped by machine, unread indicators, and input-needed dots
- Swipe-to-delete with undo toast, pull-to-refresh
- Crash recovery with automatic history catch-up on reconnect
- Session metadata toggle (hide/show version and summary lines)

### Interactive Cards
- **Plan approval** — Approve (auto-accept edits), approve (manual edits), or revise plans, with collapsible plan summaries
- **Permission requests** — Allow / Deny / Always for tool calls
- **Question cards** — Multi-choice and free-text answers to Claude's questions

### Modes and Effort
- Three permission modes: **Plan** (manual approval) / **Default** (auto-approve all) / **Accept Edits** — cycle from the session header
- Five effort levels: **Auto** / **Low** / **Medium** / **High** / **Max** — toggle per-session or set a default for new sessions

### Input and Output
- GitHub-flavored markdown rendering with syntax highlighting
- Virtualized output stream (react-window) with collapsible tool groups
- Image attachments via AES-256-GCM encrypted Blossom upload (base64 relay fallback)
- Speech-to-text voice dictation
- Push notifications for permission requests, plan approvals, and questions

### Encryption and Identity
- All bridge traffic NIP-44 encrypted (XChaCha20-Poly1305)
- API keys and GitHub PATs stored in Stronghold encrypted vault
- NIP-17 encrypted direct messaging
- Deep link pairing (`codedeck://pair?npub=...&relays=...&machine=...`)

### Reliability
- Bridge heartbeat every 60s with phone-side staleness detection (150s threshold)
- Per-session sequence counters for ordering and deduplication
- Exponential backoff reconnection (2s → 30s)
- Background relay plugin keeps the connection alive when the app is backgrounded on Android
- Memory-bounded buffers (500 entries/session, 1000 event dedup cap)

## Development

### Prerequisites

- Rust (1.70+)
- Node.js (18+)
- Tauri CLI: `cargo install tauri-cli --version "^2"`

### Commands

```bash
./dev.sh desktop        # Desktop dev mode with hot-reloading (http://localhost:1420)
./dev.sh frontend       # Frontend only in browser (mock mode, no Tauri)
./dev.sh android-build  # Build Android APK (aarch64)
./dev.sh android-dev    # Run on connected Android device
./dev.sh build          # Desktop release build
./dev.sh check          # TypeScript + Vite + Rust checks
npm test                # vitest
```

### Android APK (requires Android SDK + NDK)

```bash
cargo tauri android init
cargo tauri android build --apk --target aarch64
```

## Architecture

```
codedeck/
├── src/                        # React 19 frontend
│   ├── components/             # OutputStream, Sidebar, InputBar, SessionHeader, SettingsModal, etc.
│   ├── services/               # bridgeService (Nostr relay), nostrService (DMs), persistStore, notificationService
│   ├── stores/                 # Zustand stores (sessionStore, dmStore, uiStore)
│   ├── hooks/                  # useDisplayEntries, useSwipeToDelete, useSpeechRecognition, useMediaQuery
│   ├── ipc/                    # Tauri IPC bindings
│   └── styles/                 # Global CSS
├── src-tauri/                  # Rust backend
│   └── src/
│       ├── lib.rs              # Tauri commands + entry point
│       ├── session.rs          # Session manager + persistence
│       └── config.rs           # App configuration
└── dev.sh                      # Development script (env setup, build commands)
```

### Bridge Protocol

The phone and bridge communicate over Nostr using two event kinds:

| Kind | Type | Purpose |
|------|------|---------|
| 30515 | NIP-33 replaceable | Session list (heartbeat every 60s) |
| 4515 | Regular | Output stream, history, control messages |

All event content is NIP-44 encrypted. Output events carry per-session sequence counters for ordering and deduplication.

### Tauri Plugins

| Plugin | Purpose |
|--------|---------|
| `plugin-store` | Persistent key-value storage (machines, DMs, sessions) |
| `plugin-deep-link` | QR code pairing via `codedeck://` scheme |
| `plugin-notification` | Push notifications |
| `plugin-stronghold` | Encrypted secret storage (API keys, PATs) |
| `plugin-http` | HTTP requests (Blossom upload on Android) |
| `plugin-speech-recognizer` | Voice-to-text input (custom plugin) |
| `plugin-background-relay` | Keep relay alive when backgrounded (custom plugin) |

## Related

- [Codedeck Bridge VSCode Extension](https://github.com/HalfzwareLinda/codedeck-bridge-vscode) — Spawns Claude Code via the Agent SDK and relays sessions to this app over Nostr

## License

MIT
