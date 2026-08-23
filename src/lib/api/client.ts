/**
 * Browser-side API client helpers (remote mode).
 *
 * When the app runs in `PST_REMOTE_ACCESS` mode the server requires
 * `Authorization: Bearer <token>` on every API request. The token is entered
 * once in Settings and kept in localStorage (`pst-api-token`); every GUI
 * request goes through `apiFetch` which attaches it automatically.
 *
 * This module is client-safe (no Node imports) and also importable from
 * tests (it only touches localStorage inside try/catch).
 */

const TOKEN_KEY = "pst-api-token";

export function getStoredApiToken(): string {
  try {
    if (typeof window === "undefined") return "";
    return window.localStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setStoredApiToken(token: string): void {
  try {
    if (typeof window === "undefined") return;
    if (token.trim()) window.localStorage.setItem(TOKEN_KEY, token.trim());
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    // localStorage unavailable (privacy mode) — requests will be unauthenticated.
  }
}

/** fetch() that attaches the stored bearer token when present. */
export function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  const token = getStoredApiToken();
  const headers = new Headers(init?.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}

/**
 * Read a human-readable message from any API error shape:
 *   { error: { message } } | { error: "old-style string" } | { message } | string
 */
export function errorMessage(json: unknown, fallback = "Request failed."): string {
  if (json === null || json === undefined) return fallback;
  if (typeof json === "string") return json || fallback;
  if (typeof json !== "object") return fallback;
  const record = json as Record<string, unknown>;
  const error = record.error;
  if (error !== undefined && error !== null) {
    if (typeof error === "string") return error || fallback;
    if (typeof error === "object") {
      const message = (error as Record<string, unknown>).message;
      if (typeof message === "string" && message) return message;
    }
  }
  if (typeof record.message === "string" && record.message) return record.message;
  return fallback;
}