import { NextRequest, NextResponse } from "next/server";
import {
  defaultJobOptions,
  jsonError,
  n8nConfig,
  type AiProvider,
  type Mode,
} from "@/lib/n8n";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Body = {
  project_name?: string;
  website_url?: string;
  mode?: Mode;
  csv_text?: string;
  project_id?: string;
  callback_url?: string;
  ai_provider?: AiProvider;
  ai_model?: string;
  crawl_max_depth?: number;
  crawl_max_pages?: number;
};

function parseOptionalInt(v: unknown): number | undefined {
  if (v == null || v === "") return undefined;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return undefined;
  return Math.floor(n);
}

/** Recent jobs for home dashboard → n8n GET /webhook/qa/jobs */
export async function GET(request: NextRequest) {
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

  const limitRaw = request.nextUrl.searchParams.get("limit");
  let limit = Number(limitRaw);
  if (!Number.isInteger(limit) || limit < 1) limit = 50;
  if (limit > 100) limit = 100;

  try {
    const res = await fetch(
      `${cfg.baseUrl}/webhook/qa/jobs?limit=${limit}`,
      {
        method: "GET",
        headers: { "X-QA-Token": cfg.token },
        cache: "no-store",
      },
    );
    const data = (await res.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!res.ok) {
      const upstreamMsg =
        data && typeof data === "object"
          ? typeof data.error === "string"
            ? data.error
            : data.error &&
                typeof data.error === "object" &&
                typeof (data.error as { message?: unknown }).message ===
                  "string"
              ? String((data.error as { message: string }).message)
              : typeof data.message === "string"
                ? data.message
                : null
          : null;
      return NextResponse.json(
        data?.error
          ? data
          : {
              ok: false,
              error: {
                code: "UPSTREAM_ERROR",
                message:
                  upstreamMsg ||
                  `n8n returned HTTP ${res.status} (is Jobs List published? check N8N_BASE_URL / QA_WEBHOOK_TOKEN)`,
              },
            },
        { status: res.status >= 400 ? res.status : 502 },
      );
    }
    return NextResponse.json(data ?? { ok: true, jobs: [], count: 0 });
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    return jsonError(502, "UPSTREAM_UNAVAILABLE", err.message);
  }
}

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return jsonError(400, "VALIDATION_ERROR", "Request body must be JSON");
  }

  const project_name = body.project_name?.trim() ?? "";
  const website_url = body.website_url?.trim() ?? "";
  const mode: Mode = body.mode === "manual_csv" ? "manual_csv" : "ai_qa";
  const csv_text = body.csv_text?.trim() ?? "";
  const ai_provider: AiProvider | undefined =
    body.ai_provider === "openai" || body.ai_provider === "gemini"
      ? body.ai_provider
      : undefined;
  const ai_model = body.ai_model?.trim() || undefined;
  const crawl_max_depth = parseOptionalInt(body.crawl_max_depth);
  const crawl_max_pages = parseOptionalInt(body.crawl_max_pages);

  if (!project_name) {
    return jsonError(400, "VALIDATION_ERROR", "project_name is required");
  }
  if (!website_url) {
    return jsonError(400, "VALIDATION_ERROR", "website_url is required");
  }
  try {
    const u = new URL(website_url);
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      return jsonError(400, "VALIDATION_ERROR", "website_url must be http or https");
    }
  } catch {
    return jsonError(400, "VALIDATION_ERROR", "website_url is not a valid URL");
  }
  if (mode === "manual_csv" && !csv_text) {
    return jsonError(400, "VALIDATION_ERROR", "csv_text is required for manual_csv mode");
  }

  let cfg: ReturnType<typeof n8nConfig>;
  let options: Record<string, unknown>;
  try {
    cfg = n8nConfig();
    options = defaultJobOptions(mode, {
      ai_provider,
      ai_model,
      crawl_max_depth,
      crawl_max_pages,
    });
  } catch (e) {
    return jsonError(
      500,
      "CONFIG_ERROR",
      e instanceof Error ? e.message : "Server misconfigured",
    );
  }

  const payload: Record<string, unknown> = {
    project_name,
    website_url,
    options,
  };
  if (mode === "manual_csv") payload.csv_text = csv_text;
  if (body.project_id?.trim()) payload.project_id = body.project_id.trim();
  if (body.callback_url?.trim()) payload.callback_url = body.callback_url.trim();

  try {
    const res = await fetch(`${cfg.baseUrl}/webhook/qa/create-or-start`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-QA-Token": cfg.token,
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const upstreamMsg =
        data && typeof data === "object" && data.error
          ? typeof data.error === "string"
            ? data.error
            : (data.error as { message?: string }).message
          : null;
      return NextResponse.json(
        data ?? {
          ok: false,
          error: {
            code: "UPSTREAM_ERROR",
            message:
              upstreamMsg ||
              `n8n returned HTTP ${res.status} (is Create-or-Start published? check N8N_BASE_URL)`,
          },
        },
        { status: res.status >= 400 ? res.status : 502 },
      );
    }
    return NextResponse.json(data ?? { ok: true }, { status: res.status });
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    const cause =
      err.cause && typeof err.cause === "object" && "code" in err.cause
        ? String((err.cause as { code?: string }).code)
        : "";
    const hint =
      cause === "ENOTFOUND"
        ? ` DNS lookup failed for N8N_BASE_URL host — check Railway n8n public URL in Frontend/.env`
        : cause
          ? ` (${cause})`
          : "";
    return jsonError(
      502,
      "UPSTREAM_UNAVAILABLE",
      `${err.message}${hint}`,
    );
  }
}
