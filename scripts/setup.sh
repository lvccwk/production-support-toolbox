#!/usr/bin/env bash
# 一鍵準備(macOS / Linux):檢查 Node → npm install → .env → data/
# Windows 同事用 setup.bat。兩者共用 scripts/setup.mjs 做實際工作。
set -euo pipefail
cd "$(dirname "$0")/.."

NODE_BIN="$(command -v node || true)"
if [ -z "$NODE_BIN" ]; then
  echo "❌ 搵唔到 Node.js。Toolbox 需要 Node ≥ 20(LTS)。"
  echo "   安裝: https://nodejs.org/en/download   或者  brew install node"
  exit 1
fi

MAJOR="$(node -p "Number(process.versions.node.split('.')[0])")"
if [ "$MAJOR" -lt 20 ]; then
  echo "❌ Node.js 版本太舊(v$MAJOR)。Toolbox 需要 ≥ 20,請裝 LTS 版本。"
  echo "   有 nvm 嘅話: nvm install --lts && nvm use --lts"
  exit 1
fi

echo "[·] Node.js v$(node -p "process.versions.node") ✓"
node scripts/setup.mjs