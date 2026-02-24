# CodeDeck

Multi-session agentic coding interface for Android, built with Tauri v2 (React + Rust).

Designed for the Google Pixel 9 Pro Fold inner display (landscape), but works on desktop too.

## Features

- Multiple concurrent Claude Code agent sessions
- Sidebar navigation with grouped sessions
- PLAN mode (manual approval) and AUTO mode (auto-execute)
- Inline permission handling for tool calls
- Full agent loop: file read/write/edit, bash exec, grep, directory listing
- Persistent sessions and configuration
- Black & white OLED-friendly design

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

## Architecture

```
codedeck/
├── src/                    # React frontend
│   ├── components/         # UI components
│   ├── stores/             # Zustand state management
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

## License

MIT
