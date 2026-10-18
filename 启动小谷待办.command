#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
if ! "$ROOT/scripts/run.sh"; then
  echo "启动失败。按回车键关闭此窗口。"
  read -r
  exit 1
fi
