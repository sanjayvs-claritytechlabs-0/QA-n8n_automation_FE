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

/** Server-side defaults injected into Create-or-Start options. */
export function defaultJobOptions(
  mode: Mode,
  overrides?: { ai_provider?: AiProvider; ai_model?: string },
) {
  const envProvider = (env("AI_PROVIDER") || "gemini").toLowerCase();
  const provider: AiProvider =
    overrides?.ai_provider === "openai" || overrides?.ai_provider === "gemini"
      ? overrides.ai_provider
      : envProvider === "openai"
        ? "openai"
        : "gemini";

  const options: Record<string, unknown> = {
    mode,
    playwright_service_url: requireEnv("PLAYWRIGHT_SERVICE_URL").replace(/\/$/, ""),
    s3_bucket: requireEnv("S3_BUCKET"),
    browser: env("BROWSER") ?? "chromium",
    ai_provider: provider,
    ai_model:
      overrides?.ai_model?.trim() ||
      env("AI_MODEL") ||
      defaultModelFor(provider),
  };
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
