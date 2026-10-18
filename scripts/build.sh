#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DESTINATION="$ROOT/dist/Meadow.app"
BUILD="$ROOT/.build"
STAGING="$(mktemp -d "${TMPDIR:-/tmp}/meadow-build.XXXXXX")"
APP="$STAGING/Meadow.app"
trap 'rm -rf "$STAGING"' EXIT

if ! command -v swiftc >/dev/null 2>&1; then
  echo "需要 Apple Command Line Tools。请先运行 xcode-select --install。" >&2
  exit 1
fi
if [ ! -f "$ROOT/web/index.html" ]; then
  echo "缺少 web/index.html，无法打包。" >&2
  exit 1
fi

if [ ! -f "$ROOT/web/game-assets/img/spring_outdoorsTileSheet.png" ] || \
   [ ! -f "$ROOT/web/game-assets/img/houses.png" ] || \
   [ ! -f "$ROOT/web/game-assets/img/cursors.png" ] || \
   [ ! -f "$ROOT/web/game-assets/ui/panel.png" ] || \
   [ ! -f "$ROOT/web/game-assets/ui/chicken.png" ] || \
   [ ! -f "$ROOT/web/game-assets/game-data.js" ] || \
   [ ! -f "$ROOT/web/game-assets/img/animal_goat.png" ] || \
   [ ! -f "$ROOT/web/game-assets/img/barn.png" ]; then
  "$ROOT/scripts/import-game-assets.sh"
fi

mkdir -p "$BUILD/module-cache" "$APP/Contents/MacOS" "$APP/Contents/Resources"
for TARGET_ARCH in arm64 x86_64; do
  swiftc -swift-version 5 -O \
    -target "$TARGET_ARCH-apple-macos11.0" \
    -module-cache-path "$BUILD/module-cache" \
    -framework Cocoa -framework WebKit \
    "$ROOT/mac/Meadow.swift" -o "$BUILD/Meadow-$TARGET_ARCH"
done
lipo -create "$BUILD/Meadow-arm64" "$BUILD/Meadow-x86_64" -output "$APP/Contents/MacOS/Meadow"
lipo "$APP/Contents/MacOS/Meadow" -verify_arch arm64 x86_64
cp "$ROOT/mac/Info.plist" "$APP/Contents/Info.plist"
ditto --norsrc --noextattr --noacl "$ROOT/web" "$APP/Contents/Resources/web"
# Keep extraction provenance locally, without shipping personal installation paths.
rm -f "$APP/Contents/Resources/web/game-assets/SOURCE.txt" "$APP/Contents/Resources/web/game-assets/GAMEPLAY-SOURCE.txt"
cp "$ROOT/THIRD_PARTY.md" "$APP/Contents/Resources/THIRD_PARTY.md"
ditto --norsrc --noextattr --noacl "$ROOT/licenses" "$APP/Contents/Resources/licenses"
if [ ! -f "$BUILD/Meadow.icns" ] || [ "$ROOT/mac/GenerateIcon.swift" -nt "$BUILD/Meadow.icns" ] || [ "$ROOT/web/game-assets/ui/chicken.png" -nt "$BUILD/Meadow.icns" ]; then
  swiftc -swift-version 5 -O \
    -module-cache-path "$BUILD/module-cache" \
    -framework Cocoa "$ROOT/mac/GenerateIcon.swift" -o "$BUILD/generate-icon"
  "$BUILD/generate-icon" "$BUILD/Meadow.iconset" "$ROOT/web/game-assets/ui/chicken.png"
fi
cp "$BUILD/Meadow.icns" "$APP/Contents/Resources/Meadow.icns"
# Sign outside Desktop/iCloud, which can reattach Finder metadata between
# clearing attributes and signing. Copy the already-signed bundle afterwards.
xattr -cr "$APP"
codesign --force --deep --sign - "$APP"
codesign --verify --deep --strict "$APP"
mkdir -p "$ROOT/dist"
# Replace the previous generated bundle instead of merging stale resources.
# The signed candidate is complete before the previous build is moved aside.
if [ -e "$DESTINATION" ]; then
  mv "$DESTINATION" "$STAGING/Previous-Meadow.app"
fi
# Desktop file providers can add Finder attributes during this last copy.
# Clear only the generated bundle's metadata, then verify its existing signature.
if ! ditto --norsrc --noextattr --noacl "$APP" "$DESTINATION" || \
   ! xattr -cr "$DESTINATION" || \
   ! codesign --verify --deep --strict "$DESTINATION"; then
  rm -rf "$DESTINATION"
  if [ -d "$STAGING/Previous-Meadow.app" ]; then
    mv "$STAGING/Previous-Meadow.app" "$DESTINATION"
  fi
  echo "正式应用复制或签名验证失败，已恢复上一次构建。" >&2
  exit 1
fi
echo "已生成：$DESTINATION"
