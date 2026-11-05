#!/bin/sh
set -eu
cd "$(dirname "$0")"
if [ -n "${NATIVE_UI_SDK:-}" ]; then
  SDK="$NATIVE_UI_SDK"
elif [ -d /Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk ]; then
  SDK=/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk
else
  SDK="$(xcrun --sdk macosx --show-sdk-path)"
fi
mkdir -p GrokNativePanel.app/Contents/MacOS
cp Info.plist GrokNativePanel.app/Contents/Info.plist
BUILD_DIR="$(mktemp -d)"
trap 'rm -rf "$BUILD_DIR"' EXIT
cat NativeUI.swift SettingsView.swift > "$BUILD_DIR/main.swift"
xcrun swiftc -sdk "$SDK" -O -target arm64-apple-macosx13.0 "$BUILD_DIR/main.swift" -o GrokNativePanel.app/Contents/MacOS/GrokNativePanel
