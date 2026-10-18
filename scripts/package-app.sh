#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/dist/Meadow.app"
ARCHIVE="$ROOT/dist/Stardew-Journal-macOS-完整版.zip"
STAGING="$(mktemp -d "${TMPDIR:-/tmp}/meadow-package.XXXXXX")"
trap 'rm -rf "$STAGING"' EXIT
PACKAGE="$STAGING/Stardew-Journal-macOS"
mkdir -p "$PACKAGE"

if [ ! -d "$APP" ]; then
  echo "缺少正式应用，请先运行 npm run build。" >&2
  exit 1
fi
if [ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleDisplayName' "$APP/Contents/Info.plist")" != "Stardew Journal" ] || \
   [ "$(/usr/libexec/PlistBuddy -c 'Print :LSMinimumSystemVersion' "$APP/Contents/Info.plist")" != "11.0" ]; then
  echo "正式应用名称或最低系统版本不符合发布配置，请重新构建。" >&2
  exit 1
fi

for asset in game-data.js img/houses.png img/crops.png img/farmhouse_tiles.png img/walls_and_floors.png ui/panel.png ui/chicken.png portraits/Abigail.png img/barn.png img/animal_chicken.png img/animal_duck.png img/animal_cow.png img/animal_goat.png img/tools.png; do
  if [ ! -f "$APP/Contents/Resources/web/game-assets/$asset" ]; then
    echo "完整应用缺少素材：$asset；请先运行 npm run build。" >&2
    exit 1
  fi
done
for private_file in SOURCE.txt GAMEPLAY-SOURCE.txt; do
  if [ -e "$APP/Contents/Resources/web/game-assets/$private_file" ]; then
    echo "应用仍包含本机提取路径记录，请重新运行 npm run build。" >&2
    exit 1
  fi
done
ditto --norsrc --noextattr --noacl "$APP" "$PACKAGE/Stardew Journal.app"
codesign --verify --deep --strict "$PACKAGE/Stardew Journal.app"
lipo "$PACKAGE/Stardew Journal.app/Contents/MacOS/Meadow" -verify_arch arm64 x86_64
cp "$ROOT/打包说明.txt" "$PACKAGE/打开说明.txt"
ditto -c -k --keepParent --norsrc --noextattr --noacl "$PACKAGE" "$STAGING/complete.zip"
unzip -tq "$STAGING/complete.zip"
mv -f "$STAGING/complete.zip" "$ARCHIVE"
echo "已生成含全部游戏素材的 macOS 通用应用包：$ARCHIVE"
