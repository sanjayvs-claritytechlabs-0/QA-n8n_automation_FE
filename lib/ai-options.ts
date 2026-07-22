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
