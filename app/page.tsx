"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type Mode = "ai_qa" | "manual_csv";

export default function HomePage() {
  const router = useRouter();
  const [projectName, setProjectName] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [mode, setMode] = useState<Mode>("ai_qa");
  const [csvText, setCsvText] = useState(
    "id,title,steps,expected\nTC-001,Open Learn more link,Click Learn more,Learn more link is available",
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
      <p className="brand">QA Automation</p>
      <h1>Start a job</h1>
      <p className="lede">
        Submit a project against a live site. Status polling and the webhook
        token stay on the server.
      </p>

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

        <fieldset style={{ border: "none", margin: 0, padding: 0 }}>
          <legend style={{ fontSize: "0.875rem", fontWeight: 500, marginBottom: "0.35rem" }}>
            Mode
          </legend>
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
              aria-describedby="csv-hint"
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

      <p className="footer-note">
        Playwright URL and S3 bucket are injected from server env — not from
        this form. OpenAI keys never leave n8n.
      </p>
    </>
  );
}
