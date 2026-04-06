# Codedeck

Multi-session agentic coding interface — a Tauri v2 app (React 19 + Rust) for managing Claude Code sessions on mobile and desktop.

## Quick Start

```bash
./dev.sh desktop     # Desktop dev mode (http://localhost:1420)
./dev.sh frontend    # Frontend only in browser (mock mode, no Tauri)
./dev.sh android-build  # Build Android APK (aarch64)
./dev.sh check       # TypeScript + Vite + Rust checks
npm test             # Run vitest tests
```

## Architecture

- **Frontend**: React 19 + TypeScript + Vite, state via Zustand
- **Backend**: Rust (Tauri v2), handles local Claude Code session management
- **Nostr**: `nostr-tools` for NIP-44 encrypted bridge communication
- **Rendering**: `react-window` for virtualized output stream, `react-markdown` for content

### Key Directories

- `src/components/` — React components (Sidebar, OutputStream, InputBar, PermissionBar, etc.)
- `src/services/` — bridgeService (Nostr relay client), nostrService
- `src/stores/` — Zustand stores (sessionStore)
- `src/hooks/` — Custom React hooks
- `src/ipc/` — Tauri IPC bindings
- `src/types.ts` — All TypeScript types including bridge protocol types
- `src-tauri/` — Rust backend

### Bridge Protocol (Phone ↔ VSCode Extension)

Codedeck communicates with the `codedeck-bridge-vscode` extension over Nostr relays:
- Session list: NIP-33 replaceable events (kind 30515)
- Output stream: Regular events (kind 29515) with seq counter
- Input/permissions: Regular events (kind 29515), NIP-44 encrypted
- History: Request/response pattern for catch-up on connect

See `src/services/bridgeService.ts` and `src/types.ts` for protocol types.

## Related Repo

- `codedeck-bridge-vscode/` — VSCode extension that uses the Claude Agent SDK to spawn Claude Code subprocesses and relays over Nostr
- GitHub: `HalfzwareLinda/codedeck-bridge-vscode`

## Conventions

- Workspace path has spaces — always quote paths in bash
- Android SDK at `/home/jeroen/Android/Sdk`, Java via SDKMAN
- `dev.sh` handles all environment setup (PKG_CONFIG_PATH, ANDROID_HOME, JAVA_HOME)
