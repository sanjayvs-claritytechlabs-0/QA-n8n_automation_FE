"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AI_MODELS,
  defaultModelFor,
  type AiProvider,
  type Mode,
} from "@/lib/n8n";

type JobListRow = {
  job_id: string;
  project_id?: string;
  project_name?: string;
  website_url?: string | null;
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
};

export default function HomePage() {
  const router = useRouter();
  const [projectName, setProjectName] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [mode, setMode] = useState<Mode>("ai_qa");
  const [aiProvider, setAiProvider] = useState<AiProvider>("gemini");
  const [aiModel, setAiModel] = useState(defaultModelFor("gemini"));
  const [crawlDepth, setCrawlDepth] = useState(1);
  const [crawlPages, setCrawlPages] = useState(8);
  const [csvText, setCsvText] = useState(
    "id,title,steps,expected\nTC-001,Open Learn more link,Click Learn more,Learn more link is available",
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [jobs, setJobs] = useState<JobListRow[]>([]);
  const [jobsError, setJobsError] = useState<string | null>(null);
  const [jobsLoading, setJobsLoading] = useState(true);

  const models = useMemo(() => AI_MODELS[aiProvider], [aiProvider]);

  const loadJobs = useCallback(async () => {
    setJobsLoading(true);
    try {
      const res = await fetch("/api/jobs?limit=50", { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setJobsError(
          data?.error?.message || `Could not load jobs (${res.status})`,
        );
        setJobs([]);
        return;
      }
      setJobs(Array.isArray(data.jobs) ? data.jobs : []);
      setJobsError(null);
    } catch (e) {
      setJobsError(e instanceof Error ? e.message : "Network error");
      setJobs([]);
    } finally {
      setJobsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadJobs();
  }, [loadJobs]);

  function onProviderChange(next: AiProvider) {
    setAiProvider(next);
    const list = AI_MODELS[next];
    setAiModel((prev) => (list.includes(prev) ? prev : defaultModelFor(next)));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_name: projectName,
          website_url: websiteUrl,
          mode,
          csv_text: mode === "manual_csv" ? csvText : undefined,
          ai_provider: aiProvider,
          ai_model: aiModel,
          crawl_max_depth: crawlDepth,
          crawl_max_pages: crawlPages,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok || !data?.job_id) {
        const msg =
          data?.error?.message ||
          data?.message ||
          `Request failed (${res.status})`;
        setError(msg);
        return;
      }
      router.push(`/jobs/${data.job_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <header className="page-header">
        <p className="eyebrow">New run</p>
        <h1>Start a job</h1>
        <p className="lede">
          Submit a project against a live site. Status polling and the webhook
          token stay on the server.
        </p>
      </header>

      <form className="form" onSubmit={onSubmit} noValidate>
        <label>
          Project name
          <input
            type="text"
            name="project_name"
            autoComplete="organization"
            required
            maxLength={200}
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            placeholder="Acme Checkout"
          />
        </label>

        <label>
          Website URL
          <input
            type="url"
            name="website_url"
            required
            value={websiteUrl}
            onChange={(e) => setWebsiteUrl(e.target.value)}
            placeholder="https://example.com"
          />
        </label>

        <fieldset className="field-group">
          <legend>Mode</legend>
          <div className="mode-row" role="radiogroup" aria-label="Job mode">
            <label>
              <input
                type="radio"
                name="mode"
                value="ai_qa"
                checked={mode === "ai_qa"}
                onChange={() => setMode("ai_qa")}
              />
              AI QA (generate cases)
            </label>
            <label>
              <input
                type="radio"
                name="mode"
                value="manual_csv"
                checked={mode === "manual_csv"}
                onChange={() => setMode("manual_csv")}
              />
              Manual / CSV
            </label>
          </div>
        </fieldset>

        <fieldset className="field-group">
          <legend>AI provider</legend>
          <div className="mode-row" role="radiogroup" aria-label="AI provider">
            <label>
              <input
                type="radio"
                name="ai_provider"
                value="gemini"
                checked={aiProvider === "gemini"}
                onChange={() => onProviderChange("gemini")}
              />
              Gemini
            </label>
            <label>
              <input
                type="radio"
                name="ai_provider"
                value="openai"
                checked={aiProvider === "openai"}
                onChange={() => onProviderChange("openai")}
              />
              OpenAI
            </label>
          </div>
        </fieldset>

        <label>
          Model
          <select
            name="ai_model"
            value={aiModel}
            onChange={(e) => setAiModel(e.target.value)}
          >
            {models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <span className="hint">
            Keys live in n8n credentials (Gemini account / OpenAI account) — not
            in this form.
          </span>
        </label>

        <div className="field-row">
          <label>
            Crawl max depth
            <input
              type="number"
              name="crawl_max_depth"
              min={0}
              max={5}
              value={crawlDepth}
              onChange={(e) => setCrawlDepth(Number(e.target.value))}
            />
            <span className="hint">0–5 (server clamps)</span>
          </label>
          <label>
            Crawl max pages
            <input
              type="number"
              name="crawl_max_pages"
              min={1}
              max={50}
              value={crawlPages}
              onChange={(e) => setCrawlPages(Number(e.target.value))}
            />
            <span className="hint">1–50 (server clamps)</span>
          </label>
        </div>

        {mode === "manual_csv" && (
          <label>
            CSV test cases
            <span className="hint">
              Header row required. Columns: id, title, steps, expected, tags
            </span>
            <textarea
              name="csv_text"
              required
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              spellCheck={false}
            />
          </label>
        )}

        {error && (
          <div className="alert alert-error" role="alert">
            {error}
          </div>
        )}

        <button type="submit" disabled={submitting}>
          {submitting ? "Starting…" : "Start job"}
        </button>
      </form>

      <section className="jobs-section" aria-labelledby="recent-jobs-heading">
        <div className="jobs-head">
          <h2 id="recent-jobs-heading">Recent jobs</h2>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => void loadJobs()}
            disabled={jobsLoading}
          >
            {jobsLoading ? "Loading…" : "Refresh"}
          </button>
        </div>
        {jobsError && (
          <div className="alert alert-error" role="alert">
            {jobsError}
          </div>
        )}
        {!jobsError && !jobsLoading && jobs.length === 0 && (
          <p className="meta">No jobs yet. Start one above.</p>
        )}
        {jobs.length > 0 && (
          <div className="jobs-table-wrap">
            <table className="jobs-table">
              <thead>
                <tr>
                  <th scope="col">Status</th>
                  <th scope="col">Project</th>
                  <th scope="col">Results</th>
                  <th scope="col">Created</th>
                  <th scope="col">Link</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => (
                  <tr key={j.job_id}>
                    <td>
                      <span className={`status-pill status-${j.status}`}>
                        {j.status}
                      </span>
                      {j.current_stage ? (
                        <div className="table-sub">{j.current_stage}</div>
                      ) : null}
                    </td>
                    <td>
                      <div className="table-primary">
                        {j.project_name || "—"}
                      </div>
                      {j.website_url ? (
                        <div className="table-sub">{j.website_url}</div>
                      ) : null}
                    </td>
                    <td className="mono-cell">
                      {j.counts
                        ? `${j.counts.passed ?? 0}/${j.counts.total ?? 0}`
                        : "—"}
                      {j.pass_rate != null
                        ? ` · ${(j.pass_rate * 100).toFixed(0)}%`
                        : ""}
                    </td>
                    <td className="mono-cell">
                      {j.created_at
                        ? new Date(j.created_at).toLocaleString()
                        : "—"}
                    </td>
                    <td>
                      <Link href={`/jobs/${encodeURIComponent(j.job_id)}`}>
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="footer-note">
        Playwright URL and S3 bucket are injected from server env — not from
        this form. AI API keys never leave n8n.
      </p>
    </>
  );
}
