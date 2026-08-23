"use client";

import { Card } from "@/components/ui";
import { TransferButtons } from "@/components/TransferButtons";

/**
 * Settings page: local data operations only (backup / export / import).
 * The toolbox is agent-first: machine-readable tool endpoints live under
 * GET /api/tools (see README "Agent API").
 */

export function SettingsPage() {
  return (
    <div className="space-y-4">
      <Card
        title="備份 / 匯出"
        description="JSON = 完整備份(兩張表);CSV = 分表匯出。匯入會自動跳過重複項目。全部本地處理。"
      >
        <TransferButtons scope="incidents" />
      </Card>

      <Card title="Agent API">
        <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">
          工具箱以 Agent 為主要使用者：所有工具都是 stateless、本機、確定性的
          JSON 端點。先 <code className="font-mono text-xs">GET /api/tools</code>{" "}
          取得工具清單（含輸入格式與範例），再呼叫對應端點即可——無需登入、無 AI 成本。
        </p>
      </Card>
    </div>
  );
}