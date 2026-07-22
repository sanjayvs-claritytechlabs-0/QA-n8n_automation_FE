import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
  type _Object,
} from "@aws-sdk/client-s3";

function env(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v || undefined;
}

function requireEnv(name: string): string {
  const v = env(name);
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

/** Normalize Railway / n8n external-storage host to an HTTPS endpoint. */
function s3Endpoint(): string {
  const host = requireEnv("N8N_EXTERNAL_STORAGE_S3_HOST").replace(/\/$/, "");
  if (/^https?:\/\//i.test(host)) return host;
  return `https://${host}`;
}

let cached: S3Client | null = null;

export function s3Bucket(): string {
  return (
    env("N8N_EXTERNAL_STORAGE_S3_BUCKET_NAME") ||
    env("S3_BUCKET") ||
    requireEnv("N8N_EXTERNAL_STORAGE_S3_BUCKET_NAME")
  );
}

export function getS3Client(): S3Client {
  if (cached) return cached;
  cached = new S3Client({
    region: env("N8N_EXTERNAL_STORAGE_S3_BUCKET_REGION") || "auto",
    endpoint: s3Endpoint(),
    // Railway Credentials UI: Force Path Style OFF for storage.railway.app
    forcePathStyle: false,
    credentials: {
      accessKeyId: requireEnv("N8N_EXTERNAL_STORAGE_S3_ACCESS_KEY"),
      secretAccessKey: requireEnv("N8N_EXTERNAL_STORAGE_S3_ACCESS_SECRET"),
    },
  });
  return cached;
}

const UUID =
  "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";

/** Only allow keys written by our pipeline (qa/{project}/{job}/...). */
export function assertSafeObjectKey(key: string): string {
  const k = key.replace(/^\/+/, "").trim();
  if (!k || k.includes("..") || k.includes("\\")) {
    throw new Error("Invalid object key");
  }
  if (!new RegExp(`^qa\\/${UUID}\\/${UUID}\\/`, "i").test(k)) {
    throw new Error("Object key outside allowed qa/{project}/{job}/ prefix");
  }
  return k;
}

/** Allow project or job prefixes: qa/{project}/ or qa/{project}/{job}/ */
export function assertSafeS3Prefix(prefix: string): string {
  const p = prefix.replace(/^\/+/, "").trim();
  if (!p || p.includes("..") || p.includes("\\")) {
    throw new Error("Invalid S3 prefix");
  }
  const withSlash = p.endsWith("/") ? p : `${p}/`;
  if (
    !new RegExp(`^qa\\/${UUID}\\/$`, "i").test(withSlash) &&
    !new RegExp(`^qa\\/${UUID}\\/${UUID}\\/$`, "i").test(withSlash)
  ) {
    throw new Error("S3 prefix outside allowed qa/{project}/[job]/");
  }
  return withSlash;
}

/** Parse s3://bucket/key → { bucket, key }. */
export function parseS3Url(url: string): { bucket: string; key: string } | null {
  const m = String(url).trim().match(/^s3:\/\/([^/]+)\/(.+)$/i);
  if (!m) return null;
  return { bucket: m[1], key: m[2] };
}

export async function getObjectBuffer(key: string, bucket = s3Bucket()) {
  const safeKey = assertSafeObjectKey(key);
  const out = await getS3Client().send(
    new GetObjectCommand({ Bucket: bucket, Key: safeKey }),
  );
  const bytes = out.Body ? await out.Body.transformToByteArray() : new Uint8Array();
  return {
    body: Buffer.from(bytes),
    contentType: out.ContentType || "application/octet-stream",
    contentLength: out.ContentLength,
  };
}

/**
 * Rewrite s3://bucket/key links in HTML so the browser hits our FE proxy.
 */
export function rewriteS3UrlsInHtml(html: string, proxyPath = "/api/artifacts"): string {
  return html.replace(
    /s3:\/\/([^/"'\s<>]+)\/([^"'\s<>]+)/gi,
    (_full, _bucket: string, key: string) => {
      try {
        const safe = assertSafeObjectKey(decodeURIComponent(key));
        return `${proxyPath}?key=${encodeURIComponent(safe)}`;
      } catch {
        return "#";
      }
    },
  );
}

export type S3DeleteResult = {
  deleted: string[];
  failed: Array<{ key: string; error: string }>;
  listed: number;
};

/** Best-effort delete of known object keys (chunks of 1000). */
export async function deleteObjectKeys(
  keys: string[],
  bucket = s3Bucket(),
): Promise<S3DeleteResult> {
  const deleted: string[] = [];
  const failed: Array<{ key: string; error: string }> = [];
  const safeKeys: string[] = [];
  for (const raw of keys) {
    if (typeof raw !== "string" || !raw.trim()) continue;
    try {
      safeKeys.push(assertSafeObjectKey(raw.trim()));
    } catch (e) {
      failed.push({
        key: raw,
        error: e instanceof Error ? e.message : "invalid key",
      });
    }
  }
  const client = getS3Client();
  for (let i = 0; i < safeKeys.length; i += 1000) {
    const chunk = safeKeys.slice(i, i + 1000);
    try {
      const out = await client.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: {
            Objects: chunk.map((Key) => ({ Key })),
            Quiet: true,
          },
        }),
      );
      const errSet = new Set(
        (out.Errors || []).map((e) => e.Key).filter(Boolean) as string[],
      );
      for (const e of out.Errors || []) {
        failed.push({
          key: e.Key || "",
          error: `${e.Code || "Error"}: ${e.Message || "delete failed"}`,
        });
      }
      for (const k of chunk) {
        if (!errSet.has(k)) deleted.push(k);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "deleteObjects failed";
      for (const k of chunk) failed.push({ key: k, error: msg });
    }
  }
  return { deleted, failed, listed: safeKeys.length };
}

/** List + delete everything under qa/{project}/ or qa/{project}/{job}/. */
export async function deletePrefix(
  prefix: string,
  bucket = s3Bucket(),
): Promise<S3DeleteResult> {
  const safePrefix = assertSafeS3Prefix(prefix);
  const client = getS3Client();
  const allKeys: string[] = [];
  let token: string | undefined;
  do {
    const page = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: safePrefix,
        ContinuationToken: token,
      }),
    );
    for (const obj of (page.Contents || []) as _Object[]) {
      if (obj.Key) allKeys.push(obj.Key);
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);

  const result = await deleteObjectKeys(allKeys, bucket);
  return { ...result, listed: allKeys.length };
}

