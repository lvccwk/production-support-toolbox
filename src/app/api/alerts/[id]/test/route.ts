import { NextRequest } from "next/server";
import { sendTestAlert } from "@/lib/database/alerts";
import { withApi } from "@/lib/api/route";
import { ApiError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/alerts/[id]/test — deliver a TEST payload to the rule's webhook
 * (or record an in-app-only entry) so users can verify delivery without
 * waiting for a real match. Returns the delivery result; NEVER fails the
 * request on a webhook error (it comes back as { delivered: false }).
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return withApi(request, { route: "/api/alerts/[id]/test", scope: "write" }, async () => {
    const id = Number((await context.params).id);
    if (!Number.isInteger(id) || id <= 0) {
      throw new ApiError("Invalid alert rule id.", "VALIDATION_ERROR");
    }
    const outcome = await sendTestAlert(id);
    return { ...outcome };
  });
}