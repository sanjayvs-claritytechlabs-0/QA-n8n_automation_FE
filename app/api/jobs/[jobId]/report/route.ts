import { NextResponse } from "next/server";
import { jsonError, n8nConfig } from "@/lib/n8n";
import {
  getObjectBuffer,
  parseS3Url,
  rewriteS3UrlsInHtml,
  s3Bucket,
} from "@/lib/s3";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Ctx = { params: Promise<{ jobId: string }> };

type PollPayload = {
  ok?: boolean;
  report_url?: string | null;
  report_object_key?: string | null;
  error?: { message?: string };
};

/**
 * Proxy the HTML report for a job: resolve object key via n8n poll, fetch from
 * private S3, rewrite embedded s3:// screenshot URLs to /api/artifacts.
 */
export async function GET(_request: Request, context: Ctx) {
  const { jobId } = await context.params;
  if (!jobId || !UUID_RE.test(jobId)) {
    return jsonError(400, "VALIDATION_ERROR", "job_id must be a UUID");
  }

  let cfg: ReturnType<typeof n8nConfig>;
  try {
    cfg = n8nConfig();
  } catch (e) {
    return jsonError(
      500,
      "CONFIG_ERROR",
      e instanceof Error ? e.message : "Server misconfigured",
    );
  }

  const pollUrl = `${cfg.baseUrl}/webhook/qa/job-status?job_id=${encodeURIComponent(jobId)}`;
  let poll: PollPayload;
  try {
    const res = await fetch(pollUrl, {
      method: "GET",
      headers: { "X-QA-Token": cfg.token },
      cache: "no-store",
    });
    poll = (await res.json().catch(() => null)) as PollPayload;
    if (!res.ok || !poll?.ok) {
      return jsonError(
        res.status === 404 ? 404 : 502,
        "REPORT_UNAVAILABLE",
        poll?.error?.message || "Could not load job status",
      );
    }
  } catch (e) {
    return jsonError(
      502,
      "UPSTREAM_UNAVAILABLE",
      e instanceof Error ? e.message : "Failed to reach n8n",
    );
  }

  let key = poll.report_object_key?.trim() || "";
  let bucket = s3Bucket();

  if (!key && poll.report_url) {
    const parsed = parseS3Url(poll.report_url);
    if (parsed) {
      key = parsed.key;
      bucket = parsed.bucket;
    } else if (/^https?:\/\//i.test(poll.report_url)) {
      // Already browser-openable (public base) — redirect.
      return NextResponse.redirect(poll.report_url, 302);
    }
  }

  if (!key) {
    return jsonError(404, "REPORT_NOT_FOUND", "No report artifact for this job yet");
  }

  try {
    const { body, contentType } = await getObjectBuffer(key, bucket);
    const isHtml = /html/i.test(contentType) || key.endsWith(".html");
    if (isHtml) {
      const html = rewriteS3UrlsInHtml(body.toString("utf8"));
      return new NextResponse(html, {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "private, max-age=30",
        },
      });
    }
    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "S3 get failed";
    if (/Missing env/i.test(msg)) {
      return jsonError(500, "CONFIG_ERROR", msg);
    }
    return jsonError(502, "S3_ERROR", msg);
  }
}
