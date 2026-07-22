import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Presence of middleware is incompatible with `output: "export"`.
 * If Vercel/build somehow enables static export, the build must fail
 * instead of shipping a site where /api/* returns HTML 500s.
 */
export function middleware(_request: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*"],
};
