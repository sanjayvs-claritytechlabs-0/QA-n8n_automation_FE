import { NextResponse } from "next/server";
import { jsonError, n8nConfig } from "@/lib/n8n";
import { cleanupS3 } from "@/lib/s3";

function extractUpstreamMessage(
  data: Record<string, unknown> | null,
  fallback: string,
): string {
  if (!data) return fallback;
  const err = data.error;
  if (typeof err === "string" && err.trim()) return err.trim();
  if (err && typeof err === "object") {
    const msg = (err as { message?: unknown }).message;
    if (typeof msg === "string" && msg.trim()) return msg.trim();
  }
  if (typeof data.message === "string" && data.message.trim()) {
    return data.message.trim();
  }
  return fallback;
}

export async function n8nFetch(
  path: string,
  init?: RequestInit,
): Promise<{ res: Response; data: Record<string, unknown> | null }> {
  const cfg = n8nConfig();
  const headers: Record<string, string> = {
    "X-QA-Token": cfg.token,
  };
  if (init?.body) headers["Content-Type"] = "application/json";
  const res = await fetch(`${cfg.baseUrl}${path}`, {
    ...init,
    headers: { ...headers, ...(init?.headers as Record<string, string>) },
    cache: "no-store",
  });
  const data = (await res.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  return { res, data };
}

export function upstreamError(
  res: Response,
  data: Record<string, unknown> | null,
  fallback: string,
) {
  const message = extractUpstreamMessage(data, fallback);
  const body =
    data && typeof data === "object" && data.error
      ? data
      : {
          ok: false,
          error: {
            code:
              (data &&
                typeof data.code === "string" &&
                data.code) ||
              "UPSTREAM_ERROR",
            message,
            details: data ?? undefined,
          },
        };
  return NextResponse.json(body, {
    status: res.status >= 400 ? res.status : 502,
  });
}

export function configError(e: unknown) {
  return jsonError(
    500,
    "CONFIG_ERROR",
    e instanceof Error ? e.message : "Server misconfigured",
  );
}

export function unavailable(e: unknown) {
  return jsonError(
    502,
    "UPSTREAM_UNAVAILABLE",
    e instanceof Error ? e.message : "n8n unavailable",
  );
}

/** After n8n DB delete: best-effort S3 cleanup; never blocks success. */
export async function withS3Cleanup(
  data: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const prefix =
    typeof data.s3_prefix === "string" ? data.s3_prefix : null;
  const keys = Array.isArray(data.object_keys)
    ? (data.object_keys as string[])
    : [];
  try {
    const s3 = await cleanupS3({ prefix, object_keys: keys });
    return { ...data, s3 };
  } catch (e) {
    return {
      ...data,
      s3: {
        ok: false,
        deleted_count: 0,
        failed_count: 1,
        failed: [
          {
            key: prefix || "(keys)",
            error: e instanceof Error ? e.message : "S3 cleanup failed",
          },
        ],
      },
    };
  }
}
