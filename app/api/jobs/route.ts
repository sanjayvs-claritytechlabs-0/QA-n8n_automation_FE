import { NextRequest, NextResponse } from "next/server";
import {
  defaultJobOptions,
  jsonError,
  n8nConfig,
  type AiProvider,
  type Mode,
} from "@/lib/n8n";
import { caseFileToCsvText } from "@/lib/case-file";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Body = {
  project_name?: string;
  website_url?: string;
  mode?: Mode;
  csv_text?: string;
  csv_filename?: string;
  project_id?: string;
  callback_url?: string;
  ai_provider?: AiProvider;
  ai_model?: string;
  crawl_max_depth?: number;
  crawl_max_pages?: number;
};

type ParsedStart = {
  project_name: string;
  website_url: string;
  mode: Mode;
  csv_text: string;
  csv_filename?: string;
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

function asMode(v: unknown): Mode {
  return v === "manual_csv" ? "manual_csv" : "ai_qa";
}

function asProvider(v: unknown): AiProvider | undefined {
  return v === "openai" || v === "gemini" ? v : undefined;
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

async function parseStartRequest(request: Request): Promise<
  | { ok: true; data: ParsedStart }
  | { ok: false; response: NextResponse }
> {
  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("multipart/form-data")) {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return {
        ok: false,
        response: jsonError(
          400,
          "VALIDATION_ERROR",
          "Could not parse multipart body",
        ),
      };
    }

    const project_name = String(form.get("project_name") ?? "").trim();
    const website_url = String(form.get("website_url") ?? "").trim();
    const mode = asMode(form.get("mode"));
    const project_id = String(form.get("project_id") ?? "").trim() || undefined;
    const callback_url =
      String(form.get("callback_url") ?? "").trim() || undefined;
    const ai_provider = asProvider(form.get("ai_provider"));
    const ai_model = String(form.get("ai_model") ?? "").trim() || undefined;
    const crawl_max_depth = parseOptionalInt(form.get("crawl_max_depth"));
    const crawl_max_pages = parseOptionalInt(form.get("crawl_max_pages"));

    let csv_text = "";
    let csv_filename: string | undefined;

    const file = form.get("csv_file");
    if (file instanceof File && file.size > 0) {
      const filename = file.name || "cases.csv";
      const buf = Buffer.from(await file.arrayBuffer());
      const converted = caseFileToCsvText({ filename, buffer: buf });
      if (!converted.ok) {
        return {
          ok: false,
          response: jsonError(400, converted.code, converted.message),
        };
      }
      csv_text = converted.csv_text;
      csv_filename = converted.csv_filename;
    } else {
      const pasted = String(form.get("csv_text") ?? "");
      const fname =
        String(form.get("csv_filename") ?? "").trim() || "pasted.csv";
      if (pasted.trim()) {
        const converted = caseFileToCsvText({
          filename: fname,
          text: pasted,
        });
        if (!converted.ok) {
          return {
            ok: false,
            response: jsonError(400, converted.code, converted.message),
          };
        }
        csv_text = converted.csv_text;
        csv_filename = converted.csv_filename;
      }
    }

    return {
      ok: true,
      data: {
        project_name,
        website_url,
        mode,
        csv_text,
        csv_filename,
        project_id,
        callback_url,
        ai_provider,
        ai_model,
        crawl_max_depth,
        crawl_max_pages,
      },
    };
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return {
      ok: false,
      response: jsonError(400, "VALIDATION_ERROR", "Request body must be JSON"),
    };
  }

  const project_name = body.project_name?.trim() ?? "";
  const website_url = body.website_url?.trim() ?? "";
  const mode = asMode(body.mode);
  let csv_text = "";
  let csv_filename = body.csv_filename?.trim() || undefined;

  if (typeof body.csv_text === "string" && body.csv_text.trim()) {
    const converted = caseFileToCsvText({
      filename: csv_filename || "pasted.csv",
      text: body.csv_text,
    });
    if (!converted.ok) {
      return {
        ok: false,
        response: jsonError(400, converted.code, converted.message),
      };
    }
    csv_text = converted.csv_text;
    csv_filename = converted.csv_filename;
  }

  return {
    ok: true,
    data: {
      project_name,
      website_url,
      mode,
      csv_text,
      csv_filename,
      project_id: body.project_id?.trim() || undefined,
      callback_url: body.callback_url?.trim() || undefined,
      ai_provider: asProvider(body.ai_provider),
      ai_model: body.ai_model?.trim() || undefined,
      crawl_max_depth: parseOptionalInt(body.crawl_max_depth),
      crawl_max_pages: parseOptionalInt(body.crawl_max_pages),
    },
  };
}

export async function POST(request: Request) {
  const parsed = await parseStartRequest(request);
  if (!parsed.ok) return parsed.response;

  const {
    project_name,
    website_url,
    mode,
    csv_text,
    csv_filename,
    project_id,
    callback_url,
    ai_provider,
    ai_model,
    crawl_max_depth,
    crawl_max_pages,
  } = parsed.data;

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
  if (mode === "manual_csv" && !csv_text.trim()) {
    return jsonError(
      400,
      "VALIDATION_ERROR",
      "Upload a .csv / .tsv / .xlsx file for Manual mode",
    );
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
  if (mode === "manual_csv") {
    payload.csv_text = csv_text;
    if (csv_filename) payload.csv_filename = csv_filename;
  }
  if (project_id) payload.project_id = project_id;
  if (callback_url) payload.callback_url = callback_url;

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
