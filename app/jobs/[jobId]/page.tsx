"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CodeEditor,
  formatPlanJson,
  parsePlanDocument,
  planToEditorText,
} from "../../../components/PlanJsonEditor";

type Stage = {
  stage_key: string;
  status: string;
  attempt?: number;
  error_code?: string | null;
  error_message?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
};

type PlanStep = {
  ordinal?: number;
  action?: string;
  description?: string | null;
  locator_id?: string | null;
  value?: string | null;
  status?: string | null;
  gap_reason?: string | null;
};

type PlanAssertion = {
  type?: string;
  expected?: string | null;
  locator_id?: string | null;
};

type PlanDoc = {
  status?: string;
  summary?: string;
  steps: PlanStep[];
  assertions: PlanAssertion[];
};

type CaseRow = {
  test_case_id: string | null;
  test_plan_id: string | null;
  title: string;
  external_id?: string | null;
  sort_order?: number;
  plan?: {
    status?: string;
    summary?: string;
    steps?: PlanStep[];
    assertions?: PlanAssertion[];
  };
  playwright_source?: string | null;
  execution_result_id?: string | null;
  status?: string | null;
  duration_ms?: number | null;
  error_message?: string | null;
};

type LocatorOpt = {
  id: string;
  name?: string | null;
  strategy?: string | null;
  selector?: string | null;
  page_id?: string | null;
  role?: string | null;
  accessible_name?: string | null;
};

type ArtifactRow = {
  id: string;
  kind: string;
  object_key?: string | null;
  url?: string | null;
  content_type?: string | null;
  bytes?: number | null;
  meta?: Record<string, unknown> | null;
  execution_result_id?: string | null;
  created_at?: string | null;
};

type JobStatus = {
  ok: boolean;
  job_id: string;
  project_id?: string;
  status: string;
  current_stage?: string | null;
  stages?: Stage[];
  cases?: CaseRow[];
  locators?: LocatorOpt[];
  artifacts?: ArtifactRow[];
  report_url?: string | null;
  report_object_key?: string | null;
  report_json_object_key?: string | null;
  result_summary?: {
    counts?: {
      total?: number;
      passed?: number;
      failed?: number;
      error?: number;
      skipped?: number;
    };
    pass_rate?: number | null;
  } | null;
  error?: { code?: string; message?: string } | null;
  finished_at?: string | null;
  created_at?: string | null;
};

const STEP_ACTIONS = [
  "goto",
  "fill",
  "click",
  "check",
  "uncheck",
  "select",
  "press",
  "wait",
  "assert",
] as const;

const LOCATOR_STRATEGIES = [
  "testid",
  "role",
  "css",
  "xpath",
  "text",
  "placeholder",
  "label",
] as const;

const TERMINAL = new Set(["succeeded", "failed", "cancelled"]);
const POLL_MS = 4000;

function artifactHref(a: ArtifactRow, jobId: string): string | null {
  const format =
    a.meta && typeof a.meta.format === "string" ? a.meta.format : null;
  if (a.kind === "report" && format === "html") {
    return `/api/jobs/${encodeURIComponent(jobId)}/report`;
  }
  if (a.object_key) {
    return `/api/artifacts?key=${encodeURIComponent(a.object_key)}`;
  }
  if (a.url?.startsWith("s3://")) {
    return `/api/artifacts?url=${encodeURIComponent(a.url)}`;
  }
  if (a.url?.startsWith("http://") || a.url?.startsWith("https://")) {
    return a.url;
  }
  return null;
}

function artifactLabel(a: ArtifactRow): string {
  const format =
    a.meta && typeof a.meta.format === "string" ? a.meta.format : null;
  if (a.kind === "report" && format) return `report.${format}`;
  const key = a.object_key || "";
  const base = key.split("/").pop();
  return base || a.kind || "artifact";
}

function locatorLabel(l: LocatorOpt): string {
  const name = l.name || l.accessible_name || l.role || "locator";
  return `${name} · ${l.strategy || "?"} · ${l.id.slice(0, 8)}`;
}

function emptyStep(ordinal: number): PlanStep {
  return {
    ordinal,
    action: "click",
    description: "",
    locator_id: null,
    value: null,
    status: "unmapped",
    gap_reason: null,
  };
}

function emptyAssertion(): PlanAssertion {
  return { type: "url_contains", expected: "", locator_id: null };
}

