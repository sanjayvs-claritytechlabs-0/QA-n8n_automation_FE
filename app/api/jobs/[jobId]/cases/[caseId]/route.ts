import { NextResponse } from "next/server";
import { jsonError } from "@/lib/n8n";
import {
  configError,
  n8nFetch,
  unavailable,
  upstreamError,
  withS3Cleanup,
} from "@/lib/ops";

type Ctx = { params: Promise<{ jobId: string; caseId: string }> };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** DELETE /api/jobs/[jobId]/cases/[caseId] → delete case + S3 artifact keys */
export async function DELETE(_request: Request, context: Ctx) {
  const { jobId, caseId } = await context.params;
  if (!jobId || !UUID_RE.test(jobId)) {
    return jsonError(400, "VALIDATION_ERROR", "job_id must be a UUID");
  }
  if (!caseId || !UUID_RE.test(caseId)) {
    return jsonError(400, "VALIDATION_ERROR", "caseId must be a UUID");
  }
  try {
    const { res, data } = await n8nFetch(`/webhook/qa/cases/delete`, {
      method: "POST",
      body: JSON.stringify({ job_id: jobId, test_case_id: caseId }),
    });
    if (!res.ok || !data?.ok) {
      return upstreamError(res, data, `n8n returned HTTP ${res.status}`);
    }
    return NextResponse.json(await withS3Cleanup(data));
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("Missing env")) {
      return configError(e);
    }
    return unavailable(e);
  }
}
