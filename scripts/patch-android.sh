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

# --- MainActivity.kt: add enableEdgeToEdge() + keyboard insets listener ---
if [ -f "$ACTIVITY" ]; then
  if ! grep -q 'enableEdgeToEdge' "$ACTIVITY"; then
    # Add imports
    sed -i '/^import android.os.Bundle/a import androidx.activity.enableEdgeToEdge\nimport androidx.core.view.ViewCompat\nimport androidx.core.view.WindowInsetsCompat' "$ACTIVITY"
    # Add enableEdgeToEdge() call before super.onCreate
    sed -i 's|super.onCreate(savedInstanceState)|enableEdgeToEdge()\n    super.onCreate(savedInstanceState)|' "$ACTIVITY"
    echo "✓ Patched MainActivity.kt: added enableEdgeToEdge()"
  else
    echo "· MainActivity.kt already has enableEdgeToEdge()"
  fi

  # Add keyboard insets listener (resizes WebView when keyboard appears)
  if ! grep -q 'WindowInsetsCompat.Type.ime' "$ACTIVITY"; then
    sed -i '/super.onCreate(savedInstanceState)/a \
\n    // Resize WebView when keyboard appears (enableEdgeToEdge disables adjustResize on API 30+)\
    val contentView = findViewById<android.view.View>(android.R.id.content)\
    ViewCompat.setOnApplyWindowInsetsListener(contentView) { view, insets ->\
      val imeHeight = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom\
      view.setPadding(0, 0, 0, imeHeight)\
      insets\
    }' "$ACTIVITY"
    echo "✓ Patched MainActivity.kt: added keyboard insets listener"
  else
    echo "· MainActivity.kt already has keyboard insets listener"
  fi
else
  echo "✗ MainActivity.kt not found at $ACTIVITY"
  exit 1
fi

echo "Done. Android patches applied."
