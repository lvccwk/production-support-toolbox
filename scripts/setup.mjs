#!/usr/bin/env node
/**
 * 一鍵準備(跨平台,由 scripts/setup.sh 同 scripts/setup.bat 呼叫):
 *   1. npm install —— 若果撞到 npm cache 權限問題(EPERM),自動改用專案內 cache 重試
 *   2. 缺 .env 就由 .env.example 建立
 *   3. 確保 data/ 存在(SQLite、backups)
 *
 * 直接跑都得: npm run setup
 */
import { execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(process.cwd());

function run(cmd) {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { stdio: "inherit", cwd: root });
}

console.log("🔧 Production Support Toolbox — 準備環境");

// 1) 安裝依賴。npm 全域 cache 損壞(EPERM)係常見問題,自動 fallback 到專案內 cache。
let installed = false;
try {
  run("npm install");
  installed = true;
} catch {
  /* 首次失敗 —— 下面用專案內 cache 重試 */
}
if (!installed) {
  console.warn("\n[!] npm install 失敗(多數係 npm cache 權限問題),改用專案內 cache 重試…");
  run(`npm install --cache ${JSON.stringify(join(root, ".cache", "npm"))}`);
}

// 2) .env
const envExample = join(root, ".env.example");
const envTarget = join(root, ".env");
if (existsSync(envExample) && !existsSync(envTarget)) {
  copyFileSync(envExample, envTarget);
  console.log("\n[+] 已由 .env.example 建立 .env(未覆寫任何現有內容)");
} else {
  console.log("\n[·] .env 已存在,略過");
}

// 3) data/
mkdirSync(join(root, "data"), { recursive: true });
console.log("[+] data/ 已就緒(本地 SQLite + backups)");

console.log("\n✅ 準備完成。下一步:");
console.log("    npm run dev        開發模式 → http://127.0.0.1:3000");
console.log("    npm run dev:remote 同 network 嘅同事喺部 Mac 入面用(需設 PST_REMOTE_ACCESS)");
console.log("    或者 npm run mcp    畀 AI agent(Claude Code / Cursor / opencode)用");