import { NextResponse } from "next/server";
import { jsonError, n8nConfig } from "@/lib/n8n";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Ctx = { params: Promise<{ jobId: string; planId: string }> };

/**
 * POST /api/jobs/[jobId]/plans/[planId]/rerun
 * (Must live under plans/[planId], not cases/[planId] — conflicting slug
 * names caseId vs planId under cases/ break all /api/* on Vercel.)
 */
export async function POST(_request: Request, context: Ctx) {
  const { jobId, planId } = await context.params;
  if (!jobId || !UUID_RE.test(jobId)) {
    return jsonError(400, "VALIDATION_ERROR", "job_id must be a UUID");
  }
  if (!planId || !UUID_RE.test(planId)) {
    return jsonError(400, "VALIDATION_ERROR", "plan_id must be a UUID");
  }

  let cfg: ReturnType<typeof n8nConfig>;
  try {
    cfg = n8nConfig();
  } catch (e) {
    return jsonError(
      500,
      "CONFIG_ERROR",
      e instanceof Error ? e.message : "Server misconfigured",
    );
  }

  const url = `${cfg.baseUrl}/webhook/qa/cases/re-run`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-QA-Token": cfg.token,
      },
      body: JSON.stringify({
        job_id: jobId,
        test_plan_id: planId,
      }),
      cache: "no-store",
    });
    const data = await res.json().catch(() => null);
    return NextResponse.json(
      data ?? {
        ok: false,
        error: { code: "UPSTREAM_ERROR", message: "Empty response" },
      },
      { status: res.status },
    );
  } catch (e) {
    return jsonError(
      502,
      "UPSTREAM_UNAVAILABLE",
      e instanceof Error ? e.message : "Failed to reach n8n",
    );
  }
}
