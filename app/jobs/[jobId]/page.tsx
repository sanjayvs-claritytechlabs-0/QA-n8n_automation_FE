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

const TERMINAL = new Set(["succeeded", "failed", "cancelled"]);
const POLL_MS = 4000;

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
  const [planText, setPlanText] = useState(() => planToEditorText(row.plan));
  const [tab, setTab] = useState<"plan" | "source">("plan");
  const [busy, setBusy] = useState<"save" | "rerun" | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [jsonError, setJsonError] = useState<string | null>(null);

  const hasSource =
    typeof row.playwright_source === "string" &&
    row.playwright_source.trim().length > 0;

  useEffect(() => {
    setPlanText(planToEditorText(row.plan));
    setJsonError(null);
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

  async function save() {
    setBusy("save");
    setMsg(null);
    const parsed = parsePlanDocument(planText);
    if (!parsed.ok) {
      setJsonError(parsed.error);
      setBusy(null);
      return;
    }
    setJsonError(null);
    try {
      const res = await fetch(
        `/api/jobs/${encodeURIComponent(jobId)}/plans/${encodeURIComponent(planId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ plan: parsed.plan }),
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
            Edit the <strong>structured plan JSON</strong> (steps, assertions,
            locator UUIDs). Execution runs this plan — not Playwright scripts.
          </p>

          <div className="editor-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "plan"}
              className={`editor-tab${tab === "plan" ? " active" : ""}`}
              onClick={() => setTab("plan")}
            >
              Plan JSON
            </button>
            {hasSource ? (
              <button
                type="button"
                role="tab"
                aria-selected={tab === "source"}
                className={`editor-tab${tab === "source" ? " active" : ""}`}
                onClick={() => setTab("source")}
              >
                Playwright source (read-only)
              </button>
            ) : null}
          </div>

          {tab === "plan" ? (
            <>
              <div className="steps-head">
                <strong>Structured plan</strong>
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

              {locators.length > 0 ? (
                <label className="field">
                  <span>Locator catalog (copy UUID into plan JSON)</span>
                  <select
                    defaultValue=""
                    disabled={busy !== null}
                    onChange={(e) => {
                      const id = e.target.value;
                      if (!id) return;
                      void navigator.clipboard?.writeText(id).then(
                        () => setMsg(`Copied locator ${id.slice(0, 8)}…`),
                        () => setMsg(`Locator id: ${id}`),
                      );
                      e.target.value = "";
                    }}
                  >
                    <option value="">Select to copy locator_id…</option>
                    {locators.map((l) => (
                      <option key={l.id} value={l.id}>
                        {locatorLabel(l)}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </>
          ) : (
            <>
              <p className="meta case-editor-hint">
                Optional review/export artifact only.{" "}
                <strong>v1 execution ignores this source</strong> and uses the
                structured plan above.
              </p>
              <CodeEditor
                value={row.playwright_source || ""}
                onChange={() => undefined}
                readOnly
                height="280px"
                language="typescript"
              />
            </>
          )}

          <div className="actions" style={{ marginTop: "0.75rem" }}>
            <button
              type="button"
              className="btn"
              disabled={busy !== null || tab !== "plan"}
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
  const artifacts = useMemo(() => job?.artifacts ?? [], [job?.artifacts]);
  const showCases = cases.length > 0;
  const screenshots = useMemo(
    () => artifacts.filter((a) => a.kind === "screenshot"),
    [artifacts],
  );
  const otherArtifacts = useMemo(
    () => artifacts.filter((a) => a.kind !== "screenshot"),
    [artifacts],
  );

  const counts = job?.result_summary?.counts;

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
            <Link href="/" className="btn btn-secondary btn-sm">
              Home
            </Link>
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
            <span className="count-chip ok">
              {counts.passed ?? 0} passed
            </span>
            <span className="count-chip fail">
              {counts.failed ?? 0} failed
            </span>
            <span className="count-chip">
              {counts.error ?? 0} error
            </span>
            <span className="count-chip">
              {counts.skipped ?? 0} skipped
            </span>
            {job?.result_summary?.pass_rate != null ? (
              <span className="count-chip">
                {(job.result_summary.pass_rate * 100).toFixed(0)}% pass
              </span>
            ) : null}
          </div>
        ) : null}
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
          )}
          {otherArtifacts.length > 0 && (
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

      {showCases && (
        <section className="job-panel" aria-labelledby="cases-heading">
          <h2 id="cases-heading" className="section-title">
            Cases (structured plan editor)
          </h2>
          <p className="meta" style={{ marginBottom: "0.75rem" }}>
            Edit structured plan JSON (locator UUIDs only), save, then re-run.
            Optional Playwright source is review-only — execution ignores it in
            v1.
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
        </section>
      )}

      {(job?.created_at || job?.finished_at) && (
        <p className="footer-note">
          {job.created_at ? <>Created {job.created_at}</> : null}
          {job.finished_at ? <> · Finished {job.finished_at}</> : null}
        </p>
      )}
    </>
  );
}
