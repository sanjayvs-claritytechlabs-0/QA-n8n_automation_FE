import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/health — proves serverless Route Handlers are running. */
export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "qa-automation-frontend",
    commit:
      process.env.VERCEL_GIT_COMMIT_SHA ||
      process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ||
      null,
    env: process.env.VERCEL_ENV || null,
    has_n8n_base: Boolean(process.env.N8N_BASE_URL?.trim()),
    has_qa_token: Boolean(process.env.QA_WEBHOOK_TOKEN?.trim()),
  });
}
