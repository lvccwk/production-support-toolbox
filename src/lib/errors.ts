/** Small helper for user-facing validation errors raised by pure logic. */

export class ToolError extends Error {
  readonly code: string;

  constructor(message: string, code = "INPUT_ERROR") {
    super(message);
    this.name = "ToolError";
    this.code = code;
  }
}

/** Wrap an unknown thrown value into a ToolError (keeps messages stable). */
export function toToolError(error: unknown): ToolError {
  if (error instanceof ToolError) return error;
  if (error instanceof Error) return new ToolError(error.message);
  return new ToolError(String(error));
}
