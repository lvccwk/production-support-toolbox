import type { NextConfig } from "next";

/**
 * Next.js 16 blocks cross-origin access to dev resources by default.
 * Wildcards match one dot-separated label, so "192.168.1.*" allows every
 * host on that subnet (e.g. http://192.168.1.231:3000 from another machine).
 * Override the list with PST_ALLOWED_DEV_ORIGINS (comma-separated), e.g.:
 *   PST_ALLOWED_DEV_ORIGINS="192.168.*.*,10.0.*.*" npm run dev
 */
function allowedDevOrigins(): string[] {
  const fromEnv = process.env.PST_ALLOWED_DEV_ORIGINS;
  if (fromEnv) {
    return fromEnv
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }
  return ["192.168.1.*"];
}

const nextConfig: NextConfig = {
  // better-sqlite3 is a native module; keep it out of the bundler.
  serverExternalPackages: ["better-sqlite3"],
  allowedDevOrigins: allowedDevOrigins(),
  // Local-only data (SQLite, backups, OpenCode sandbox) must never be traced
  // into the deployment bundle — dynamic workDir paths also trigger the
  // Next.js "whole project traced" warning otherwise.
  outputFileTracingExcludes: {
    "*": ["data/**"],
  },
};

export default nextConfig;