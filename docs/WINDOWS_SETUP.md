# Windows 部署指南 (Windows Setup)

呢份文件講 Windows 同事點樣跑起 Production Support Toolbox,同埋
`better-sqlite3`(native module)撞到編譯問題時點算。

## 快速開始(正常情況,唔使編譯工具)

`better-sqlite3` 對 Windows x64 一般有 **prebuilt binary**(N-API,唔使裝
Visual Studio / Python),所以正常流程同 macOS 一樣簡單:

1. **裝 Node.js LTS**(一係一行搞掂,一係裝完唔使理):

   ```powershell
   winget install OpenJS.NodeJS.LTS
   ```

   或者去 https://nodejs.org/en/download 下載 **LTS** 版 installer。
   唔好用太新嘅 odd 版本(例如 25.x)——LTS 最穩陣。

2. **解壓/放好個專案**,開一個 cmd 或 PowerShell 窗口,入去專案根目錄:

   ```bat
   setup.bat
   ```

   (`setup.bat` 會:檢查 Node ≥ 20 → `npm install` → 整 `.env` → 整 `data/`)

3. **啟動:**

   ```bat
   npm run dev
   ```

4. 開瀏覽器入 **http://localhost:3000**。首頁係歡迎頁,按「30 秒試玩」即刻
   睇到示範分析。

> PowerShell 用戶都可以直接打 `.\setup.bat`。如果執行原則擋住,喺 PowerShell
> 打 `powershell -ExecutionPolicy Bypass -File setup.bat`(或喺
> `Set-ExecutionPolicy RemoteSigned -Scope CurrentUser` 之後再試)。

## 撞到 node-gyp / build tools 錯誤(少見)

如果 `npm install` 期間出現類似

```
gyp ERR! stack Error: Can't find Python executable
gyp ERR! build error
```

即係話你呢個 Node 版本冇對應嘅 prebuilt,需要本地編譯。兩個解法,揀一個:

### 解法 A:轉返用 LTS(最省事,推薦)

裝返 LTS 版 Node,舊版 prebuilt 通常齊:

```powershell
winget install OpenJS.NodeJS.LTS
```

確認版本:`node --version` 應該係 `v20.x` 或 `v22.x`(LTS)。

### 解法 B:裝 VS Build Tools(一定要保留 LTS 版 Node)

```powershell
winget install Microsoft.VisualStudio.2022.BuildTools
```

安裝時勾選 **「使用 C++ 的桌面開發」 (Desktop development with C++)**
workload,再裝 Python 3(https://www.python.org 或 `winget install Python.Python.3.12`)。
裝完**重開一個 cmd 窗口**再行 `setup.bat`。

## 有 Docker 嘅話:完全唔使理 Node(後備方案)

同事已經有 Docker Desktop 就最舒服——Node、native module 全部喺
container 入面處理:

```powershell
docker compose up -d
```

然後開 **http://localhost:3000**。數據會存喺專案嘅 `./data`
(volume mount,重開機唔會消失)。收埋佢:

```powershell
docker compose down
```

## 兩三條常見問題

- **「connection refused」/ 開唔到 localhost:3000** — 睇下個 cmd 窗口有冇
  error;有 firewall 提示就 allow Node.js。
- **公司 proxy 令 `npm install` 好慢/失敗** — 問 IT 攞 npm proxy 設定,或者
  睇下 `setup.bat` 印出嚟嘅「改用專案內 cache 重試」有冇跑緊(佢會自動做)。
- **想開機畀同 network 同事用** — 唔好直接改 host,用內建 remote mode:
  `setup.bat` 之後設 `PST_REMOTE_ACCESS=true` 同 token,再
  `npm run dev:remote`(詳見 README「Remote mode & API access control」)。
  預設 bind 127.0.0.1,未設 token 係冇得開 remote 嘅(fail-closed)。

## 驗證

每個 PR 都會經 GitHub Actions 喺 **`windows-latest`** 跑
`npm ci → typecheck → test → build`,所以「Windows 有 prebuilt」呢個講法係
**持續驗證**緊,唔係一次過 claim。你可以喺 PR page 睇 `Windows smoke` check。