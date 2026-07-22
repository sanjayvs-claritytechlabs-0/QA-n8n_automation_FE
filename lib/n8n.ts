import { NextResponse } from "next/server";

export type Mode = "ai_qa" | "manual_csv";
export type AiProvider = "openai" | "gemini";

const OPENAI_MODELS = ["gpt-4.1-mini", "gpt-4.1", "gpt-4o-mini", "gpt-4o"] as const;
const GEMINI_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.0-flash",
  "gemini-2.0-flash-lite",
] as const;

export const AI_MODELS: Record<AiProvider, readonly string[]> = {
  openai: OPENAI_MODELS,
  gemini: GEMINI_MODELS,
};

export function defaultModelFor(provider: AiProvider): string {
  return provider === "openai" ? "gpt-4.1-mini" : "gemini-2.5-flash";
}

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

/** Server-side defaults; UI may override crawl/browser/ai fields. */
export function defaultJobOptions(
  mode: Mode,
  overrides?: {
    ai_provider?: AiProvider;
    ai_model?: string;
    crawl_max_depth?: number;
    crawl_max_pages?: number;
    browser?: string;
  },
) {
  const envProvider = (env("AI_PROVIDER") || "gemini").toLowerCase();
  const provider: AiProvider =
    overrides?.ai_provider === "openai" || overrides?.ai_provider === "gemini"
      ? overrides.ai_provider
      : envProvider === "openai"
        ? "openai"
        : "gemini";

  const depthRaw =
    overrides?.crawl_max_depth ?? Number(env("CRAWL_MAX_DEPTH") || 1);
  const pagesRaw =
    overrides?.crawl_max_pages ?? Number(env("CRAWL_MAX_PAGES") || 8);
  const crawl_max_depth = Math.min(
    5,
    Math.max(0, Number.isFinite(depthRaw) ? Math.floor(depthRaw) : 1),
  );
  const crawl_max_pages = Math.min(
    50,
    Math.max(1, Number.isFinite(pagesRaw) ? Math.floor(pagesRaw) : 8),
  );

  const options: Record<string, unknown> = {
    mode,
    playwright_service_url: requireEnv("PLAYWRIGHT_SERVICE_URL").replace(/\/$/, ""),
    s3_bucket: requireEnv("S3_BUCKET"),
    browser: (overrides?.browser?.trim() || env("BROWSER") || "chromium").toLowerCase(),
    ai_provider: provider,
    ai_model:
      overrides?.ai_model?.trim() ||
      env("AI_MODEL") ||
      defaultModelFor(provider),
    crawl_max_depth,
    crawl_max_pages,
  };
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
