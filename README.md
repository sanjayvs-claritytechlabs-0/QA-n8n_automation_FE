# QA Automation Frontend (MVP)

Minimal Next.js (App Router) UI that starts QA jobs and polls status via **server-side** proxies to live n8n webhooks.

**This folder is intended as its own git root** for Vercel deployment. Backend (n8n + Playwright + Postgres + S3) stays on Railway.

## Deploy recommendation

**Use Vercel** (not Railway) for this FE:

- Separate FE repo / folder → native Next.js hosting, zero Node server ops
- Secrets (`QA_WEBHOOK_TOKEN`, etc.) live in Vercel env → Route Handlers only
- Railway already runs the BE stack; co-locating FE there adds ops without benefit for a static+API-route app

## What it does

| UI | Server proxy |
|----|----------------|
| Home form → start job | `POST /api/jobs` → `POST {N8N_BASE_URL}/webhook/qa/create-or-start` |
| Home recent jobs table | `GET /api/jobs?limit=50` → `GET …/webhook/qa/jobs?limit=` |
| `/projects` list + delete | `GET /api/projects` · `DELETE /api/projects/[id]` → n8n list/delete + FE S3 prefix cleanup |
| `/projects/[id]` jobs + re-run/delete | `GET /api/projects/[id]` · job delete/re-run proxies |
| `/jobs/[jobId]` polls every 4s | `GET /api/jobs/[jobId]` → `GET …/webhook/qa/job-status?job_id=` |
| Save structured plan JSON | `POST /api/jobs/[jobId]/plans/[planId]` → `POST …/webhook/qa/plans/update` |
| Re-run one case | `POST /api/jobs/[jobId]/cases/[planId]/rerun` → `POST …/webhook/qa/cases/re-run` |
| Create / delete case | `POST /api/jobs/[jobId]/cases` · `DELETE …/cases/[caseId]` |
| Re-run / delete job | `POST /api/jobs/[jobId]/rerun` · `DELETE /api/jobs/[jobId]` |
| Open HTML report | `GET /api/jobs/[jobId]/report` → poll + private S3 GetObject (rewrites `s3://` imgs) |
| Raw artifact | `GET /api/artifacts?key=qa/...` → private S3 GetObject |

Auth header `X-QA-Token` is attached **only** in Route Handlers from `QA_WEBHOOK_TOKEN`. Never sent to the browser.

S3 credentials stay **server-side** (`N8N_EXTERNAL_STORAGE_S3_*`). Deletes collect `object_key` / prefix from n8n, then the FE Route Handler best-effort `DeleteObjects` / list-delete under `qa/{project}/` or `qa/{project}/{job}/`. DB delete still succeeds if S3 partially fails (`s3.failed_count` in the response).

## QA ops UI

- **Projects** (`/projects`): list projects (name, URL, job count), delete project (confirm).
- **Project detail**: jobs list; **Re-run** clones a new job (history kept); **Delete** job + S3 prefix.
- **Job detail**: plan Monaco editor + **Re-run this case** (existing); **Add case** (manual title/steps/expected + blocked plan stub); **Delete case** (plans/results/artifacts + S3 keys; refreshes `result_summary` counts); screenshots + videos listed under Artifacts.

### Job re-run behavior

1. If source job still has `csv_text` → copy it; `csv_import` runs on the clone.
2. Else if source has `test_cases` → clone those cases; skip `csv_import` + `ai_case_generation`.
3. Else if `ai_qa` → empty cases; AI case generation runs after locators.
4. Else → `CASES_REQUIRED` (start a fresh job with CSV).

No new env vars beyond the existing S3 + n8n set.

Start-form fields (sent in Create-or-Start `options`):

- `mode`, `ai_provider`, `ai_model`
- `crawl_max_depth`, `crawl_max_pages` (UI; env `CRAWL_MAX_*` = defaults only)

Still injected from server env only (not the form):

- `playwright_service_url` ← `PLAYWRIGHT_SERVICE_URL`
- `s3_bucket` ← `S3_BUCKET`
- `capture_screenshot_on_failure: true` + `capture_video: true` (every executed case; opt out with `CAPTURE_SCREENSHOT=false` / `CAPTURE_VIDEO=false`)
- optional `browser`, `artifact_base_url`

AI API keys are **never** sent from this app (n8n Gemini/OpenAI credentials own them).

Optional server env (injected into Create-or-Start `options`):

| Variable | Effect |
|----------|--------|
| `AI_GENERATE_PLAYWRIGHT_SOURCE=true` | Store review-only Playwright source on plans |
| `CAPTURE_DISCOVERY_SNAPSHOTS=true` | Discovery HTML + screenshots to S3 (keep crawl small) |
| `CAPTURE_VIDEO=false` | Disable per-case video (default is on) |
| `CAPTURE_SCREENSHOT=false` | Disable per-case screenshots (default is on for pass + fail) |

