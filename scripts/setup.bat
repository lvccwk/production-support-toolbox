@echo off
rem 一榌準備 (Windows): 檢查 Node -> npm install -> .env -> data/
rem macOS/Linux 同事用 setup.sh。兩者共用 scripts\setup.mjs 做實際工作。
setlocal
cd /d "%~dp0.."

where node >nul 2>nul
if errorlevel 1 (
  echo [X] 搵唔到 Node.js。Toolbox 需要 Node ^>= 20 (LTS)。
  echo     安裝: winget install OpenJS.NodeJS.LTS
  echo     或者由 https://nodejs.org/en/download 下載 LTS 版
  exit /b 1
)

for /f "tokens=1 delims=." %%v in ('node --version') do set NODE_MAJOR=%%v
set NODE_MAJOR=%NODE_MAJOR:v=%
if "%NODE_MAJOR%" LSS 20 (
  echo [X] Node.js 版本太舊 ^(v%NODE_MAJOR%^)。Toolbox 需要 ^>= 20,請裝 LTS。
  echo     昇級: winget upgrade OpenJS.NodeJS.LTS
  exit /b 1
)

echo [.] Node.js v%NODE_MAJOR% OK
node scripts\setup.mjs
endlocal