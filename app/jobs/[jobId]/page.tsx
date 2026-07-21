"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

type Stage = {
  stage_key: string;
  status: string;
  attempt?: number;
  error_code?: string | null;
  error_message?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
};

type JobStatus = {
  ok: boolean;
  job_id: string;
  project_id?: string;
  status: string;
  current_stage?: string | null;
  stages?: Stage[];
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
