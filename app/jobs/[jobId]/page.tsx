"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

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
};

type PlanAssertion = {
  type?: string;
  expected?: string | null;
  locator_id?: string | null;
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
  execution_result_id?: string | null;
  status?: string | null;
  duration_ms?: number | null;
  error_message?: string | null;
};

type LocatorOpt = {
  id: string;
  name?: string | null;
  strategy?: string | null;
  page_id?: string | null;
  role?: string | null;
  accessible_name?: string | null;
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

const TERMINAL = new Set(["succeeded", "failed", "cancelled"]);
const POLL_MS = 4000;
const ACTIONS = [
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

function locatorLabel(l: LocatorOpt): string {
  const name = l.name || l.accessible_name || l.role || "locator";
  return `${name} · ${l.strategy || "?"} · ${l.id.slice(0, 8)}`;
}

function CaseEditor({
  jobId,
  row,
  locators,
  onSaved,
}: {
  jobId: string;
  row: CaseRow;
  locators: LocatorOpt[];
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(
    () => row.status === "failed" || row.status === "error",
  );
  const [summary, setSummary] = useState(row.plan?.summary ?? "");
  const [steps, setSteps] = useState<PlanStep[]>(() =>
    Array.isArray(row.plan?.steps) ? row.plan!.steps!.map((s) => ({ ...s })) : [],
  );
  const [assertions, setAssertions] = useState<PlanAssertion[]>(() =>
    Array.isArray(row.plan?.assertions)
      ? row.plan!.assertions!.map((a) => ({ ...a }))
      : [],
  );
  const [busy, setBusy] = useState<"save" | "rerun" | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    setSummary(row.plan?.summary ?? "");
    setSteps(
      Array.isArray(row.plan?.steps) ? row.plan!.steps!.map((s) => ({ ...s })) : [],
    );
    setAssertions(
      Array.isArray(row.plan?.assertions)
        ? row.plan!.assertions!.map((a) => ({ ...a }))
        : [],
    );
  }, [row.test_plan_id, row.plan]);

  if (!row.test_plan_id) {
    return (
      <li className="case-row">
        <div className="case-head">
          <span className="case-title">{row.title || "Untitled"}</span>
          <span className="meta">no plan</span>
        </div>
      </li>
    );
  }

  const planId = row.test_plan_id;

  async function save() {
    setBusy("save");
    setMsg(null);
    try {
      const res = await fetch(
        `/api/jobs/${encodeURIComponent(jobId)}/plans/${encodeURIComponent(planId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            plan: {
              summary,
              steps: steps.map((s, i) => ({
                ordinal: i + 1,
                action: s.action || "assert",
                description: s.description ?? null,
                locator_id: s.locator_id || null,
                value: s.value ?? null,
              })),
              assertions: assertions.map((a) => ({
                type: a.type || "assert",
                expected: a.expected ?? null,
                locator_id: a.locator_id || null,
              })),
            },
          }),
        },
      );
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setMsg(
          data?.error?.message || data?.error?.code || `Save failed (${res.status})`,
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
        `/api/jobs/${encodeURIComponent(jobId)}/cases/${encodeURIComponent(planId)}/rerun`,
        { method: "POST" },
      );
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setMsg(
          data?.error?.message || data?.error?.code || `Re-run failed (${res.status})`,
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

  return (
    <li className="case-row">
      <button
        type="button"
        className="case-head case-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="case-title">{row.title || "Untitled"}</span>
        <span
          className={`status-pill status-${row.status || "pending"}`}
        >
          {row.status || "no result"}
        </span>
      </button>
      {row.error_message ? (
        <p className="case-error">{row.error_message}</p>
      ) : null}
      {open && (
        <div className="case-editor">
          <label className="field">
            <span>Summary</span>
            <input
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              disabled={busy !== null}
            />
          </label>

          <div className="steps-head">
            <strong>Steps</strong>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={busy !== null}
              onClick={() =>
                setSteps((prev) => [
                  ...prev,
                  { action: "click", description: "", locator_id: null, value: null },
                ])
              }
            >
              Add step
            </button>
          </div>

          {steps.map((st, idx) => (
            <div key={idx} className="step-row">
              <span className="step-ord">{idx + 1}</span>
              <select
                value={st.action || "click"}
                disabled={busy !== null}
                onChange={(e) => {
                  const action = e.target.value;
                  setSteps((prev) =>
                    prev.map((p, i) => (i === idx ? { ...p, action } : p)),
                  );
                }}
              >
                {ACTIONS.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
              <input
                placeholder="description"
                value={st.description ?? ""}
                disabled={busy !== null}
                onChange={(e) => {
                  const description = e.target.value;
                  setSteps((prev) =>
                    prev.map((p, i) => (i === idx ? { ...p, description } : p)),
                  );
                }}
              />
              <select
                value={st.locator_id ?? ""}
                disabled={busy !== null}
                onChange={(e) => {
                  const locator_id = e.target.value || null;
                  setSteps((prev) =>
                    prev.map((p, i) => (i === idx ? { ...p, locator_id } : p)),
                  );
                }}
              >
                <option value="">(no locator)</option>
                {locators.map((l) => (
                  <option key={l.id} value={l.id}>
                    {locatorLabel(l)}
                  </option>
                ))}
              </select>
              <input
                placeholder="value"
                value={st.value ?? ""}
                disabled={busy !== null}
                onChange={(e) => {
                  const value = e.target.value;
                  setSteps((prev) =>
                    prev.map((p, i) => (i === idx ? { ...p, value } : p)),
                  );
                }}
              />
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={busy !== null || idx === 0}
                onClick={() =>
                  setSteps((prev) => {
                    if (idx === 0) return prev;
                    const next = [...prev];
                    const t = next[idx - 1];
                    next[idx - 1] = next[idx];
                    next[idx] = t;
                    return next;
                  })
                }
              >
                ↑
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={busy !== null}
                onClick={() => setSteps((prev) => prev.filter((_, i) => i !== idx))}
              >
                ✕
              </button>
            </div>
          ))}

          <div className="steps-head" style={{ marginTop: "0.75rem" }}>
            <strong>Assertions</strong>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={busy !== null}
              onClick={() =>
                setAssertions((prev) => [
                  ...prev,
                  { type: "url_contains", expected: "", locator_id: null },
                ])
              }
            >
              Add assertion
            </button>
          </div>
          {assertions.map((a, idx) => (
            <div key={idx} className="step-row">
              <input
                placeholder="type"
                value={a.type ?? ""}
                disabled={busy !== null}
                onChange={(e) => {
                  const type = e.target.value;
                  setAssertions((prev) =>
                    prev.map((p, i) => (i === idx ? { ...p, type } : p)),
                  );
                }}
              />
              <input
                placeholder="expected"
                value={a.expected ?? ""}
                disabled={busy !== null}
                onChange={(e) => {
                  const expected = e.target.value;
                  setAssertions((prev) =>
                    prev.map((p, i) => (i === idx ? { ...p, expected } : p)),
                  );
                }}
              />
              <select
                value={a.locator_id ?? ""}
                disabled={busy !== null}
                onChange={(e) => {
                  const locator_id = e.target.value || null;
                  setAssertions((prev) =>
                    prev.map((p, i) => (i === idx ? { ...p, locator_id } : p)),
                  );
                }}
              >
                <option value="">(no locator)</option>
                {locators.map((l) => (
                  <option key={l.id} value={l.id}>
                    {locatorLabel(l)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={busy !== null}
                onClick={() =>
                  setAssertions((prev) => prev.filter((_, i) => i !== idx))
                }
              >
                ✕
              </button>
            </div>
          ))}

          <div className="actions" style={{ marginTop: "0.75rem" }}>
            <button
              type="button"
              className="btn"
              disabled={busy !== null}
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
  const showCases = cases.length > 0;

  return (
    <>
      <p className="brand">QA Automation</p>
      <h1>Job status</h1>

      <div className="meta">
        <div>
          Job <code>{jobId}</code>
        </div>
        {job?.project_id && (
          <div>
            Project <code>{job.project_id}</code>
          </div>
        )}
        {job && (
          <div style={{ marginTop: "0.75rem" }}>
            Status{" "}
            <span className={`status-pill status-${job.status}`}>
              {job.status}
            </span>
            {job.current_stage ? (
              <>
                {" "}
                · stage <code>{job.current_stage}</code>
              </>
            ) : null}
            {polling ? " · polling…" : null}
          </div>
        )}
      </div>

      {error && (
        <div className="alert alert-error" role="alert" style={{ marginBottom: "1rem" }}>
          {error}
        </div>
      )}

      {job?.error && (
        <div className="alert alert-error" role="alert" style={{ marginBottom: "1rem" }}>
          {job.error.code ? <strong>{job.error.code}: </strong> : null}
          {job.error.message ?? "Job failed"}
        </div>
      )}

      {(job?.report_object_key || job?.report_url) && (
        <div className="alert" style={{ marginBottom: "1rem" }}>
          Report ready:{" "}
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
        </div>
      )}

      {job?.result_summary?.counts && (
        <p className="meta" style={{ marginBottom: "1rem" }}>
          Results: {job.result_summary.counts.passed ?? 0} passed /{" "}
          {job.result_summary.counts.failed ?? 0} failed /{" "}
          {job.result_summary.counts.error ?? 0} error /{" "}
          {job.result_summary.counts.skipped ?? 0} skipped
          {job.result_summary.pass_rate != null
            ? ` · pass rate ${(job.result_summary.pass_rate * 100).toFixed(0)}%`
            : null}
        </p>
      )}

      {job?.stages && job.stages.length > 0 && (
        <>
          <h2 style={{ fontSize: "1rem", margin: "0 0 0.5rem" }}>Stages</h2>
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
        </>
      )}

      {showCases && (
        <>
          <h2 style={{ fontSize: "1rem", margin: "1.5rem 0 0.5rem" }}>
            Cases (edit plan + re-run)
          </h2>
          <p className="meta" style={{ marginBottom: "0.75rem" }}>
            Edit structured steps and locators, save, then re-run one case. Does not
            rewrite Playwright source.
          </p>
          <ul className="cases">
            {cases.map((c) => (
              <CaseEditor
                key={c.test_plan_id || c.test_case_id || c.title}
                jobId={jobId}
                row={c}
                locators={locators}
                onSaved={() => void load()}
              />
            ))}
          </ul>
        </>
      )}

      <div className="actions">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => {
            setPolling(true);
            void load();
          }}
        >
          Refresh now
        </button>
        <Link href="/" className="btn btn-secondary" style={{ textDecoration: "none" }}>
          New job
        </Link>
      </div>

      {(job?.created_at || job?.finished_at) && (
        <p className="footer-note">
          {job.created_at ? <>Created {job.created_at}</> : null}
          {job.finished_at ? <> · Finished {job.finished_at}</> : null}
        </p>
      )}
    </>
  );
}
