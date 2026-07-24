"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AI_MODEL_OPTIONS,
  defaultModelFor,
  type AiProvider,
  type Mode,
} from "@/lib/ai-options";
import { apiErrorMessage } from "@/lib/api-error";

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
  const [humanReviewEnabled, setHumanReviewEnabled] = useState(false);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvFilename, setCsvFilename] = useState<string | null>(null);
  const [csvFileError, setCsvFileError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [jobs, setJobs] = useState<JobListRow[]>([]);
  const [jobsError, setJobsError] = useState<string | null>(null);
  const [jobsLoading, setJobsLoading] = useState(true);

  const models = useMemo(() => AI_MODEL_OPTIONS[aiProvider], [aiProvider]);

  const loadJobs = useCallback(async () => {
    setJobsLoading(true);
    try {
      const res = await fetch("/api/jobs?limit=50", { cache: "no-store" });
      const raw = await res.text();
      let data: Record<string, unknown> | null = null;
      try {
        data = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        data = null;
      }
      if (!res.ok || !data?.ok) {
        setJobsError(
          apiErrorMessage(data ?? raw, res.status, "Could not load jobs"),
        );
        setJobs([]);
        return;
      }
      setJobs(Array.isArray(data.jobs) ? (data.jobs as JobListRow[]) : []);
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
    const list = AI_MODEL_OPTIONS[next];
    setAiModel((prev) =>
      list.some((m) => m.id === prev) ? prev : defaultModelFor(next),
    );
  }

  function onCsvFile(file: File | null) {
    setCsvFileError(null);
    if (!file) return;
    if (file.size === 0) {
      setCsvFileError("File is empty");
      return;
    }
    const name = file.name || "cases.csv";
    if (!/\.(csv|tsv|txt|xlsx|xls)$/i.test(name)) {
      setCsvFileError("Choose a .csv, .tsv, or .xlsx file");
      return;
    }
    // Keep the File object — do not FileReader before submit (async race).
    setCsvFile(file);
    setCsvFilename(name);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (mode === "manual_csv" && !csvFile) {
      setError("Upload a .csv / .tsv / .xlsx file for Manual mode");
      return;
    }
    setSubmitting(true);
    try {
      let res: Response;
      if (mode === "manual_csv" && csvFile) {
        const fd = new FormData();
        fd.append("project_name", projectName);
        fd.append("website_url", websiteUrl);
        fd.append("mode", mode);
        fd.append("ai_provider", aiProvider);
        fd.append("ai_model", aiModel);
        fd.append("crawl_max_depth", String(crawlDepth));
        fd.append("crawl_max_pages", String(crawlPages));
        if (humanReviewEnabled) {
          fd.append("human_review_enabled", "true");
        }
        fd.append("csv_file", csvFile, csvFile.name);
        res = await fetch("/api/jobs", { method: "POST", body: fd });
      } else {
        res = await fetch("/api/jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            project_name: projectName,
            website_url: websiteUrl,
            mode,
            ai_provider: aiProvider,
            ai_model: aiModel,
            crawl_max_depth: crawlDepth,
            crawl_max_pages: crawlPages,
            human_review_enabled: humanReviewEnabled || undefined,
          }),
        });
      }
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
          Submit a project against a live site. Browse{" "}
          <Link href="/projects">Projects</Link> for list/delete/re-run. Status
          polling and the webhook token stay on the server.
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
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
          <span className="hint">
            Larger models map steps more accurately but cost more / run slower.
            Keys live in n8n credentials — not in this form.
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
        <p className="hint" style={{ marginTop: "-0.35rem" }}>
          Depth/pages still run Website Discovery + Locator Extraction in CSV
          mode (locators power the plan editor).
        </p>

        <label className="checkbox-row">
          <input
            type="checkbox"
            name="human_review_enabled"
            checked={humanReviewEnabled}
            onChange={(e) => setHumanReviewEnabled(e.target.checked)}
          />
          <span>
            Require human review before execution
            <span className="hint" style={{ display: "block", marginTop: "0.2rem" }}>
              After AI plans are ready, pause the job so you can edit steps, then
              Approve &amp; continue (or Reject).
            </span>
          </span>
        </label>

        {mode === "manual_csv" && (
          <fieldset className="field-group">
            <legend>Test cases file</legend>
            <label>
              Upload CSV / TSV / Excel
              <span className="hint">
                Header row required. Columns: title, steps, expected
                (aliases: TC_Name, TestCaseID, Target_URL, Test_Data,
                …). First sheet only for .xlsx/.xls. Tab or semicolon
                CSV is normalized server-side.
              </span>
              <input
                type="file"
                name="csv_file"
                accept=".csv,.tsv,.txt,.xlsx,.xls,text/csv,text/tab-separated-values,text/plain,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  onCsvFile(f);
                  e.target.value = "";
                }}
              />
            </label>
            {csvFilename && csvFile ? (
              <p className="meta" style={{ margin: 0 }}>
                Ready: <code>{csvFilename}</code>
                {` · ${(csvFile.size / 1024).toFixed(1)} KB`}
              </p>
            ) : null}
            {csvFileError ? (
              <p className="case-error" role="alert">
                {csvFileError}
              </p>
            ) : null}
            {!csvFile ? (
              <span className="hint">
                A non-empty .csv / .tsv / .xlsx file is required for Manual mode.
              </span>
            ) : null}
          </fieldset>
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
