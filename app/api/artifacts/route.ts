import { NextRequest, NextResponse } from "next/server";
import { jsonError } from "@/lib/n8n";
import { getObjectBuffer, parseS3Url, s3Bucket } from "@/lib/s3";

/**
 * Stream a private S3 object to the browser.
 * GET /api/artifacts?key=qa/{project}/{job}/...
 * GET /api/artifacts?url=s3://bucket/key
 */
export async function GET(request: NextRequest) {
  const keyParam = request.nextUrl.searchParams.get("key");
  const urlParam = request.nextUrl.searchParams.get("url");

  let key = keyParam?.trim() || "";
  let bucket = s3Bucket();

  if (!key && urlParam) {
    const parsed = parseS3Url(urlParam);
    if (!parsed) {
      return jsonError(400, "VALIDATION_ERROR", "url must be s3://bucket/key");
    }
    key = parsed.key;
    bucket = parsed.bucket;
  }

  if (!key) {
    return jsonError(400, "VALIDATION_ERROR", "key or url query param required");
  }

  try {
    const { body, contentType } = await getObjectBuffer(key, bucket);
    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "S3 get failed";
    if (/Invalid object key|outside allowed/i.test(msg)) {
      return jsonError(400, "VALIDATION_ERROR", msg);
    }
    if (/Missing env/i.test(msg)) {
      return jsonError(500, "CONFIG_ERROR", msg);
    }
    return jsonError(502, "S3_ERROR", msg);
  }
}
