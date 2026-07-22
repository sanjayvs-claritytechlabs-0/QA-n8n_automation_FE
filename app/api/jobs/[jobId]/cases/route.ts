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

type Body = {
  title?: string;
  steps?: string | unknown[];
  expected?: string;
  external_id?: string;
  create_plan_stub?: boolean;
};

/** POST /api/jobs/[jobId]/cases → create manual test case (+ plan stub) */
export async function POST(request: Request, context: Ctx) {
  const { jobId } = await context.params;
  if (!jobId || !UUID_RE.test(jobId)) {
    return jsonError(400, "VALIDATION_ERROR", "job_id must be a UUID");
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return jsonError(400, "VALIDATION_ERROR", "Request body must be JSON");
  }

  const title = body.title?.trim() ?? "";
  if (!title) {
    return jsonError(400, "VALIDATION_ERROR", "title is required");
  }

  try {
    const { res, data } = await n8nFetch(`/webhook/qa/cases/create`, {
      method: "POST",
      body: JSON.stringify({
        job_id: jobId,
        title,
        steps: body.steps ?? "",
        expected: body.expected?.trim() || null,
        external_id: body.external_id?.trim() || null,
        create_plan_stub: body.create_plan_stub !== false,
      }),
    });
    if (!res.ok || !data?.ok) {
      return upstreamError(res, data, `n8n returned HTTP ${res.status}`);
    }
    return NextResponse.json(data, { status: res.status || 201 });
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("Missing env")) {
      return configError(e);
    }
    return unavailable(e);
  }
}
