"use client";

import dynamic from "next/dynamic";
import { useCallback, useState } from "react";

const Monaco = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => (
    <p className="meta" style={{ padding: "0.75rem" }}>
      Loading editor…
    </p>
  ),
});

type Props = {
  value: string;
  onChange: (next: string) => void;
  readOnly?: boolean;
  height?: string;
  language?: string;
  disabled?: boolean;
};

/** Monaco JSON/source editor; falls back to monospace textarea if Monaco fails to mount. */
export function CodeEditor({
  value,
  onChange,
  readOnly = false,
  height = "280px",
  language = "json",
  disabled = false,
}: Props) {
  const [fallback, setFallback] = useState(false);

  const onMonacoChange = useCallback(
    (v: string | undefined) => {
      if (!readOnly && !disabled) onChange(v ?? "");
    },
    [onChange, readOnly, disabled],
  );

  if (fallback) {
    return (
      <textarea
        className="plan-code-textarea"
        value={value}
        readOnly={readOnly || disabled}
        disabled={disabled}
        spellCheck={false}
        style={{ minHeight: height }}
        onChange={(e) => onChange(e.target.value)}
        aria-label={readOnly ? "Read-only code" : "Plan JSON"}
      />
    );
  }

  return (
    <div className="plan-monaco-wrap" style={{ height }}>
      <Monaco
        height="100%"
        language={language}
        theme="vs-dark"
        value={value}
        onChange={onMonacoChange}
        options={{
          readOnly: readOnly || disabled,
          minimap: { enabled: false },
          fontSize: 13,
          lineNumbers: "on",
          scrollBeyondLastLine: false,
          wordWrap: "on",
          tabSize: 2,
          automaticLayout: true,
        }}
        onMount={(_, monaco) => {
          try {
            monaco.editor.getModels();
          } catch {
            setFallback(true);
          }
        }}
        loading={
          <p className="meta" style={{ padding: "0.75rem" }}>
            Loading editor…
          </p>
        }
      />
    </div>
  );
}

export function formatPlanJson(raw: string): { ok: true; text: string } | { ok: false; error: string } {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, error: "Plan must be a JSON object" };
    }
    return { ok: true, text: JSON.stringify(parsed, null, 2) };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Invalid JSON",
    };
  }
}

export function parsePlanDocument(
  raw: string,
):
  | {
      ok: true;
      plan: {
        summary?: string;
        status?: string;
        steps: unknown[];
        assertions: unknown[];
      };
    }
  | { ok: false; error: string } {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, error: "Plan must be a JSON object" };
    }
    if (!Array.isArray(parsed.steps)) {
      return { ok: false, error: "plan.steps must be an array" };
    }
    if (parsed.assertions !== undefined && !Array.isArray(parsed.assertions)) {
      return { ok: false, error: "plan.assertions must be an array" };
    }
    return {
      ok: true,
      plan: {
        summary:
          parsed.summary != null ? String(parsed.summary) : undefined,
        status: parsed.status != null ? String(parsed.status) : undefined,
        steps: parsed.steps,
        assertions: Array.isArray(parsed.assertions) ? parsed.assertions : [],
      },
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Invalid JSON",
    };
  }
}

export function planToEditorText(plan: {
  status?: string;
  summary?: string;
  steps?: unknown[];
  assertions?: unknown[];
} | null | undefined): string {
  const doc = {
    status: plan?.status ?? "ready",
    summary: plan?.summary ?? "",
    steps: Array.isArray(plan?.steps) ? plan!.steps : [],
    assertions: Array.isArray(plan?.assertions) ? plan!.assertions : [],
  };
  return JSON.stringify(doc, null, 2);
}
