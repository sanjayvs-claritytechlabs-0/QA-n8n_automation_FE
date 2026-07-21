import { NextResponse } from "next/server";

export type Mode = "ai_qa" | "manual_csv";

function env(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v || undefined;
}

function requireEnv(name: string): string {
  const v = env(name);
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

export function n8nConfig() {
  return {
    baseUrl: requireEnv("N8N_BASE_URL").replace(/\/$/, ""),
    token: requireEnv("QA_WEBHOOK_TOKEN"),
  };
}

/** Server-side defaults injected into Create-or-Start options. */
export function defaultJobOptions(mode: Mode) {
  const options: Record<string, unknown> = {
    mode,
    playwright_service_url: requireEnv("PLAYWRIGHT_SERVICE_URL").replace(/\/$/, ""),
    s3_bucket: requireEnv("S3_BUCKET"),
    browser: env("BROWSER") ?? "chromium",
  };
  const aiModel = env("AI_MODEL");
  if (aiModel) options.ai_model = aiModel;
  const depth = env("CRAWL_MAX_DEPTH");
  if (depth) options.crawl_max_depth = Number(depth);
  const pages = env("CRAWL_MAX_PAGES");
  if (pages) options.crawl_max_pages = Number(pages);
  const artifactBase = env("ARTIFACT_BASE_URL");
  if (artifactBase) options.artifact_base_url = artifactBase.replace(/\/$/, "");
  return options;
}

export function jsonError(
  status: number,
  code: string,
  message: string,
  details?: unknown,
) {
  return NextResponse.json(
    { ok: false, error: { code, message, details } },
    { status },
  );
}
