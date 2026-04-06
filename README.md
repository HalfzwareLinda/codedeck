# CodeDeck

Multi-session agentic coding interface for Android and desktop, built with Tauri v2 (React 19 + Rust).

Control Claude Code sessions on your laptop from your phone via Nostr relays. Designed for the Google Pixel 9 Pro Fold inner display (landscape), but works on any Android device or desktop.

## Download

**[Download the latest CodeDeck for Android (APK)](https://github.com/HalfzwareLinda/codedeck/releases/latest)** — ~20 MB, arm64

Requirements: Android 7.0+, ARM64 device.

See all releases: [Releases](https://github.com/HalfzwareLinda/codedeck/releases)

## How It Works

Codedeck pairs with the [Codedeck Bridge](https://github.com/HalfzwareLinda/codedeck-bridge-vscode) VSCode extension. The bridge uses the **Claude Agent SDK** to spawn Claude Code as a subprocess with structured JSON communication — no terminal emulation. All communication between phone and bridge is **NIP-44 encrypted** over configurable Nostr relays.

```
Phone (Codedeck)  ←── Nostr NIP-44 ──→  VSCode (Bridge Extension)
                                          │
                                          └── Claude Agent SDK → Claude Code subprocess
```

1. Install the Codedeck Bridge extension in VSCode
2. Run **Codedeck: Pair Phone** from the command palette — a QR code appears
3. Scan the QR code with the Codedeck app
4. Your Claude Code sessions appear on the phone in real-time

## Features

**Session management**
- Multiple concurrent Claude Code sessions across multiple machines
- Create, close, and interrupt remote sessions from the phone
- Two-phase session creation with pending/ready lifecycle
- Sidebar with grouped sessions, unread indicators, and input-needed dots
- Swipe-to-delete with undo, pull-to-refresh
- Crash recovery with automatic history catch-up on reconnect

**Interactive cards**
- **Plan approval**: Approve (auto-accept edits), approve (manual edits), or revise Claude's plans
- **Permission requests**: Allow/Deny/Always for tool calls, with per-domain allowlists for web tools
- **Question cards**: Multi-choice and free-text answers to Claude's questions

**Modes and effort**
- Three permission modes: Plan (manual approval) / Default (YOLO) / Accept Edits — cycle from session header
- Effort level control: Auto / Low / Medium / High / Max

**Input and output**
- GFM markdown rendering with syntax highlighting
- Virtualized output stream with collapsible tool groups
- Image attachments via encrypted Blossom upload (or base64 relay fallback)
- Speech-to-text voice dictation
- Push notifications for permission requests, plan approvals, and questions

**Other**
- NIP-17 encrypted direct messaging
- Black & white OLED-friendly design
- Deep link pairing (`codedeck://pair?npub=...&relays=...&machine=...`)

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
├── src/                    # React 19 frontend
│   ├── components/         # OutputStream, Sidebar, InputBar, SessionHeader, etc.
│   ├── services/           # bridgeService (Nostr relay), nostrService (DMs), persistStore
│   ├── stores/             # Zustand stores (sessionStore, dmStore, uiStore)
│   ├── hooks/              # useDisplayEntries, useSwipeToDelete, useSpeechRecognition
│   └── styles/             # Global CSS
├── src-tauri/              # Rust backend
│   └── src/
│       ├── lib.rs          # Tauri commands + entry point
│       ├── session.rs      # Session manager + persistence
│       └── config.rs       # App configuration
└── dev.sh                  # Development script (env setup, build commands)
```

### Bridge Protocol

The phone and bridge communicate over Nostr using two event kinds:

| Kind | Type | Purpose |
|------|------|---------|
| 30515 | NIP-33 replaceable | Session list (heartbeat every 60s) |
| 4515 | Regular | Output stream, history, control messages |

All event content is NIP-44 encrypted. Output events carry per-session sequence counters for ordering and deduplication.

## Related

- [Codedeck Bridge VSCode Extension](https://github.com/HalfzwareLinda/codedeck-bridge-vscode) — Spawns Claude Code via the Agent SDK and relays sessions to this app over Nostr

## License

MIT
