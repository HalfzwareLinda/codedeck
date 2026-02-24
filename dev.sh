#!/bin/bash
# CodeDeck development script
# Usage: ./dev.sh [desktop|build|check|frontend|android-build|android-dev]

set -e

# pkg-config workaround for Tauri dev packages (if system-wide -dev packages not installed)
if [ -d "/tmp/tauri-dev-pkgs/extracted/usr/lib/x86_64-linux-gnu/pkgconfig" ]; then
  export PKG_CONFIG_PATH="/tmp/tauri-dev-pkgs/extracted/usr/lib/x86_64-linux-gnu/pkgconfig:/usr/lib/x86_64-linux-gnu/pkgconfig:/usr/share/pkgconfig"
fi

# Android SDK/NDK
export ANDROID_HOME="/home/jeroen/Android/Sdk"
export NDK_HOME="$ANDROID_HOME/ndk/27.2.12479018"

# Java (SDKMAN)
export JAVA_HOME="/home/jeroen/.sdkman/candidates/java/current"
export PATH="$JAVA_HOME/bin:$PATH"

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
    echo "Open http://localhost:1420 in a browser"
    npx vite
    ;;
  android-build)
    echo "Building CodeDeck Android APK (aarch64)..."
    cargo tauri android build --apk --target aarch64
    echo ""
    echo "APK output: src-tauri/gen/android/app/build/outputs/apk/"
    ;;
  android-dev)
    echo "Starting CodeDeck on connected Android device..."
    echo "Make sure a device is connected via USB with debugging enabled"
    cargo tauri android dev
    ;;
  *)
    echo "Usage: ./dev.sh [command]"
    echo ""
    echo "  desktop       - Run Tauri desktop dev mode (default)"
    echo "  build         - Build desktop release binary"
    echo "  check         - Run all compilation checks"
    echo "  frontend      - Run frontend only in browser (mock mode)"
    echo "  android-build - Build Android APK (aarch64)"
    echo "  android-dev   - Run on connected Android device via USB"
    exit 1
    ;;
esac