/**
 * Prefer prefix wipe when available; also attempt explicit keys (idempotent).
 * Returns partial success details — callers should not fail the HTTP request solely on S3 errors.
 */
export async function cleanupS3(opts: {
  prefix?: string | null;
  object_keys?: string[] | null;
}): Promise<{
  ok: boolean;
  prefix?: string;
  deleted_count: number;
  failed_count: number;
  failed: Array<{ key: string; error: string }>;
}> {
  const failed: Array<{ key: string; error: string }> = [];
  let deleted_count = 0;
  let prefixUsed: string | undefined;

  if (opts.prefix) {
    try {
      prefixUsed = assertSafeS3Prefix(opts.prefix);
      const r = await deletePrefix(prefixUsed);
      deleted_count += r.deleted.length;
      failed.push(...r.failed);
    } catch (e) {
      failed.push({
        key: opts.prefix,
        error: e instanceof Error ? e.message : "prefix delete failed",
      });
    }
  } else if (opts.object_keys?.length) {
    const r = await deleteObjectKeys(opts.object_keys);
    deleted_count += r.deleted.length;
    failed.push(...r.failed);
  }

  return {
    ok: failed.length === 0,
    prefix: prefixUsed,
    deleted_count,
    failed_count: failed.length,
    failed: failed.slice(0, 20),
  };
}
