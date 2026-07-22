/**
 * Pages Router API route — forces Vercel’s Next.js Node serverless
 * builder (zero-config will not treat the project as a pure static export).
 */
export default function handler(_req, res) {
  res.status(200).json({
    ok: true,
    ping: "pages-api",
    note: "If you see this JSON, serverless API routing works.",
  });
}
