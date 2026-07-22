import type { NextConfig } from "next";

/**
 * Do NOT set `output: "export"`.
 * This app relies on App Router Route Handlers under `/api/**`
 * (n8n proxy + S3). Static export makes those return HTML 500s
 * (`nextExport: true`) — which is what broke jobs/projects on Vercel.
 */
const nextConfig: NextConfig = {
  // Keep default Node serverless output for Vercel.
};

export default nextConfig;