Job detail **Cases** uses a Monaco JSON editor for the structured plan (`steps` / `assertions` / `summary`). Optional `playwright_source` is shown read-only — v1 execution ignores it.

## Local setup

```bash
cd Frontend
cp .env.example .env.local
# edit .env.local — set QA_WEBHOOK_TOKEN at minimum
npm install
npm run dev
```

Open http://localhost:3000

### Env vars (`.env.local` / Vercel)

| Variable | Required | Notes |
|----------|----------|-------|
| `N8N_BASE_URL` | yes | e.g. `https://n8n-production-6e6f5.up.railway.app` |
| `QA_WEBHOOK_TOKEN` | yes | Same secret as n8n **QA Webhook Header Auth** |
| `PLAYWRIGHT_SERVICE_URL` | yes | Railway Playwright base URL |
| `S3_BUCKET` | yes | Bucket name injected into job options |
| `N8N_EXTERNAL_STORAGE_S3_ACCESS_KEY` | yes* | Same as Railway/n8n external storage |
| `N8N_EXTERNAL_STORAGE_S3_ACCESS_SECRET` | yes* | |
| `N8N_EXTERNAL_STORAGE_S3_BUCKET_NAME` | yes* | Usually same as `S3_BUCKET` |
| `N8N_EXTERNAL_STORAGE_S3_BUCKET_REGION` | yes* | e.g. `auto` |
| `N8N_EXTERNAL_STORAGE_S3_HOST` | yes* | e.g. `storage.railway.app` (no `https://` ok) |
| `AI_MODEL` | no | Override default model name only |
| `CRAWL_MAX_DEPTH` | no | |
| `CRAWL_MAX_PAGES` | no | |
| `BROWSER` | no | default `chromium` |
| `ARTIFACT_BASE_URL` | no | Not required when using the FE S3 proxy |

\*Required to open reports/screenshots in the FE. Without them, jobs still run; only the report proxy fails.

## Vercel deploy

1. Create a new git repo from this `Frontend/` folder (or push this folder as the repo root).
2. Import the repo in [Vercel](https://vercel.com) → Framework Preset: Next.js.
3. Add the env vars above (Production + Preview as needed).
4. Deploy. No build command overrides required (`npm run build` / Next default).

Optional: set Root Directory to `Frontend` if you keep this folder inside a monorepo instead of splitting the git root.

## Smoke-test against live n8n

1. Confirm n8n Create-or-Start + Job Status Poll + **Jobs List** + **ops webhooks** (projects list/detail/delete, job delete/re-run, case create/delete) are **published**.
2. Set `QA_WEBHOOK_TOKEN` to the live webhook secret.
3. `npm install` then `npm run dev` → open home page (crawl depth/pages + recent jobs table).
4. Open **Projects** → confirm list loads; open a project → jobs list.
5. Start an **AI QA** job against `https://example.com` (or Manual/CSV — see `n8n/README.md` E2E notes).
6. On `/jobs/<uuid>`: stages update; **Artifacts** shows screenshots/videos/report; expand a case → edit **Plan JSON** → **Save plan** → **Re-run this case**.
7. **Add case** → create stub → edit plan → re-run that case.
8. From project page: **Re-run** job (new job id) and optionally **Delete** a finished job; confirm S3 prefix is cleaned (or `s3.failed_count` logged).

### Ops verify checklist

- [ ] `GET /api/projects` returns projects with `job_count`
- [ ] `DELETE /api/projects/{id}` removes DB rows; response includes `s3_prefix` / `s3`
- [ ] `DELETE /api/jobs/{id}` removes job; S3 under `qa/{project}/{job}/` gone or reported failed
- [ ] `POST /api/jobs/{id}/cases` creates case + blocked plan stub
- [ ] `DELETE /api/jobs/{id}/cases/{caseId}` removes case; `result_summary` refreshed
- [ ] `POST /api/jobs/{id}/rerun` returns new `job_id` and orchestrator starts
- [ ] Existing plan save + case re-run still work

Direct BE check (token only in your shell, not in FE):

```powershell
$secret = 'YOUR_QA_WEBHOOK_SECRET'
Invoke-WebRequest `
  -Uri 'https://n8n-production-6e6f5.up.railway.app/webhook/qa/create-or-start' `
  -Method POST `
  -Headers @{ 'X-QA-Token' = $secret } `
  -ContentType 'application/json' `
  -Body (@{
    project_name = 'FE smoke'
    website_url  = 'https://example.com'
    options = @{
      mode = 'ai_qa'
      playwright_service_url = 'https://playwright-nodejs-production-7e91.up.railway.app'
      s3_bucket = 'qa-auto-bucket-biv-qk4dkm'
    }
  } | ConvertTo-Json -Depth 5) `
  -SkipHttpErrorCheck
```

Then poll via the UI or `GET /api/jobs/<job_id>` locally.

## BE contract reference

See [`../n8n/README.md`](../n8n/README.md) section **BE API for FE (MVP)**.
