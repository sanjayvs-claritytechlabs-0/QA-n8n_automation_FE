import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";

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

/** Only allow keys written by our pipeline (qa/{project}/{job}/...). */
export function assertSafeObjectKey(key: string): string {
  const k = key.replace(/^\/+/, "").trim();
  if (!k || k.includes("..") || k.includes("\\")) {
    throw new Error("Invalid object key");
  }
  if (!/^qa\/[0-9a-f-]{36}\/[0-9a-f-]{36}\//i.test(k)) {
    throw new Error("Object key outside allowed qa/{project}/{job}/ prefix");
  }
  return k;
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
