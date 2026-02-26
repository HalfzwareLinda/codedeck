#!/usr/bin/env bash
# Patches the generated Android project after `cargo tauri android init`.
# Run this whenever you regenerate src-tauri/gen/android/.
#
# Usage: ./scripts/patch-android.sh

set -euo pipefail

GEN_DIR="src-tauri/gen/android/app/src/main"
MANIFEST="$GEN_DIR/AndroidManifest.xml"
ACTIVITY="$GEN_DIR/java/com/codedeck/app/MainActivity.kt"

# --- AndroidManifest.xml: add windowSoftInputMode="adjustResize" ---
if [ -f "$MANIFEST" ]; then
  if ! grep -q 'windowSoftInputMode' "$MANIFEST"; then
    sed -i 's|android:configChanges=|android:windowSoftInputMode="adjustResize"\n            android:configChanges=|' "$MANIFEST"
    echo "✓ Patched AndroidManifest.xml: added windowSoftInputMode=\"adjustResize\""
  else
    echo "· AndroidManifest.xml already has windowSoftInputMode"
  fi
else
  echo "✗ AndroidManifest.xml not found at $MANIFEST"
  exit 1
fi

# --- MainActivity.kt: add enableEdgeToEdge() ---
if [ -f "$ACTIVITY" ]; then
  if ! grep -q 'enableEdgeToEdge' "$ACTIVITY"; then
    # Add import
    sed -i '/^import android.os.Bundle/a import androidx.activity.enableEdgeToEdge' "$ACTIVITY"
    # Add enableEdgeToEdge() call before super.onCreate
    sed -i 's|super.onCreate(savedInstanceState)|enableEdgeToEdge()\n    super.onCreate(savedInstanceState)|' "$ACTIVITY"
    echo "✓ Patched MainActivity.kt: added enableEdgeToEdge()"
  else
    echo "· MainActivity.kt already has enableEdgeToEdge()"
  fi
else
  echo "✗ MainActivity.kt not found at $ACTIVITY"
  exit 1
fi

echo "Done. Android patches applied."
