import type { NextConfig } from "next";

/**
 * Never set `output: "export"` or `distDir: "out"`.
 * Route Handlers under `app/api/**` need Vercel’s Next.js serverless
 * runtime. If Vercel Project Settings → Output Directory is `out`,
 * production `/api/*` returns HTML 500 with `nextExport: true`.
 */
const nextConfig: NextConfig = {};

export default nextConfig;
