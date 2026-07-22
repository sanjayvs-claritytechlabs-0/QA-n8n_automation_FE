import { NextRequest, NextResponse } from "next/server";
import { jsonError } from "@/lib/n8n";
import {
  configError,
  n8nFetch,
  unavailable,
  upstreamError,
  withS3Cleanup,
} from "@/lib/ops";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ projectId: string }> };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** GET /api/projects/[projectId] → n8n GET /webhook/qa/project */
export async function GET(_request: NextRequest, ctx: Ctx) {
  const { projectId } = await ctx.params;
  if (!UUID_RE.test(projectId)) {
    return jsonError(400, "VALIDATION_ERROR", "projectId must be a uuid");
  }
  try {
    const { res, data } = await n8nFetch(
      `/webhook/qa/project?project_id=${encodeURIComponent(projectId)}`,
    );
    if (!res.ok) {
      return upstreamError(res, data, `n8n returned HTTP ${res.status}`);
    }
    return NextResponse.json(data ?? { ok: true });
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("Missing env")) {
      return configError(e);
    }
    return unavailable(e);
  }
}

/** DELETE /api/projects/[projectId] → n8n delete + S3 prefix cleanup */
export async function DELETE(_request: NextRequest, ctx: Ctx) {
  const { projectId } = await ctx.params;
  if (!UUID_RE.test(projectId)) {
    return jsonError(400, "VALIDATION_ERROR", "projectId must be a uuid");
  }
  try {
    const { res, data } = await n8nFetch(`/webhook/qa/projects/delete`, {
      method: "POST",
      body: JSON.stringify({ project_id: projectId }),
    });
    if (!res.ok || !data?.ok) {
      return upstreamError(res, data, `n8n returned HTTP ${res.status}`);
    }
    const out = await withS3Cleanup(data);
    return NextResponse.json(out);
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("Missing env")) {
      return configError(e);
    }
    return unavailable(e);
  }
}
