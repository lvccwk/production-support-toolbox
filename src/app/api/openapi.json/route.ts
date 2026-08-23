import { NextResponse } from "next/server";
import { buildOpenApiDoc } from "@/lib/api/openapi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/openapi.json — machine-readable OpenAPI 3.1 description of the
 * WHOLE API surface (tools, data, rules, dashboard, alerts). Always open:
 * it is metadata only, contains no user data.
 */
export async function GET() {
  return NextResponse.json(buildOpenApiDoc(), {
    headers: { "Cache-Control": "no-store" },
  });
}