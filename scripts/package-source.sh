#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD="$ROOT/.build"
ARCHIVE="$ROOT/dist/Stardew-Journal-source.zip"
TEMP_ARCHIVE="$BUILD/Stardew-Journal-source-$$.zip"
trap 'rm -f "$TEMP_ARCHIVE"' EXIT
mkdir -p "$BUILD" "$ROOT/dist"
cd "$ROOT"

FILES=(mac scripts web)
for item in tests docs README.md THIRD_PARTY.md licenses package.json LICENSE .gitignore "启动Stardew Journal.command" 启动小谷待办.command 启动下一个春天.command 打包说明.txt; do
  if [ -e "$item" ]; then FILES+=("$item"); fi
done

# Deliberate allowlist: no app bundle, personal data, build products, or game art.
COPYFILE_DISABLE=1 /usr/bin/zip -q -r "$TEMP_ARCHIVE" "${FILES[@]}" \
  -x 'web/game-assets/*' '*/.DS_Store' '*/._*'
if /usr/bin/unzip -Z1 "$TEMP_ARCHIVE" | /usr/bin/grep '^web/game-assets/'; then
  echo "源码包校验失败：发现了游戏素材目录。" >&2
  exit 1
fi
/usr/bin/unzip -tq "$TEMP_ARCHIVE"
mv -f "$TEMP_ARCHIVE" "$ARCHIVE"
echo "已生成不含游戏素材的源码包：$ARCHIVE"
