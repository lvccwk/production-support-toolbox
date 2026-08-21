import { ToolError } from "@/lib/errors";

/**
 * Base64 / URL encoding toolbox (section 12). Pure functions. UTF-8 safe.
 */

export type EncodingMode = "encode" | "decode";

/** Base64 encode (UTF-8). */
export function base64Encode(text: string): string {
  if (!text) throw new ToolError("Empty input. Paste text before encoding.");
  return btoa(String.fromCharCode(...new TextEncoder().encode(text)));
}

/** Base64 decode (UTF-8). Throws ToolError on invalid base64. */
export function base64Decode(text: string): string {
  if (!text) throw new ToolError("Empty input. Paste base64 before decoding.");
  const cleaned = text.trim().replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(cleaned) || cleaned.length % 4 === 1) {
    throw new ToolError("Invalid base64 input.");
  }
  try {
    const binary = atob(cleaned);
    const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  } catch {
    throw new ToolError("Invalid base64 input.");
  }
}

/** URL-encode a string (encodeURIComponent semantics: hello world -> hello%20world). */
export function urlEncode(text: string): string {
  if (!text) throw new ToolError("Empty input. Paste text before encoding.");
  return encodeURIComponent(text);
}

/** URL-decode a string. Throws ToolError on invalid percent-encoding. */
export function urlDecode(text: string): string {
  if (!text) throw new ToolError("Empty input. Paste URL before decoding.");
  try {
    return decodeURIComponent(text);
  } catch {
    throw new ToolError("Invalid URL encoding.");
  }
}

/** URL-encode but keep safe path characters (encodeURI semantics). */
export function urlEncodePath(text: string): string {
  if (!text) throw new ToolError("Empty input. Paste text before encoding.");
  return encodeURI(text);
}