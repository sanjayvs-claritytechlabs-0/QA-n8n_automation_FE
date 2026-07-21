/**
 * Runnable self-check (ponytail) for S3 key/url helpers.
 * Run: node --experimental-strip-types lib/s3.check.mjs
 * or after build: import from compiled — kept as plain JS assert file.
 */
import assert from "node:assert/strict";

function assertSafeObjectKey(key) {
  const k = key.replace(/^\/+/, "").trim();
  if (!k || k.includes("..") || k.includes("\\")) throw new Error("Invalid object key");
  if (!/^qa\/[0-9a-f-]{36}\/[0-9a-f-]{36}\//i.test(k)) {
    throw new Error("Object key outside allowed qa/{project}/{job}/ prefix");
  }
  return k;
}

function parseS3Url(url) {
  const m = String(url).trim().match(/^s3:\/\/([^/]+)\/(.+)$/i);
  if (!m) return null;
  return { bucket: m[1], key: m[2] };
}

const pid = "11111111-1111-4111-8111-111111111111";
const jid = "22222222-2222-4222-8222-222222222222";
const key = `qa/${pid}/${jid}/report/report.html`;

assert.equal(assertSafeObjectKey(key), key);
assert.throws(() => assertSafeObjectKey("../etc/passwd"));
assert.throws(() => assertSafeObjectKey("other/bucket/key"));

const parsed = parseS3Url(`s3://my-bucket/${key}`);
assert.equal(parsed.bucket, "my-bucket");
assert.equal(parsed.key, key);
assert.equal(parseS3Url("https://example.com/x"), null);

console.log("s3.check: ok");
