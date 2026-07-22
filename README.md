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
| `/jobs/[jobId]` polls every 4s | `GET /api/jobs/[jobId]` → `GET …/webhook/qa/job-status?job_id=` |
| Save structured plan JSON | `POST /api/jobs/[jobId]/plans/[planId]` → `POST …/webhook/qa/plans/update` |
| Re-run one case | `POST /api/jobs/[jobId]/cases/[planId]/rerun` → `POST …/webhook/qa/cases/re-run` |
| Open HTML report | `GET /api/jobs/[jobId]/report` → poll + private S3 GetObject (rewrites `s3://` imgs) |
| Raw artifact | `GET /api/artifacts?key=qa/...` → private S3 GetObject |

Auth header `X-QA-Token` is attached **only** in Route Handlers from `QA_WEBHOOK_TOKEN`. Never sent to the browser.

S3 credentials stay **server-side** (`N8N_EXTERNAL_STORAGE_S3_*`). The browser only hits FE `/api/...` routes.

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

1. Confirm n8n Create-or-Start + Job Status Poll + **Jobs List** workflows are **published**.
2. Set `QA_WEBHOOK_TOKEN` to the live webhook secret.
3. `npm run dev` → open home page (crawl depth/pages + recent jobs table).
4. Start an **AI QA** job against `https://example.com` (or Manual/CSV with a case that matches the site — see `n8n/README.md` E2E notes).
5. You should land on `/jobs/<uuid>` with stages updating; terminal `succeeded` / `failed`; **Artifacts** shows screenshots + report links via `/api/artifacts` / `/api/jobs/<uuid>/report`.
6. After execution, expand a case → edit **Plan JSON** (locator UUIDs) → **Save plan** → **Re-run this case**. Requires Plans Update + Cases Re-run webhooks published, and SQL `003_execution_results_job_case_unique.sql` applied once. Artifacts should include a screenshot (and video when capture is on) per executed case.

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
