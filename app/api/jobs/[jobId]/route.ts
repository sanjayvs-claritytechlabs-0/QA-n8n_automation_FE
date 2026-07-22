import { NextResponse } from "next/server";
import { jsonError, n8nConfig } from "@/lib/n8n";
import {
  configError,
  n8nFetch,
  unavailable,
  upstreamError,
  withS3Cleanup,
} from "@/lib/ops";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Ctx = { params: Promise<{ jobId: string }> };

export async function GET(_request: Request, context: Ctx) {
  const { jobId } = await context.params;
  if (!jobId || !UUID_RE.test(jobId)) {
    return jsonError(400, "VALIDATION_ERROR", "job_id must be a UUID");
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

  const url = `${cfg.baseUrl}/webhook/qa/job-status?job_id=${encodeURIComponent(jobId)}`;

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { "X-QA-Token": cfg.token },
      cache: "no-store",
    });
    const data = await res.json().catch(() => null);
    return NextResponse.json(
      data ?? { ok: false, error: { code: "UPSTREAM_ERROR", message: "Empty response" } },
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

/** DELETE job DB + best-effort S3 under qa/{project}/{job}/ */
export async function DELETE(_request: Request, context: Ctx) {
  const { jobId } = await context.params;
  if (!jobId || !UUID_RE.test(jobId)) {
    return jsonError(400, "VALIDATION_ERROR", "job_id must be a UUID");
  }
  try {
    const { res, data } = await n8nFetch(`/webhook/qa/jobs/delete`, {
      method: "POST",
      body: JSON.stringify({ job_id: jobId }),
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
