import { NextResponse } from "next/server";
import { jsonError, n8nConfig } from "@/lib/n8n";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Ctx = { params: Promise<{ jobId: string; planId: string }> };

export async function POST(request: Request, context: Ctx) {
  const { jobId, planId } = await context.params;
  if (!jobId || !UUID_RE.test(jobId)) {
    return jsonError(400, "VALIDATION_ERROR", "job_id must be a UUID");
  }
  if (!planId || !UUID_RE.test(planId)) {
    return jsonError(400, "VALIDATION_ERROR", "plan_id must be a UUID");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "VALIDATION_ERROR", "JSON body required");
  }
  const plan =
    body && typeof body === "object" && body !== null && "plan" in body
      ? (body as { plan: unknown }).plan
      : body;
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) {
    return jsonError(400, "VALIDATION_ERROR", "plan object required");
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

  const url = `${cfg.baseUrl}/webhook/qa/plans/update`;
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
        plan,
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
