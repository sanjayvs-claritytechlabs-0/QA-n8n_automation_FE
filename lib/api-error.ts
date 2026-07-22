/** Client helpers for /api/* JSON error envelopes (and HTML failure pages). */

export function apiErrorMessage(
  data: unknown,
  status: number,
  fallbackPrefix: string,
): string {
  const obj =
    data && typeof data === "object"
      ? (data as Record<string, unknown>)
      : null;
  const err = obj?.error;
  if (typeof err === "string" && err.trim()) return err.trim();
  if (err && typeof err === "object") {
    const msg = (err as { message?: unknown }).message;
    if (typeof msg === "string" && msg.trim()) return msg.trim();
  }
  if (typeof obj?.message === "string" && obj.message.trim()) {
    return obj.message.trim();
  }
  // Vercel static-export / missing serverless functions return HTML _error
  // pages with nextExport:true — no JSON error.message.
  if (
    typeof data === "string" &&
    (data.includes("nextExport") || data.includes("Internal Server Error"))
  ) {
    return `${fallbackPrefix}: API routes are not running (static export or failed serverless deploy). On Vercel: Framework=Next.js, clear Output Directory, set env vars, redeploy.`;
  }
  return `${fallbackPrefix} (${status})`;
}
