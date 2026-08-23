"use client";

import { useEffect, useState } from "react";
import { Button, Card, Input, Note } from "@/components/ui";
import { TransferButtons } from "@/components/TransferButtons";
import { getStoredApiToken, setStoredApiToken } from "@/lib/api/client";

/**
 * Settings page: local data operations (backup / export / import) plus the
 * remote-mode API token. The toolbox is agent-first: machine-readable tool
 * endpoints live under GET /api/tools (see README "Agent API").
 */
export function SettingsPage() {
  const [token, setToken] = useState("");
  const [tokenSaved, setTokenSaved] = useState(false);

  useEffect(() => {
    setToken(getStoredApiToken());
  }, []);

  const saveToken = () => {
    setStoredApiToken(token);
    setTokenSaved(true);
    window.setTimeout(() => setTokenSaved(false), 2000);
  };

  return (
    <div className="space-y-4">
      <Card
        title="備份 / 匯出"
        description="JSON = 完整備份（incidents + history + 自訂規則，schema v2）；CSV = 分表匯出（防公式注入）。匯入全部-or-無（atomic），自動跳過重複項目。"
      >
        <TransferButtons scope="incidents" />
      </Card>

      <Card
        title="Remote 模式 API Token"
        description="只有開啟 PST_REMOTE_ACCESS 先需要。Token 只存喺呢個瀏覽器（localStorage），每個 API Request 自動加 Authorization: Bearer——唔會入 log / history / export。"
      >
        <div className="space-y-2">
          <Input
            value={token}
            onChange={(e) => {
              setToken(e.target.value);
              setTokenSaved(false);
            }}
            placeholder="貼上 PST_API_TOKEN（或 read/write token）…"
            type="password"
          />
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={saveToken}>
              儲存 Token
            </Button>
            {tokenSaved && <Note tone="ok">Token 已儲存喺此瀏覽器。</Note>}
          </div>
        </div>
      </Card>

      <Card title="Agent API">
        <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">
          工具箱以 Agent 為主要使用者：所有工具都是 stateless、確定性的 JSON
          端點。先 <code className="font-mono text-xs">GET /api/tools</code>{" "}
          取得工具清單（含輸入格式與範例），再呼叫對應端點。本機模式（預設）無需
          認證；Remote 模式需要
          <code className="font-mono text-xs"> Authorization: Bearer &lt;token&gt;</code>
          （scope：read / write / admin）。
        </p>
        <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">
          成個 API surface（tools / data / rules / dashboard / alerts）有
          OpenAPI 3.1 描述：
          <a
            href="/api/openapi.json"
            target="_blank"
            rel="noreferrer"
            className="font-mono text-xs text-blue-700 underline hover:text-blue-800 dark:text-blue-400"
          >
            /api/openapi.json
          </a>{" "}
          —— agent 或第三方可以自動發現 endpoints、scope 同 schema，唔使讀 README。
        </p>
      </Card>
    </div>
  );
}