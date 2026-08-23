import { NextRequest, NextResponse } from "next/server";
import {
  createAlertRule,
  listAlertRules,
  alertsEnabled,
} from "@/lib/database/alerts";
import { validateAlertRuleInput } from "@/lib/database/alerts";
import { withApi } from "@/lib/api/route";
import { guardBodySize } from "@/lib/api/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/alerts — user-configured alert rules (NOTIFICATIONS concept).
 *
 * Each rule reacts to SAVED analyses (never automatic runs): a minimum
 * severity, optional error-type / system / tool filters, optional webhook
 * delivery (generic POST JSON) and a per-signal cooldown. Every firing is
 * always recorded locally (GET /api/notifications) — webhooks are a
 * best-effort extra channel. Alerts never read or forward raw log content.
 *
 * GET: list rules (+ `alertsEnabled` for the GUI banner).
 * POST: create a rule (validated: severity, filters, http(s) webhook URLs).
 */
export async function GET(request: NextRequest) {
  return withApi(request, { route: "/api/alerts", scope: "read" }, async () => {
    return { rules: listAlertRules(false), alertsEnabled: alertsEnabled() };
  });
}

/** POST /api/alerts — create an alert rule. */
export async function POST(request: NextRequest) {
  return withApi(request, { route: "/api/alerts", scope: "write" }, async () => {
    const sizeError = guardBodySize(request);
    if (sizeError) throw sizeError;
    const raw = (await request.json()) as Record<string, unknown>;
    const input = validateAlertRuleInput(raw);
    const rule = createAlertRule(input);
    return new NextResponse(JSON.stringify({ ok: true, data: { rule } }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  });
}