import { NextResponse } from "next/server";
import { jsonError } from "@/lib/n8n";
import {
  configError,
  n8nFetch,
  unavailable,
  upstreamError,
} from "@/lib/ops";

type Ctx = { params: Promise<{ jobId: string }> };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** POST /api/jobs/[jobId]/rerun → clone new job + start orchestrator */
export async function POST(_request: Request, context: Ctx) {
  const { jobId } = await context.params;
  if (!jobId || !UUID_RE.test(jobId)) {
    return jsonError(400, "VALIDATION_ERROR", "job_id must be a UUID");
  }
  try {
    const { res, data } = await n8nFetch(`/webhook/qa/jobs/re-run`, {
      method: "POST",
      body: JSON.stringify({ job_id: jobId }),
    });
    if (!res.ok || !data?.ok) {
      return upstreamError(res, data, `n8n returned HTTP ${res.status}`);
    }
    return NextResponse.json(data, { status: res.status || 202 });
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("Missing env")) {
      return configError(e);
    }
    return unavailable(e);
  }
}
