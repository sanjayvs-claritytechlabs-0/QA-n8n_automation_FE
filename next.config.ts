import type { NextConfig } from "next";

/**
 * Do not set `output: "export"`. This app needs Node serverless Route Handlers.
 * Also do not set Vercel "Output Directory" (leave empty / override off).
 */
const nextConfig: NextConfig = {
  // Explicit default — never static-export this app.
  // (Do not set `output: "export"` or `distDir: "out"`.)
};

export default nextConfig;
