import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const COOKIE_NAME = "absa_admin_session";
const SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1000;

async function verifyEdgeToken(token: string, secret: string): Promise<boolean> {
  const parts = token.split(".");
  if (parts.length !== 2) return false;

  const [timestampStr, signature] = parts;
  const timestamp = parseInt(timestampStr, 10);
  if (isNaN(timestamp)) return false;

  if (Date.now() - timestamp > SESSION_MAX_AGE_MS || timestamp > Date.now() + 60000) {
    return false;
  }

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const sigBuffer = await crypto.subtle.sign("HMAC", key, enc.encode(timestampStr));
  const expectedSig = Array.from(new Uint8Array(sigBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return signature === expectedSig;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Allow login endpoint unconditionally
  if (pathname === "/api/admin/login") {
    const res = NextResponse.next();
    res.headers.set("X-Robots-Tag", "noindex");
    return res;
  }

  const adminPasskey = process.env.ADMIN_PASSKEY || "";
  const cookieSecret = process.env.ADMIN_COOKIE_SECRET || "fallback_default_secret_32_bytes_min_length!";

  // Check header
  const headerKey = req.headers.get("x-admin-key");
  let isAuthed = false;

  if (headerKey && adminPasskey && headerKey === adminPasskey) {
    isAuthed = true;
  }

  // Check cookie
  if (!isAuthed) {
    const cookie = req.cookies.get(COOKIE_NAME);
    if (cookie?.value) {
      isAuthed = await verifyEdgeToken(cookie.value, cookieSecret);
    }
  }

  // If request is for an admin API route and unauthorized -> 401
  if (pathname.startsWith("/api/admin")) {
    if (!isAuthed) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: { "X-Robots-Tag": "noindex" } });
    }
    const res = NextResponse.next();
    res.headers.set("X-Robots-Tag", "noindex");
    return res;
  }

  // If request is for /admin frontend page:
  // We can pass a custom header `x-admin-authenticated: true` or `false`
  // so the /admin page layout or component renders the passkey login form when false!
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-admin-authenticated", isAuthed ? "true" : "false");

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  response.headers.set("X-Robots-Tag", "noindex");
  return response;
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
