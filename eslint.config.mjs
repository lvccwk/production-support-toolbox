import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // react-hooks v6's set-state-in-effect flags legitimate on-mount
      // initialisation (reading window.location.hash, applying a re-opened
      // analysis payload, fetch-on-mount). We keep all other rules.
      "react-hooks/set-state-in-effect": "off",
    },
  },
  globalIgnores([".next/**", "node_modules/**", "out/**", "next-env.d.ts", "data/**"]),
]);