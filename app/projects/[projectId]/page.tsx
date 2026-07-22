"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { apiErrorMessage } from "@/lib/api-error";

type JobRow = {
  job_id: string;
  status: string;
  current_stage?: string | null;
  created_at?: string | null;
  finished_at?: string | null;
  counts?: {
    total?: number;
    passed?: number;
    failed?: number;
    error?: number;
    skipped?: number;
  } | null;
  pass_rate?: number | null;
  error_code?: string | null;
};

type Project = {
  project_id: string;
  name: string;
  website_url?: string | null;
  mode?: string | null;
  job_count?: number;
};

export default function ProjectDetailPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = String(params.projectId ?? "");
  const [project, setProject] = useState<Project | null>(null);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}`,
        { cache: "no-store" },
      );
      const raw = await res.text();
      let data: Record<string, unknown> | null = null;
      try {
        data = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        data = null;
      }
      if (!res.ok || !data?.ok) {
        setError(apiErrorMessage(data ?? raw, res.status, "Load failed"));
        return;
      }
      setProject((data.project as Project) || null);
      setJobs(Array.isArray(data.jobs) ? (data.jobs as JobRow[]) : []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    }
  }, [projectId]);

  useEffect(() => {
    if (projectId) void load();
  }, [projectId, load]);

  async function deleteJob(jobId: string) {
    const ok = window.confirm(
      `Delete job ${jobId}?\n\nRemoves DB rows and best-effort S3 under qa/{project}/{job}/.`,
    );
    if (!ok) return;
    setBusy(`del:${jobId}`);
    setNote(null);
    try {
      const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setNote(data?.error?.message || `Delete failed (${res.status})`);
        return;
      }
      const s3Fail = data.s3?.failed_count ? Number(data.s3.failed_count) : 0;
      setNote(
        s3Fail > 0
          ? `Job deleted; S3 partial failure (${s3Fail}).`
          : "Job deleted.",
      );
      await load();
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setBusy(null);
    }
  }

  async function rerunJob(jobId: string) {
    const ok = window.confirm(
      "Re-run creates a NEW job under this project (history kept) and starts the orchestrator. Continue?",
    );
    if (!ok) return;
    setBusy(`rerun:${jobId}`);
    setNote(null);
    try {
      const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/rerun`, {
        method: "POST",
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok || !data.job_id) {
        setNote(data?.error?.message || `Re-run failed (${res.status})`);
        return;
      }
      if (data.note) setNote(String(data.note));
      router.push(`/jobs/${data.job_id}`);
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Re-run failed");
    } finally {
      setBusy(null);
    }
  }

  async function deleteProject() {
    if (!project) return;
    const ok = window.confirm(
      `Delete entire project "${project.name}" and all jobs? This cannot be undone.`,
    );
    if (!ok) return;
    setBusy("del-project");
    try {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}`,
        { method: "DELETE" },
      );
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setNote(data?.error?.message || `Delete failed (${res.status})`);
        return;
      }
      router.push("/projects");
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <header className="page-header">
        <p className="eyebrow">Project</p>
        <h1>{project?.name || "Project"}</h1>
        <p className="lede">
          {project?.website_url || "—"}
          {project?.mode ? ` · ${project.mode}` : ""}
        </p>
      </header>

      <div className="actions" style={{ marginBottom: "1rem" }}>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => void load()}
        >
          Refresh
        </button>
        <Link href="/projects" className="btn btn-secondary btn-sm">
          All projects
        </Link>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={busy === "del-project"}
          onClick={() => void deleteProject()}
        >
          {busy === "del-project" ? "Deleting…" : "Delete project"}
        </button>
      </div>

      {error ? (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      ) : null}
      {note ? <p className="footer-note">{note}</p> : null}

      <p className="meta" style={{ marginBottom: "0.75rem" }}>
        Project <code>{projectId}</code>
      </p>

      <section className="job-panel" aria-labelledby="jobs-heading">
        <h2 id="jobs-heading" className="section-title">
          Jobs
        </h2>
        {jobs.length === 0 ? (
          <p className="meta">No jobs for this project.</p>
        ) : (
          <ul className="jobs-list">
            {jobs.map((j) => (
              <li key={j.job_id} className="jobs-list-item">
                <div className="jobs-list-main">
                  <Link href={`/jobs/${encodeURIComponent(j.job_id)}`}>
                    <code>{j.job_id.slice(0, 8)}…</code>
                  </Link>
                  <span className={`status-pill status-${j.status}`}>
                    {j.status}
                  </span>
                  {j.current_stage ? (
                    <span className="meta">{j.current_stage}</span>
                  ) : null}
                  {j.counts ? (
                    <span className="meta">
                      {j.counts.passed ?? 0}/{j.counts.total ?? 0} passed
                    </span>
                  ) : null}
                  <span className="meta">{j.created_at || "—"}</span>
                </div>
                <div className="actions" style={{ marginTop: 0 }}>
                  <Link
                    href={`/jobs/${encodeURIComponent(j.job_id)}`}
                    className="btn btn-secondary btn-sm"
                  >
                    Open
                  </Link>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={busy === `rerun:${j.job_id}`}
                    onClick={() => void rerunJob(j.job_id)}
                  >
                    {busy === `rerun:${j.job_id}` ? "Starting…" : "Re-run"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={busy === `del:${j.job_id}`}
                    onClick={() => void deleteJob(j.job_id)}
                  >
                    {busy === `del:${j.job_id}` ? "Deleting…" : "Delete"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
