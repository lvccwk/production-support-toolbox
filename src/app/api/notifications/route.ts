import { NextRequest } from "next/server";
import { clearNotifications, listNotifications } from "@/lib/database/alerts";
import { withApi } from "@/lib/api/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/notifications — the local log of every alert firing. Always written
 * for a firing, even when webhook delivery failed or no webhook exists.
 *
 * GET: newest first (?limit=1..500, default 100).
 * DELETE: clear the whole log (admin) — past firings are not recoverable.
 */
export async function GET(request: NextRequest) {
  return withApi(request, { route: "/api/notifications", scope: "read" }, async () => {
    const limitParam = Number(request.nextUrl.searchParams.get("limit") ?? 100);
    const limit = Number.isInteger(limitParam) && limitParam >= 1 && limitParam <= 500 ? limitParam : 100;
    return { notifications: listNotifications(limit) };
  });
}

export async function DELETE(request: NextRequest) {
  return withApi(request, { route: "/api/notifications", scope: "admin" }, async () => {
    const removed = clearNotifications();
    return { removed };
  });
}