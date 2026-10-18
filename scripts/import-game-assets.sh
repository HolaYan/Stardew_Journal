#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE="${1:-$HOME/Library/Application Support/Stardew Desk/scene/data/img}"
TARGET="$ROOT/web/game-assets/img"
BUILD="$ROOT/.build"
GAME_CONTENT="${2:-$HOME/Library/Application Support/Steam/steamapps/common/Stardew Valley/Contents/Resources/Content}"

if [ ! -d "$SOURCE" ]; then
  echo "未找到本机已提取的星露谷素材：$SOURCE" >&2
  echo "请先用 Stardew Desk 从你已安装的游戏中提取，或运行：" >&2
  echo "  ./scripts/import-game-assets.sh '/你的素材文件夹/img'" >&2
  exit 1
fi

for filename in spring_outdoorsTileSheet.png houses.png cursors.png orders.png springobjects.png crops.png chicken_white.png; do
  if [ ! -f "$SOURCE/$filename" ]; then
    echo "素材目录不完整，缺少：$filename" >&2
    exit 1
  fi
done

shopt -s nullglob
ASSETS=("$SOURCE"/*.png)
if [ "${#ASSETS[@]}" -eq 0 ]; then
  echo "素材目录中没有 PNG 文件。" >&2
  exit 1
fi

mkdir -p "$TARGET"
for asset in "${ASSETS[@]}"; do
  cp -X "$asset" "$TARGET/$(basename "$asset")"
done

mkdir -p "$BUILD/module-cache"
if [ ! -x "$BUILD/extract-ui-sprites" ] || \
   [ "$ROOT/mac/ExtractUISprites.swift" -nt "$BUILD/extract-ui-sprites" ]; then
  swiftc -swift-version 5 -O \
    -module-cache-path "$BUILD/module-cache" \
    -framework CoreGraphics -framework ImageIO \
    "$ROOT/mac/ExtractUISprites.swift" -o "$BUILD/extract-ui-sprites"
fi
"$BUILD/extract-ui-sprites" "$TARGET" "$ROOT/web/game-assets/ui"

if [ -d "$GAME_CONTENT" ]; then
  node "$ROOT/scripts/extract-gameplay.cjs" "$GAME_CONTENT"
else
  echo "未找到游戏 Content 目录，已导入场景素材；可另行运行 node scripts/extract-gameplay.cjs '/游戏/Content'。" >&2
fi

cat > "$ROOT/web/game-assets/SOURCE.txt" <<EOF
Stardew Journal — local Stardew Valley asset extraction

Imported from: $SOURCE
Imported at (UTC): $(date -u '+%Y-%m-%d %H:%M:%S')
PNG files: ${#ASSETS[@]}
Derived UI PNG files: 11 exact pixel crops in ui/ (no redrawing or scaling)

These textures are game artwork owned by ConcernedApe, not original Stardew Journal art.
They were copied from the existing local Stardew Desk extraction cache.
The importer does not download game artwork or modify the installed game.

The source repository and source archive exclude extracted game content.
The complete macOS release bundles the assets required by Stardew Journal.
Stardew Journal is unofficial and is not affiliated with ConcernedApe.
These statements do not imply official authorization or endorsement.
This local diagnostic file is excluded from the release app and archives.
EOF

echo "已导入 ${#ASSETS[@]} 个本机游戏素材：$TARGET"