function planFromRow(plan: CaseRow["plan"]): PlanDoc {
  return {
    status: plan?.status ?? "ready",
    summary: plan?.summary ?? "",
    steps: Array.isArray(plan?.steps)
      ? plan!.steps!.map((s, i) => ({
          ordinal: s.ordinal ?? i + 1,
          action: s.action || "click",
          description: s.description ?? "",
          locator_id: s.locator_id ?? null,
          value: s.value ?? null,
          status: s.status ?? null,
          gap_reason: s.gap_reason ?? null,
        }))
      : [],
    assertions: Array.isArray(plan?.assertions)
      ? plan!.assertions!.map((a) => ({
          type: a.type || "assert",
          expected: a.expected ?? "",
          locator_id: a.locator_id ?? null,
        }))
      : [],
  };
}

function CaseEditor({
  jobId,
  row,
  locators,
  onSaved,
  onLocatorsChanged,
}: {
  jobId: string;
  row: CaseRow;
  locators: LocatorOpt[];
  onSaved: () => void;
  onLocatorsChanged: () => void;
}) {
  const [open, setOpen] = useState(
    () => row.status === "failed" || row.status === "error",
  );
  const [plan, setPlan] = useState<PlanDoc>(() => planFromRow(row.plan));
  const [planText, setPlanText] = useState(() => planToEditorText(row.plan));
  const [tab, setTab] = useState<"form" | "json" | "source">("form");
  const [busy, setBusy] = useState<
    "save" | "rerun" | "delete" | "locator" | null
  >(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [addLocatorOpen, setAddLocatorOpen] = useState(false);
  const [bindStepIdx, setBindStepIdx] = useState<number | null>(null);
  const [locName, setLocName] = useState("");
  const [locStrategy, setLocStrategy] =
    useState<(typeof LOCATOR_STRATEGIES)[number]>("testid");
  const [locSelector, setLocSelector] = useState("");
  const [locRole, setLocRole] = useState("");
  const [locA11y, setLocA11y] = useState("");
  const [locPageId, setLocPageId] = useState("");

  const hasSource =
    typeof row.playwright_source === "string" &&
    row.playwright_source.trim().length > 0;

  const pageIds = useMemo(() => {
    const ids = new Set<string>();
    for (const l of locators) {
      if (l.page_id) ids.add(l.page_id);
    }
    return Array.from(ids);
  }, [locators]);

  const planKey = useMemo(
    () => JSON.stringify(row.plan ?? null),
    [row.plan],
  );

  useEffect(() => {
    const next = planFromRow(row.plan);
    setPlan(next);
    setPlanText(planToEditorText(row.plan));
    setJsonError(null);
  }, [row.test_plan_id, planKey, row.plan]);

  function switchTab(next: "form" | "json" | "source") {
    if (next === tab) return;
    if (tab === "form" && next === "json") {
      setPlanText(planToEditorText(plan));
      setJsonError(null);
    }
    if (tab === "json" && next === "form") {
      const parsed = parsePlanDocument(planText);
      if (!parsed.ok) {
        setJsonError(parsed.error);
        setMsg("Fix JSON before switching to Edit steps");
        return;
      }
      setPlan({
        status: parsed.plan.status ?? "ready",
        summary: parsed.plan.summary ?? "",
        steps: (parsed.plan.steps as PlanStep[]) || [],
        assertions: (parsed.plan.assertions as PlanAssertion[]) || [],
      });
      setJsonError(null);
    }
    setTab(next);
  }

  function updateStep(idx: number, patch: Partial<PlanStep>) {
    setPlan((prev) => ({
      ...prev,
      steps: prev.steps.map((s, i) => (i === idx ? { ...s, ...patch } : s)),
    }));
  }

  function updateAssertion(idx: number, patch: Partial<PlanAssertion>) {
    setPlan((prev) => ({
      ...prev,
      assertions: prev.assertions.map((a, i) =>
        i === idx ? { ...a, ...patch } : a,
      ),
    }));
  }

  async function deleteCase() {
    if (!row.test_case_id) return;
    const ok = window.confirm(
      `Delete case "${row.title}"?\n\nRemoves related plans, results, and linked S3 artifacts.`,
    );
    if (!ok) return;
    setBusy("delete");
    setMsg(null);
    try {
      const res = await fetch(
        `/api/jobs/${encodeURIComponent(jobId)}/cases/${encodeURIComponent(row.test_case_id)}`,
        { method: "DELETE" },
      );
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setMsg(
          data?.error?.message ||
            data?.error?.code ||
            `Delete failed (${res.status})`,
        );
        return;
      }
      onSaved();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setBusy(null);
    }
  }

  if (!row.test_plan_id) {
    return (
      <li className="case-row">
        <div className="case-head">
          <span className="case-title">{row.title || "Untitled"}</span>
          <span className="meta">no plan</span>
        </div>
        {row.test_case_id ? (
          <div className="actions" style={{ marginTop: "0.5rem" }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={busy !== null}
              onClick={() => void deleteCase()}
            >
              {busy === "delete" ? "Deleting…" : "Delete case"}
            </button>
          </div>
        ) : null}
        {msg ? <p className="footer-note">{msg}</p> : null}
      </li>
    );
  }

  const planId = row.test_plan_id;

  function formatJson() {
    const r = formatPlanJson(planText);
    if (!r.ok) {
      setJsonError(r.error);
      setMsg(null);
      return;
    }
    setPlanText(r.text);
    setJsonError(null);
    setMsg("Formatted");
  }

  function planPayloadFromForm(): PlanDoc {
    return {
      status: plan.status || "ready",
      summary: plan.summary || "",
      steps: plan.steps.map((s, i) => ({
        ordinal: i + 1,
        action: (s.action || "click").toLowerCase(),
        description: s.description || null,
        locator_id: s.locator_id || null,
        value: s.value === "" || s.value == null ? null : String(s.value),
        status: s.status ?? null,
        gap_reason: s.gap_reason ?? null,
      })),
      assertions: plan.assertions.map((a) => ({
        type: a.type || "assert",
        expected: a.expected === "" || a.expected == null ? null : String(a.expected),
        locator_id: a.locator_id || null,
      })),
    };
  }

  async function save() {
    setBusy("save");
    setMsg(null);
    let payload: PlanDoc;
    if (tab === "json") {
      const parsed = parsePlanDocument(planText);
      if (!parsed.ok) {
        setJsonError(parsed.error);
        setBusy(null);
        return;
      }
      setJsonError(null);
      payload = {
        status: parsed.plan.status,
        summary: parsed.plan.summary,
        steps: parsed.plan.steps as PlanStep[],
        assertions: parsed.plan.assertions as PlanAssertion[],
      };
      setPlan(payload);
    } else {
      payload = planPayloadFromForm();
      setPlanText(planToEditorText(payload));
    }
    try {
      const res = await fetch(
        `/api/jobs/${encodeURIComponent(jobId)}/plans/${encodeURIComponent(planId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ plan: payload }),
        },
      );
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setMsg(
          data?.error?.message ||
            data?.error?.code ||
            `Save failed (${res.status})`,
        );
        return;
      }
      setMsg(data.plan_status === "blocked" ? "Saved (blocked)" : "Saved");
      onSaved();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(null);
    }
  }

  async function rerun() {
    setBusy("rerun");
    setMsg(null);
    try {
      const res = await fetch(
        `/api/jobs/${encodeURIComponent(jobId)}/plans/${encodeURIComponent(planId)}/rerun`,
        { method: "POST" },
      );
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setMsg(
          data?.error?.message ||
            data?.error?.code ||
            `Re-run failed (${res.status})`,
        );
        return;
      }
      setMsg(`Re-run: ${data.execution_result?.status || "done"}`);
      onSaved();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Re-run failed");
    } finally {
      setBusy(null);
    }
  }

  async function createLocator() {
    const selector = locSelector.trim();
    if (!selector) {
      setMsg("Selector is required for a custom locator");
      return;
    }
    setBusy("locator");
    setMsg(null);
    try {
      const res = await fetch(
        `/api/jobs/${encodeURIComponent(jobId)}/locators`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: locName.trim() || null,
            strategy: locStrategy,
            selector,
            role: locRole.trim() || null,
            accessible_name: locA11y.trim() || null,
            page_id: locPageId.trim() || null,
          }),
        },
      );
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok || !data.locator?.id) {
        setMsg(
          data?.error?.message ||
            data?.error?.code ||
            `Add locator failed (${res.status})`,
        );
        return;
      }
      const newId = String(data.locator.id);
      if (bindStepIdx != null) {
        updateStep(bindStepIdx, { locator_id: newId });
      }
      setLocName("");
      setLocSelector("");
      setLocRole("");
      setLocA11y("");
      setLocPageId("");
      setAddLocatorOpen(false);
      setBindStepIdx(null);
      setMsg(`Locator added ${newId.slice(0, 8)}…`);
      onLocatorsChanged();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Add locator failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <li className="case-row">
      <button
        type="button"
        className="case-head case-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="case-title">{row.title || "Untitled"}</span>
        <span className={`status-pill status-${row.status || "pending"}`}>
          {row.status || "no result"}
        </span>
      </button>
      {row.error_message ? (
        <p className="case-error">{row.error_message}</p>
      ) : null}
      {open && (
        <div className="case-editor">
          <p className="meta case-editor-hint">
            Edit steps &amp; locators (not Playwright scripts). Execution uses
            catalog locator UUIDs only.
          </p>

          <div className="editor-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "form"}
              className={`editor-tab${tab === "form" ? " active" : ""}`}
              onClick={() => switchTab("form")}
            >
              Edit steps
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "json"}
              className={`editor-tab${tab === "json" ? " active" : ""}`}
              onClick={() => switchTab("json")}
            >
              Advanced JSON
            </button>
            {hasSource ? (
              <button
                type="button"
                role="tab"
                aria-selected={tab === "source"}
                className={`editor-tab${tab === "source" ? " active" : ""}`}
                onClick={() => switchTab("source")}
              >
                Playwright source (read-only)
              </button>
            ) : null}
          </div>

          {tab === "form" ? (
            <>
              <label className="field">
                <span>Summary</span>
                <input
                  value={plan.summary ?? ""}
                  disabled={busy !== null}
                  onChange={(e) =>
                    setPlan((p) => ({ ...p, summary: e.target.value }))
                  }
                />
              </label>
              <label className="field">
                <span>Plan status</span>
                <select
                  value={plan.status === "blocked" ? "blocked" : "ready"}
                  disabled={busy !== null}
                  onChange={(e) =>
                    setPlan((p) => ({ ...p, status: e.target.value }))
                  }
                >
                  <option value="ready">ready</option>
                  <option value="blocked">blocked</option>
                </select>
                <span className="hint">
                  Save re-validates: interactive steps without a locator become
                  blocked.
                </span>
              </label>

              <div className="steps-head">
                <strong>Steps</strong>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={busy !== null}
                  onClick={() =>
                    setPlan((p) => ({
                      ...p,
                      steps: [...p.steps, emptyStep(p.steps.length + 1)],
                    }))
                  }
                >
                  Add step
                </button>
              </div>
              {plan.steps.length === 0 ? (
                <p className="meta">No steps yet.</p>
              ) : (
                plan.steps.map((s, idx) => (
                  <div key={idx} className="step-row">
                    <span className="step-ord">{idx + 1}</span>
                    <select
                      aria-label={`Step ${idx + 1} action`}
                      value={s.action || "click"}
                      disabled={busy !== null}
                      onChange={(e) =>
                        updateStep(idx, { action: e.target.value })
                      }
                    >
                      {STEP_ACTIONS.map((a) => (
                        <option key={a} value={a}>
                          {a}
                        </option>
                      ))}
                    </select>
                    <input
                      aria-label={`Step ${idx + 1} description`}
                      placeholder="Description"
                      value={s.description ?? ""}
                      disabled={busy !== null}
                      onChange={(e) =>
                        updateStep(idx, { description: e.target.value })
                      }
                    />
                    <select
                      aria-label={`Step ${idx + 1} locator`}
                      value={s.locator_id || ""}
                      disabled={busy !== null}
                      onChange={(e) =>
                        updateStep(idx, {
                          locator_id: e.target.value || null,
                        })
                      }
                    >
                      <option value="">No locator</option>
                      {locators.map((l) => (
                        <option key={l.id} value={l.id}>
                          {locatorLabel(l)}
                        </option>
                      ))}
                    </select>
                    <input
                      aria-label={`Step ${idx + 1} value`}
                      placeholder="Value"
                      value={s.value ?? ""}
                      disabled={busy !== null}
                      onChange={(e) =>
                        updateStep(idx, { value: e.target.value })
                      }
                    />
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      title="Add custom locator for this step"
                      disabled={busy !== null}
                      onClick={() => {
                        setBindStepIdx(idx);
                        setAddLocatorOpen(true);
                      }}
                    >
                      + loc
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={busy !== null}
                      onClick={() =>
                        setPlan((p) => ({
                          ...p,
                          steps: p.steps.filter((_, i) => i !== idx),
                        }))
                      }
                    >
                      ×
                    </button>
                  </div>
                ))
              )}

              <div className="steps-head">
                <strong>Assertions</strong>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={busy !== null}
                  onClick={() =>
                    setPlan((p) => ({
                      ...p,
                      assertions: [...p.assertions, emptyAssertion()],
                    }))
                  }
                >
                  Add assertion
                </button>
              </div>
              {plan.assertions.map((a, idx) => (
                <div key={idx} className="step-row assertion-row">
                  <span className="step-ord">{idx + 1}</span>
                  <input
                    aria-label={`Assertion ${idx + 1} type`}
                    placeholder="type"
                    value={a.type ?? ""}
                    disabled={busy !== null}
                    onChange={(e) =>
                      updateAssertion(idx, { type: e.target.value })
                    }
                  />
                  <input
                    aria-label={`Assertion ${idx + 1} expected`}
                    placeholder="expected"
                    value={a.expected ?? ""}
                    disabled={busy !== null}
                    onChange={(e) =>
                      updateAssertion(idx, { expected: e.target.value })
                    }
                  />
                  <select
                    aria-label={`Assertion ${idx + 1} locator`}
                    value={a.locator_id || ""}
                    disabled={busy !== null}
                    onChange={(e) =>
                      updateAssertion(idx, {
                        locator_id: e.target.value || null,
                      })
                    }
                  >
                    <option value="">No locator</option>
                    {locators.map((l) => (
                      <option key={l.id} value={l.id}>
                        {locatorLabel(l)}
                      </option>
                    ))}
                  </select>
                  <span />
                  <span />
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={busy !== null}
                    onClick={() =>
                      setPlan((p) => ({
                        ...p,
                        assertions: p.assertions.filter((_, i) => i !== idx),
                      }))
                    }
                  >
                    ×
                  </button>
                </div>
              ))}

              <div className="steps-head">
                <strong>Custom locator</strong>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={busy !== null}
                  onClick={() => {
                    setBindStepIdx(null);
                    setAddLocatorOpen((v) => !v);
                  }}
                >
                  {addLocatorOpen ? "Cancel" : "Add custom locator"}
                </button>
              </div>
              {addLocatorOpen ? (
                <div className="locator-create form">
                  <p className="meta case-editor-hint">
                    Inserts into the job locator catalog, then appears in
                    dropdowns
                    {bindStepIdx != null
                      ? ` (will bind to step ${bindStepIdx + 1})`
                      : ""}
                    .
                  </p>
                  <div className="field-row">
                    <label>
                      Strategy
                      <select
                        value={locStrategy}
                        disabled={busy !== null}
                        onChange={(e) =>
                          setLocStrategy(
                            e.target.value as (typeof LOCATOR_STRATEGIES)[number],
                          )
                        }
                      >
                        {LOCATOR_STRATEGIES.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Selector
                      <input
                        required
                        value={locSelector}
                        disabled={busy !== null}
                        onChange={(e) => setLocSelector(e.target.value)}
                        placeholder="email-input"
                      />
                    </label>
                  </div>
                  <div className="field-row">
                    <label>
                      Name
                      <input
                        value={locName}
                        disabled={busy !== null}
                        onChange={(e) => setLocName(e.target.value)}
                        placeholder="email"
                      />
                    </label>
                    <label>
                      Role
                      <input
                        value={locRole}
                        disabled={busy !== null}
                        onChange={(e) => setLocRole(e.target.value)}
                        placeholder="button"
                      />
                    </label>
                  </div>
                  <div className="field-row">
                    <label>
                      Accessible name
                      <input
                        value={locA11y}
                        disabled={busy !== null}
                        onChange={(e) => setLocA11y(e.target.value)}
                      />
                    </label>
                    <label>
                      Page (optional)
                      <select
                        value={locPageId}
                        disabled={busy !== null}
                        onChange={(e) => setLocPageId(e.target.value)}
                      >
                        <option value="">None</option>
                        {pageIds.map((id) => (
                          <option key={id} value={id}>
                            {id.slice(0, 8)}…
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={busy !== null || !locSelector.trim()}
                    onClick={() => void createLocator()}
                  >
                    {busy === "locator" ? "Adding…" : "Create locator"}
                  </button>
                </div>
              ) : null}
            </>
          ) : null}

          {tab === "json" ? (
            <>
              <div className="steps-head">
                <strong>Structured plan JSON</strong>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={busy !== null}
                  onClick={() => formatJson()}
                >
                  Format JSON
                </button>
              </div>
              <CodeEditor
                value={planText}
                onChange={setPlanText}
                disabled={busy !== null}
                height="320px"
                language="json"
              />
              {jsonError ? (
                <p className="case-error" role="alert">
                  {jsonError}
                </p>
              ) : null}
            </>
          ) : null}

          {tab === "source" ? (
            <>
              <p className="meta case-editor-hint">
                Optional review/export artifact only.{" "}
                <strong>v1 execution ignores this source</strong> and uses the
                structured plan. Script edit/re-run is v2 backlog.
              </p>
              <CodeEditor
                value={row.playwright_source || ""}
                onChange={() => undefined}
                readOnly
                height="280px"
                language="typescript"
              />
            </>
          ) : null}

          <div className="actions" style={{ marginTop: "0.75rem" }}>
            <button
              type="button"
              className="btn"
              disabled={busy !== null || tab === "source"}
              onClick={() => void save()}
            >
              {busy === "save" ? "Saving…" : "Save plan"}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={busy !== null}
              onClick={() => void rerun()}
            >
              {busy === "rerun" ? "Re-running…" : "Re-run this case"}
            </button>
            {row.test_case_id ? (
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busy !== null}
                onClick={() => void deleteCase()}
              >
                {busy === "delete" ? "Deleting…" : "Delete case"}
              </button>
            ) : null}
          </div>
          {msg ? <p className="footer-note">{msg}</p> : null}
        </div>
      )}
    </li>
  );
}

export default function JobPage() {
  const params = useParams();
  const jobId = String(params.jobId ?? "");
  const [job, setJob] = useState<JobStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [polling, setPolling] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newSteps, setNewSteps] = useState("");
  const [newExpected, setNewExpected] = useState("");
  const [createBusy, setCreateBusy] = useState(false);
  const [opsNote, setOpsNote] = useState<string | null>(null);
  const [opsBusy, setOpsBusy] = useState<"rerun-job" | "delete-job" | null>(
    null,
  );

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`, {
        cache: "no-store",
      });
      const data = (await res.json().catch(() => null)) as JobStatus | null;
      if (!res.ok || !data?.ok) {
        const msg =
          (data as { error?: { message?: string } } | null)?.error?.message ||
          `Poll failed (${res.status})`;
        setError(msg);
        if (res.status === 404 || res.status === 400) setPolling(false);
        return;
      }
      setJob(data);
      setError(null);
      if (TERMINAL.has(data.status)) setPolling(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    }
  }, [jobId]);

  useEffect(() => {
    if (!jobId) return;
    void load();
  }, [jobId, load]);

  useEffect(() => {
    if (!polling || !jobId) return;
    const id = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(id);
  }, [polling, jobId, load]);

  const cases = useMemo(() => job?.cases ?? [], [job?.cases]);
  const locators = useMemo(() => job?.locators ?? [], [job?.locators]);
  const artifacts = useMemo(() => job?.artifacts ?? [], [job?.artifacts]);
  const showCases = cases.length > 0 || createOpen;
  const screenshots = useMemo(
    () => artifacts.filter((a) => a.kind === "screenshot"),
    [artifacts],
  );
  const videos = useMemo(
    () => artifacts.filter((a) => a.kind === "video"),
    [artifacts],
  );
  const otherArtifacts = useMemo(
    () =>
      artifacts.filter((a) => a.kind !== "screenshot" && a.kind !== "video"),
    [artifacts],
  );

  const counts = job?.result_summary?.counts;

  async function createCase() {
    setCreateBusy(true);
    setOpsNote(null);
    try {
      const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/cases`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newTitle,
          steps: newSteps,
          expected: newExpected || undefined,
          create_plan_stub: true,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setOpsNote(data?.error?.message || `Create failed (${res.status})`);
        return;
      }
      setNewTitle("");
      setNewSteps("");
      setNewExpected("");
      setCreateOpen(false);
      setOpsNote(
        "Case created (blocked plan stub). Map steps & locators in Edit steps.",
      );
      await load();
    } catch (e) {
      setOpsNote(e instanceof Error ? e.message : "Create failed");
    } finally {
      setCreateBusy(false);
    }
  }

  async function rerunJob() {
    const ok = window.confirm(
      "Re-run clones a NEW job under the same project and starts the pipeline. This job stays in history.",
    );
    if (!ok) return;
    setOpsBusy("rerun-job");
    setOpsNote(null);
    try {
      const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/rerun`, {
        method: "POST",
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok || !data.job_id) {
        setOpsNote(data?.error?.message || `Re-run failed (${res.status})`);
        return;
      }
      window.location.href = `/jobs/${data.job_id}`;
    } catch (e) {
      setOpsNote(e instanceof Error ? e.message : "Re-run failed");
    } finally {
      setOpsBusy(null);
    }
  }

  async function deleteJob() {
    const ok = window.confirm(
      "Delete this job and its S3 prefix? This cannot be undone.",
    );
    if (!ok) return;
    setOpsBusy("delete-job");
    setOpsNote(null);
    try {
      const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setOpsNote(data?.error?.message || `Delete failed (${res.status})`);
        return;
      }
      const dest = job?.project_id
        ? `/projects/${job.project_id}`
        : "/projects";
      window.location.href = dest;
    } catch (e) {
      setOpsNote(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setOpsBusy(null);
    }
  }

  return (
    <>
      <header className="page-header">
        <p className="eyebrow">Job detail</p>
        <h1>Job status</h1>
      </header>

      <div className="job-sticky" role="status" aria-live="polite">
        <div className="job-sticky-row">
          <div className="job-sticky-meta">
            {job ? (
              <span className={`status-pill status-${job.status}`}>
                {job.status}
              </span>
            ) : (
              <span className="status-pill status-pending">loading</span>
            )}
            {job?.current_stage ? (
              <span>
                Stage <code>{job.current_stage}</code>
              </span>
            ) : null}
            {polling ? <span className="polling-dot">Polling</span> : null}
          </div>
          <div className="actions" style={{ marginTop: 0 }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                setPolling(true);
                void load();
              }}
            >
              Refresh
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={opsBusy !== null}
              onClick={() => void rerunJob()}
            >
              {opsBusy === "rerun-job" ? "Cloning…" : "Re-run job"}
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={opsBusy !== null}
              onClick={() => void deleteJob()}
            >
              {opsBusy === "delete-job" ? "Deleting…" : "Delete job"}
            </button>
            {job?.project_id ? (
              <Link
                href={`/projects/${encodeURIComponent(job.project_id)}`}
                className="btn btn-secondary btn-sm"
              >
                Project
              </Link>
            ) : (
              <Link href="/projects" className="btn btn-secondary btn-sm">
                Projects
              </Link>
            )}
          </div>
        </div>
        <div className="job-sticky-meta" style={{ marginTop: "0.55rem" }}>
          <span>
            Job <code>{jobId}</code>
          </span>
          {job?.project_id ? (
            <span>
              Project <code>{job.project_id}</code>
            </span>
          ) : null}
        </div>
        {counts ? (
          <div className="job-counts" aria-label="Result counts">
            <span className="count-chip ok">{counts.passed ?? 0} passed</span>
            <span className="count-chip fail">
              {counts.failed ?? 0} failed
            </span>
            <span className="count-chip">{counts.error ?? 0} error</span>
            <span className="count-chip">{counts.skipped ?? 0} skipped</span>
            {job?.result_summary?.pass_rate != null ? (
              <span className="count-chip">
                {(job.result_summary.pass_rate * 100).toFixed(0)}% pass
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      {opsNote ? <p className="footer-note">{opsNote}</p> : null}

      {error && (
        <div
          className="alert alert-error"
          role="alert"
          style={{ marginBottom: "1rem" }}
        >
          {error}
        </div>
      )}

      {job?.error && (
        <div
          className="alert alert-error"
          role="alert"
          style={{ marginBottom: "1rem" }}
        >
          {job.error.code ? <strong>{job.error.code}: </strong> : null}
          {job.error.message ?? "Job failed"}
        </div>
      )}

      {(job?.report_object_key || job?.report_url || artifacts.length > 0) && (
        <section className="job-panel" aria-labelledby="artifacts-heading">
          <h2 id="artifacts-heading" className="section-title">
            Artifacts
          </h2>
          {(job?.report_object_key || job?.report_url) && (
            <p className="meta" style={{ marginBottom: "0.75rem" }}>
              Report:{" "}
              <a
                href={`/api/jobs/${encodeURIComponent(jobId)}/report`}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open HTML report
              </a>
              {job.report_json_object_key ? (
                <>
                  {" · "}
                  <a
                    href={`/api/artifacts?key=${encodeURIComponent(job.report_json_object_key)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    report.json
                  </a>
                </>
              ) : null}
            </p>
          )}
          {screenshots.length > 0 && (
            <>
              <h3 className="section-title" style={{ fontSize: "0.95rem" }}>
                Screenshots
              </h3>
              <div className="artifact-thumbs">
                {screenshots.map((a) => {
                  const href = artifactHref(a, jobId);
                  if (!href) return null;
                  const label = artifactLabel(a);
                  return (
                    <a
                      key={a.id}
                      className="artifact-thumb"
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={label}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={href} alt={`Screenshot: ${label}`} />
                      <span>{label}</span>
                    </a>
                  );
                })}
              </div>
            </>
          )}
          {videos.length > 0 && (
            <>
              <h3 className="section-title" style={{ fontSize: "0.95rem" }}>
                Videos
              </h3>
              <ul className="artifact-list">
                {videos.map((a) => {
                  const href = artifactHref(a, jobId);
                  return (
                    <li key={a.id}>
                      <span className="artifact-kind">video</span>
                      {href ? (
                        <a href={href} target="_blank" rel="noopener noreferrer">
                          {artifactLabel(a)}
                        </a>
                      ) : (
                        <span>{artifactLabel(a)}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          {otherArtifacts.length > 0 && (
            <>
              <h3 className="section-title" style={{ fontSize: "0.95rem" }}>
                Other
              </h3>
              <ul className="artifact-list">
                {otherArtifacts.map((a) => {
                  const href = artifactHref(a, jobId);
                  return (
                    <li key={a.id}>
                      <span className="artifact-kind">{a.kind}</span>
                      {href ? (
                        <a href={href} target="_blank" rel="noopener noreferrer">
                          {artifactLabel(a)}
                        </a>
                      ) : (
                        <span>{artifactLabel(a)}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          {!job?.report_object_key &&
            !job?.report_url &&
            artifacts.length === 0 && (
              <p className="meta">No artifacts yet.</p>
            )}
        </section>
      )}

      {job?.stages && job.stages.length > 0 && (
        <section className="job-panel" aria-labelledby="stages-heading">
          <h2 id="stages-heading" className="section-title">
            Stages
          </h2>
          <ol className="stages">
            {job.stages.map((s) => (
              <li key={s.stage_key}>
                <span className="stage-key">{s.stage_key}</span>
                <span className={`status-pill status-${s.status}`}>
                  {s.status}
                  {s.attempt ? ` ·${s.attempt}` : ""}
                </span>
                {(s.error_code || s.error_message) && (
                  <span className="stage-error">
                    {[s.error_code, s.error_message].filter(Boolean).join(": ")}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}

      <section className="job-panel" aria-labelledby="cases-heading">
        <div className="jobs-head">
          <h2 id="cases-heading" className="section-title">
            Cases (edit steps &amp; locators)
          </h2>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setCreateOpen((v) => !v)}
          >
            {createOpen ? "Cancel" : "Add case"}
          </button>
        </div>
        <p className="meta" style={{ marginBottom: "0.75rem" }}>
          Form editor binds catalog locators; Advanced JSON is optional. Save,
          then Re-run this case. Playwright source (if present) is review-only —
          v1 does not execute scripts.
        </p>

        {createOpen ? (
          <form
            className="form"
            style={{ marginBottom: "1rem" }}
            onSubmit={(e) => {
              e.preventDefault();
              void createCase();
            }}
          >
            <label>
              Title
              <input
                required
                maxLength={500}
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Manual smoke — Learn more"
              />
            </label>
            <label>
              Steps
              <span className="hint">One per line, or pipe-separated</span>
              <textarea
                value={newSteps}
                onChange={(e) => setNewSteps(e.target.value)}
                rows={4}
                placeholder={"1. Open home\n2. Click Learn more"}
              />
            </label>
            <label>
              Expected
              <input
                value={newExpected}
                onChange={(e) => setNewExpected(e.target.value)}
                placeholder="Learn more link works"
              />
            </label>
            <button type="submit" disabled={createBusy || !newTitle.trim()}>
              {createBusy ? "Creating…" : "Create case + plan stub"}
            </button>
          </form>
        ) : null}

        {showCases && cases.length > 0 ? (
          <ul className="cases">
            {cases.map((c) => (
              <CaseEditor
                key={c.test_plan_id || c.test_case_id || c.title}
                jobId={jobId}
                row={c}
                locators={locators}
                onSaved={() => void load()}
                onLocatorsChanged={() => void load()}
              />
            ))}
          </ul>
        ) : !createOpen ? (
          <p className="meta">No cases yet.</p>
        ) : null}
      </section>

      {(job?.created_at || job?.finished_at) && (
        <p className="footer-note">
          {job.created_at ? <>Created {job.created_at}</> : null}
          {job.finished_at ? <> · Finished {job.finished_at}</> : null}
        </p>
      )}
    </>
  );
}
