export type Mode = "ai_qa" | "manual_csv";
export type AiProvider = "openai" | "gemini";

export type AiModelOption = {
  id: string;
  /** Shown in the UI select */
  label: string;
};

/** OpenAI chat/completions-style model ids (API `model` string). */
const OPENAI_MODEL_OPTIONS: readonly AiModelOption[] = [
  { id: "gpt-4.1-mini", label: "GPT-4.1 Mini — fast / cheap (default)" },
  { id: "gpt-4.1", label: "GPT-4.1 — strong general" },
  { id: "gpt-4.1-nano", label: "GPT-4.1 Nano — lowest cost" },
  { id: "gpt-4o", label: "GPT-4o — multimodal" },
  { id: "gpt-4o-mini", label: "GPT-4o Mini" },
  { id: "gpt-5", label: "GPT-5 — flagship reasoning" },
  { id: "gpt-5-mini", label: "GPT-5 Mini" },
  { id: "gpt-5-nano", label: "GPT-5 Nano" },
  { id: "gpt-5.6-luna", label: "GPT-5.6 Luna — cost-efficient" },
  { id: "gpt-5.6-terra", label: "GPT-5.6 Terra — balanced" },
  { id: "gpt-5.6-sol", label: "GPT-5.6 Sol — strongest" },
  { id: "o3-mini", label: "o3 Mini — reasoning" },
  { id: "o4-mini", label: "o4 Mini — reasoning" },
] as const;

/** Gemini generative model ids. */
const GEMINI_MODEL_OPTIONS: readonly AiModelOption[] = [
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash — fast (default)" },
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro — strongest" },
  { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash-Lite — cheapest" },
  { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
  { id: "gemini-2.0-flash-lite", label: "Gemini 2.0 Flash-Lite" },
  { id: "gemini-2.0-pro-exp", label: "Gemini 2.0 Pro (experimental)" },
  { id: "gemini-1.5-pro", label: "Gemini 1.5 Pro" },
  { id: "gemini-1.5-flash", label: "Gemini 1.5 Flash" },
] as const;

export const AI_MODEL_OPTIONS: Record<
  AiProvider,
  readonly AiModelOption[]
> = {
  openai: OPENAI_MODEL_OPTIONS,
  gemini: GEMINI_MODEL_OPTIONS,
};

/** Model ids only (for validation / env defaults). */
export const AI_MODELS: Record<AiProvider, readonly string[]> = {
  openai: OPENAI_MODEL_OPTIONS.map((m) => m.id),
  gemini: GEMINI_MODEL_OPTIONS.map((m) => m.id),
};

export function defaultModelFor(provider: AiProvider): string {
  return provider === "openai" ? "gpt-4.1-mini" : "gemini-2.5-flash";
}

export function modelLabel(provider: AiProvider, id: string): string {
  const hit = AI_MODEL_OPTIONS[provider].find((m) => m.id === id);
  return hit?.label ?? id;
}
