# CodeDeck

Multi-session agentic coding interface for Android, built with Tauri v2 (React + Rust).

Designed for the Google Pixel 9 Pro Fold inner display (landscape), but works on desktop too.

## Download

**[Download CodeDeck v0.5.2 for Android (APK)](https://github.com/HalfzwareLinda/codedeck/releases/download/v0.5.2/CodeDeck-v0.5.2-android.apk)** — ~20 MB, arm64

Requirements: Android 7.0+, ARM64 device (Pixel 9 Pro Fold, etc.), Anthropic API key.

See all releases: [Releases](https://github.com/HalfzwareLinda/codedeck/releases)

## Features

- Multiple concurrent Claude Code agent sessions
- Sidebar navigation with grouped sessions
- PLAN mode (manual approval) and AUTO mode (auto-execute)
- **Plan approval cards**: Approve or reject Claude's plans directly from your phone
- **Question cards**: Answer Claude's multi-choice questions inline
- **GFM markdown rendering**: GitHub-flavored markdown with syntax highlighting
- Inline permission handling for tool calls
- Full agent loop: file read/write/edit, bash exec, grep, directory listing
- Persistent sessions and configuration
- Chat-style session view with collapsible tool groups
- Black & white OLED-friendly design
- **Remote bridge**: Control Claude Code sessions on your laptop from your phone via Nostr relays
- **Deep link pairing**: Scan a QR code from the [Codedeck Bridge](https://github.com/HalfzwareLinda/codedeck-bridge-vscode) VSCode extension to pair instantly (`codedeck://pair?npub=...&relays=...&machine=...`)
- **Create remote sessions**: Start new Claude Code sessions from the phone
- **Nostr DMs**: NIP-17 encrypted direct messaging between Nostr identities
- **Speech-to-text**: Voice dictation for hands-free input

## Development

### Prerequisites

- Rust (1.70+)
- Node.js (18+)
- Tauri CLI: `cargo install tauri-cli --version "^2"`

### Desktop Dev Mode

```bash
./dev.sh desktop
```

This starts the Tauri desktop app with hot-reloading.

### Frontend Only (Browser Mock Mode)

```bash
./dev.sh frontend
```

Opens the UI in a browser without Tauri backend. Sessions work in mock mode.

### Build Check

```bash
./dev.sh check
```

### Android APK (requires Android SDK + NDK)

```bash
cargo tauri android init
cargo tauri android build --apk --target aarch64
```

## Remote Bridge

Codedeck can control Claude Code sessions running on a remote machine via the [Codedeck Bridge](https://github.com/HalfzwareLinda/codedeck-bridge-vscode) VSCode extension. Communication uses NIP-44 encrypted Nostr events.

1. Install the Codedeck Bridge extension in VSCode
2. Run the **Codedeck: Pair Phone** command — a QR code appears
3. Scan the QR code with the Codedeck app (or enter the npub manually in Settings)
4. Your remote Claude Code sessions appear in the sidebar

## Architecture

```
codedeck/
├── src/                    # React frontend
│   ├── components/         # UI components
│   ├── services/           # bridgeService (Nostr relay), nostrService (DMs), persistStore
│   ├── stores/             # Zustand state management (sessionStore, dmStore, uiStore)
│   ├── hooks/              # Custom React hooks
│   └── styles/             # Global CSS
├── src-tauri/              # Rust backend
│   └── src/
│       ├── lib.rs          # Tauri commands + entry point
│       ├── session.rs      # Session manager + persistence
│       ├── agent.rs        # Anthropic API agent loop
│       └── config.rs       # App configuration
└── dev.sh                  # Development script
```

## Related

- [Codedeck Bridge VSCode Extension](https://github.com/HalfzwareLinda/codedeck-bridge-vscode) — Bridges Claude Code sessions to this app over Nostr

## License

MIT
