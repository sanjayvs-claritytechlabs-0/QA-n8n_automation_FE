import { NextResponse } from "next/server";
import {
  defaultJobOptions,
  jsonError,
  n8nConfig,
  type Mode,
} from "@/lib/n8n";

type Body = {
  project_name?: string;
  website_url?: string;
  mode?: Mode;
  csv_text?: string;
  project_id?: string;
  callback_url?: string;
};

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
    options = defaultJobOptions(mode);
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
    return NextResponse.json(data ?? { ok: false, error: { code: "UPSTREAM_ERROR", message: "Empty response" } }, {
      status: res.status,
    });
  } catch (e) {
    return jsonError(
      502,
      "UPSTREAM_UNAVAILABLE",
      e instanceof Error ? e.message : "Failed to reach n8n",
    );
  }
}
