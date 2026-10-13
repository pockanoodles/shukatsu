import { NextResponse, type NextRequest } from "next/server";

// Pages anyone can open. Everything else needs a session cookie; the page
// itself still checks the session properly (this is only the fast redirect).
const PUBLIC = [/^\/$/, /^\/login$/, /^\/invite\/[^/]+$/, /^\/api\/health$/];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (!PUBLIC.some((re) => re.test(pathname)) && !request.cookies.has("shk_session")) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname === "/today" ? "" : `?next=${encodeURIComponent(pathname + request.nextUrl.search)}`;
    return NextResponse.redirect(url);
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const dev = process.env.NODE_ENV === "development";
  // HTTPS-only rules apply only when the app is actually served over HTTPS
  // (a tunnel); a tailnet address like http://mini:3000 must keep working.
  const https = (process.env.SHUKATSU_URL || "").startsWith("https://") || request.headers.get("x-forwarded-proto") === "https";
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    // React style attributes need inline styles; scripts are the strict part.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self'${dev ? " ws: wss:" : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(https ? ["upgrade-insecure-requests"] : []),
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "same-origin");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  // The capture window is opened by a job board's page and must stay reachable from it, so it alone keeps its opener.
  response.headers.set("Cross-Origin-Opener-Policy", pathname === "/capture" ? "unsafe-none" : "same-origin");
  if (https) response.headers.set("Strict-Transport-Security", "max-age=31536000");
  return response;
}

export const config = {
  matcher: [{ source: "/((?!_next/static|_next/image|favicon.ico|icon.svg).*)", missing: [{ type: "header", key: "next-router-prefetch" }] }],
};
