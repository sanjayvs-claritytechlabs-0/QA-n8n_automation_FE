"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type ProjectRow = {
  project_id: string;
  name: string;
  website_url?: string | null;
  mode?: string | null;
  job_count?: number;
  updated_at?: string | null;
  created_at?: string | null;
};

export default function ProjectsPage() {
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/projects?limit=100", { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error?.message || `Load failed (${res.status})`);
        setProjects([]);
        return;
      }
      setProjects(Array.isArray(data.projects) ? data.projects : []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
      setProjects([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function onDelete(p: ProjectRow) {
    const ok = window.confirm(
      `Delete project "${p.name}" and all ${p.job_count ?? 0} job(s)?\n\nThis removes DB rows and best-effort deletes S3 under qa/${p.project_id}/.`,
    );
    if (!ok) return;
    setBusyId(p.project_id);
    setNote(null);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(p.project_id)}`, {
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
          ? `Deleted project; S3 partial failure (${s3Fail} keys).`
          : `Deleted project (${data.object_key_count ?? 0} known keys / prefix cleaned).`,
      );
      await load();
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <header className="page-header">
        <p className="eyebrow">Ops</p>
        <h1>Projects</h1>
        <p className="lede">
          Browse projects and jobs. Delete removes the DB cascade and cleans S3
          under <code>qa/{"{project_id}"}/</code>.
        </p>
      </header>

      <div className="actions" style={{ marginBottom: "1rem" }}>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => void load()}
          disabled={loading}
        >
          Refresh
        </button>
        <Link href="/" className="btn btn-secondary btn-sm">
          Start a job
        </Link>
      </div>

      {error ? (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      ) : null}
      {note ? <p className="footer-note">{note}</p> : null}

      {loading ? (
        <p className="meta">Loading…</p>
      ) : projects.length === 0 ? (
        <p className="meta">No projects yet.</p>
      ) : (
        <ul className="jobs-list">
          {projects.map((p) => (
            <li key={p.project_id} className="jobs-list-item">
              <div className="jobs-list-main">
                <Link href={`/projects/${encodeURIComponent(p.project_id)}`}>
                  <strong>{p.name || "Untitled"}</strong>
                </Link>
                <span className="meta">
                  {p.website_url || "—"}
                  {p.mode ? ` · ${p.mode}` : ""}
                  {` · ${p.job_count ?? 0} jobs`}
                </span>
                <span className="meta">
                  Updated {p.updated_at || p.created_at || "—"}
                </span>
              </div>
              <div className="actions" style={{ marginTop: 0 }}>
                <Link
                  href={`/projects/${encodeURIComponent(p.project_id)}`}
                  className="btn btn-secondary btn-sm"
                >
                  Open
                </Link>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={busyId === p.project_id}
                  onClick={() => void onDelete(p)}
                >
                  {busyId === p.project_id ? "Deleting…" : "Delete"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
