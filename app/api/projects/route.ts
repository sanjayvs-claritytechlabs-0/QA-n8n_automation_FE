import { NextRequest, NextResponse } from "next/server";
import {
  configError,
  n8nFetch,
  unavailable,
  upstreamError,
} from "@/lib/ops";

/** GET /api/projects → n8n GET /webhook/qa/projects */
export async function GET(request: NextRequest) {
  let limit = Number(request.nextUrl.searchParams.get("limit"));
  if (!Number.isInteger(limit) || limit < 1) limit = 50;
  if (limit > 100) limit = 100;

  try {
    const { res, data } = await n8nFetch(`/webhook/qa/projects?limit=${limit}`);
    if (!res.ok) {
      return upstreamError(res, data, `n8n returned HTTP ${res.status}`);
    }
    return NextResponse.json(data ?? { ok: true, projects: [], count: 0 });
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("Missing env")) {
      return configError(e);
    }
    return unavailable(e);
  }
}
