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

const STRATEGIES = new Set([
  "testid",
  "role",
  "css",
  "xpath",
  "text",
  "placeholder",
  "label",
]);

type Body = {
  strategy?: string;
  selector?: string;
  name?: string | null;
  role?: string | null;
  accessible_name?: string | null;
  page_id?: string | null;
};

/** POST /api/jobs/[jobId]/locators → create custom catalog locator */
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

  const strategy = (body.strategy ?? "").trim().toLowerCase();
  const selector = (body.selector ?? "").trim();
  if (!STRATEGIES.has(strategy)) {
    return jsonError(
      400,
      "VALIDATION_ERROR",
      "strategy must be one of: testid, role, css, xpath, text, placeholder, label",
    );
  }
  if (!selector) {
    return jsonError(400, "VALIDATION_ERROR", "selector is required");
  }

  const page_id = body.page_id?.trim() || null;
  if (page_id && !UUID_RE.test(page_id)) {
    return jsonError(400, "VALIDATION_ERROR", "page_id must be a UUID");
  }

  try {
    const { res, data } = await n8nFetch(`/webhook/qa/locators/create`, {
      method: "POST",
      body: JSON.stringify({
        job_id: jobId,
        strategy,
        selector,
        name: body.name?.trim() || null,
        role: body.role?.trim() || null,
        accessible_name: body.accessible_name?.trim() || null,
        page_id,
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
