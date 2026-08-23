import { NextRequest } from "next/server";
import { withApi } from "@/lib/api/route";
import { buildDashboardSummary } from "@/lib/database/dashboard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/dashboard — aggregated report over saved analyses + incidents:
 * totals, severity/tool/system distribution, top error types (parsed from
 * stored analysis snapshots with JSON1) and a daily High+ trend. This is the
 * GUI dashboard data source; agents can also use it for period summaries.
 * Optional ?days=7..90 adjusts the trend horizon (default 14).
 */
export async function GET(request: NextRequest) {
  return withApi(request, { route: "/api/dashboard", scope: "read" }, async () => {
    const daysParam = Number(request.nextUrl.searchParams.get("days") ?? 14);
    const days = Number.isInteger(daysParam) && daysParam >= 1 && daysParam <= 90 ? daysParam : 14;
    return buildDashboardSummary({ days });
  });
}