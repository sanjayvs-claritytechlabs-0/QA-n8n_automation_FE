/**
 * Fails the build if Next produced a static export (out/) or omitted API routes.
 * That deploy mode serves HTML 500s for /api/* with nextExport:true on Vercel.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const outDir = path.join(root, "out");
const exportMarker = path.join(root, ".next", "export-marker.json");
const apiJobs =
  path.join(root, ".next", "server", "app", "api", "jobs", "route.js");
const apiJobsAlt = path.join(
  root,
  ".next",
  "server",
  "app",
  "api",
  "jobs",
  "route_client-reference-manifest.js",
);

function exists(p) {
  return fs.existsSync(p);
}

if (exists(outDir)) {
  console.error(`
[assert-not-static] Found ${outDir}
Static export ran. API routes will NOT work on Vercel.

Fix:
  1. next.config must NOT set output: "export"
  2. Vercel → Settings → Build & Development → Output Directory:
     clear it and turn Override OFF (not "out")
  3. Build Command must be only: next build
  4. Redeploy (or delete & re-import the Vercel project)
`);
  process.exit(1);
}

if (exists(exportMarker)) {
  const raw = fs.readFileSync(exportMarker, "utf8");
  console.error(`[assert-not-static] Found export-marker.json:\n${raw}`);
  process.exit(1);
}

if (!exists(apiJobs) && !exists(path.dirname(apiJobs))) {
  // Directory missing entirely is a hard fail
  console.error(`
[assert-not-static] Missing .next/server/app/api/jobs after next build.
App Router API routes were not compiled. Check that app/api/**/route.ts exists
and Framework Preset is Next.js (not Other/static).
`);
  process.exit(1);
}

// Soft note: route.js path varies slightly by Next version; dir presence is enough.
const apiDir = path.join(root, ".next", "server", "app", "api");
if (!exists(apiDir)) {
  console.error("[assert-not-static] Missing .next/server/app/api — API routes not built.");
  process.exit(1);
}

console.log("[assert-not-static] OK — server API output present, no out/ export.");
