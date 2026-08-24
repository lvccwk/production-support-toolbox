"use client";

import { Button, Card, Note } from "@/components/ui";

export interface WelcomeTool {
  id: string;
  name: string;
  blurb: string;
}

/**
 * 首頁(Welcome):畀第一次用嘅人 30 秒內見到價值。
 * 三個區塊:一句定位 → 30 秒試玩 → 工具總覽。全部本地處理。
 */
export function Welcome({
  tools,
  onOpen,
  onTrySample,
}: {
  tools: WelcomeTool[];
  onOpen: (id: string) => void;
  onTrySample: () => void;
}) {
  return (
    <div className="space-y-6">
      {/* 定位 */}
      <section className="rounded-lg border border-blue-200 bg-blue-50/60 p-6 dark:border-blue-900 dark:bg-blue-950/30">
        <p className="text-[11px] font-bold uppercase tracking-widest text-blue-700 dark:text-blue-400">
          Production Support Toolbox
        </p>
        <h2 className="mt-1 text-2xl font-bold text-zinc-900 dark:text-zinc-50">
          後台支援工具箱
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
          支援工程師日常工具:log 分析(自動認 error type / component / 中英雙語報告)、
          前後比較、JSON 格式化、SQL 安全檢查、時間戳轉換、編碼修復。
          全部喺本機運行,數據唔會 upload,冇 telemetry。
        </p>
        <div className="mt-4">
          <Button variant="primary" size="md" onClick={onTrySample}>
            ▶ 30 秒試玩 — 分析一份示範 log
          </Button>
        </div>
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
          一撳即用內建示範資料跑一次完整分析,唔使準備任何嘢。
        </p>
      </section>

      {/* 工具總覽 */}
      <section>
        <h3 className="mb-2 text-sm font-semibold text-zinc-800 dark:text-zinc-100">
          工具總覽
        </h3>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {tools.map((tool) => (
            <button
              key={tool.id}
              onClick={() => onOpen(tool.id)}
              className="group rounded-lg border border-zinc-200 bg-white p-4 text-left shadow-sm transition-colors hover:border-blue-400 hover:bg-blue-50/50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-blue-700 dark:hover:bg-blue-950/30"
            >
              <p className="font-semibold text-zinc-900 group-hover:text-blue-700 dark:text-zinc-50 dark:group-hover:text-blue-300">
                {tool.name}
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                {tool.blurb}
              </p>
            </button>
          ))}
        </div>
      </section>

      {/* 新手提示 */}
      <Card title="第一次用?三步開始" description="唔使睇文件都識用">
        <ol className="list-decimal space-y-1.5 pl-5 text-sm text-zinc-700 dark:text-zinc-300">
          <li>按上面「30 秒試玩」,睇一份示範 log 嘅分析結果</li>
          <li>貼你哋自己嘅 log 入 Log Analyzer,即刻有中英雙語報告</li>
          <li>有問題就開 Support History 存起,方便覆診同分享</li>
        </ol>
        <div className="mt-3">
          <Note tone="info">
            想畀 AI agent 用?專案根目錄行 <code className="rounded bg-zinc-100 px-1 py-0.5 text-xs dark:bg-zinc-800">npm run mcp</code>{" "}
            (Claude Code / Cursor / opencode 接法見 README)。
          </Note>
        </div>
      </Card>
    </div>
  );
}