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
| `/jobs/[jobId]` polls every 4s | `GET /api/jobs/[jobId]` → `GET …/webhook/qa/job-status?job_id=` |
| Open HTML report | `GET /api/jobs/[jobId]/report` → poll + private S3 GetObject (rewrites `s3://` imgs) |
| Raw artifact | `GET /api/artifacts?key=qa/...` → private S3 GetObject |

Auth header `X-QA-Token` is attached **only** in Route Handlers from `QA_WEBHOOK_TOKEN`. Never sent to the browser.

S3 credentials stay **server-side** (`N8N_EXTERNAL_STORAGE_S3_*`). The browser only hits FE `/api/...` routes.

Injected into Create-or-Start `options` from env (form stays simple):

- `playwright_service_url` ← `PLAYWRIGHT_SERVICE_URL`
- `s3_bucket` ← `S3_BUCKET`
- optional `ai_model`, crawl caps, `browser`, `artifact_base_url`

OpenAI keys are **never** sent from this app (n8n credential owns them).

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

1. Confirm n8n Create-or-Start + Job Status Poll workflows are **published**.
2. Set `QA_WEBHOOK_TOKEN` to the live webhook secret.
3. `npm run dev` → open home page.
4. Start an **AI QA** job against `https://example.com` (or Manual/CSV with a case that matches the site — see `n8n/README.md` E2E notes).
5. You should land on `/jobs/<uuid>` with stages updating; terminal `succeeded` / `failed`; **Open HTML report** goes to `/api/jobs/<uuid>/report` (private S3 via server credentials).

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
