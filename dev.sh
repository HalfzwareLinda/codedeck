#!/bin/bash
# CodeDeck development script
# Usage: ./dev.sh [desktop|build|check|frontend]

set -e

# pkg-config workaround for Tauri dev packages
export PKG_CONFIG_PATH="/tmp/tauri-dev-pkgs/extracted/usr/lib/x86_64-linux-gnu/pkgconfig:/usr/lib/x86_64-linux-gnu/pkgconfig:/usr/share/pkgconfig"

cd "$(dirname "$0")"

case "${1:-desktop}" in
  desktop)
    echo "Starting CodeDeck in desktop dev mode..."
    echo "Frontend: http://localhost:1420"
    echo "Press Ctrl+C to stop"
    cargo tauri dev
    ;;
  build)
    echo "Building CodeDeck desktop release..."
    cargo tauri build
    ;;
  check)
    echo "Checking TypeScript..."
    npx tsc --noEmit
    echo "Building frontend..."
    npx vite build
    echo "Checking Rust..."
    cd src-tauri && cargo check
    echo "All checks passed!"
    ;;
  frontend)
    echo "Starting frontend only (mock mode, no Tauri)..."
    npx vite
    ;;
  *)
    echo "Usage: ./dev.sh [desktop|build|check|frontend]"
    echo ""
    echo "  desktop  - Run Tauri desktop dev mode (default)"
    echo "  build    - Build desktop release binary"
    echo "  check    - Run all compilation checks"
    echo "  frontend - Run frontend only in browser (mock mode)"
    exit 1
    ;;
esac
