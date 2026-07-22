/**
 * Fails only on a real static HTML export (out/) or missing App Router API build.
 * Note: `.next/export-marker.json` is always written by `next build` — do NOT treat
 * that file as proof of `output: "export"`.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const outDir = path.join(root, "out");
const apiDir = path.join(root, ".next", "server", "app", "api");
const requiredServer = path.join(root, ".next", "required-server-files.json");

function exists(p) {
  return fs.existsSync(p);
}

if (exists(outDir)) {
  console.error(`
[assert-not-static] Found ${outDir}
Static HTML export ran (output: "export" or next export). API routes will break.

Fix on Vercel:
  1. next.config must NOT set output: "export"
  2. Output Directory: clear + Override OFF
  3. Build Command: npm run build (or next build only)
  4. Redeploy without build cache
`);
  process.exit(1);
}

if (!exists(apiDir)) {
  console.error(`
[assert-not-static] Missing ${apiDir}
App Router API routes were not compiled into the server output.
`);
  process.exit(1);
}

const apiEntries = fs.readdirSync(apiDir);
if (apiEntries.length === 0) {
  console.error("[assert-not-static] .next/server/app/api is empty.");
  process.exit(1);
}

if (!exists(requiredServer)) {
  console.warn(
    "[assert-not-static] Warning: missing required-server-files.json (unusual for a Vercel Next deploy).",
  );
}

console.log(
  `[assert-not-static] OK — no out/; API server output present (${apiEntries.join(", ")}).`,
);
