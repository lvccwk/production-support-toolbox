import { NextResponse } from "next/server";
import { ToolError } from "@/lib/errors";

/** Shared response helpers for the agent-facing /api/tools endpoints. */

export function toolErrorResponse(error: unknown, status = 400): NextResponse {
  const message =
    error instanceof ToolError
      ? error.message
      : error instanceof Error
        ? error.message
        : "Unexpected error.";
  return NextResponse.json({ ok: false, error: message }, { status });
}

export function toolOk(data: unknown): NextResponse {
  return NextResponse.json({ ok: true, data });
}