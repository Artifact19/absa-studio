import { NextRequest, NextResponse } from "next/server";
import {
  verifyAdminPasskey,
  createAdminSessionToken,
  checkLoginRateLimit,
  COOKIE_NAME,
  SESSION_MAX_AGE_MS,
} from "@/lib/auth";

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "127.0.0.1";
    const rateLimit = checkLoginRateLimit(ip);

    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "Too many failed login attempts. Please try again in 15 minutes." },
        { status: 429, headers: { "X-Robots-Tag": "noindex" } }
      );
    }

    const body = await req.json().catch(() => ({}));
    const passkey = body.passkey ? String(body.passkey) : "";

    if (!passkey || !verifyAdminPasskey(passkey)) {
      return NextResponse.json(
        { error: "Invalid admin passkey", remainingAttempts: rateLimit.remaining },
        { status: 401, headers: { "X-Robots-Tag": "noindex" } }
      );
    }

    const token = createAdminSessionToken();
    const isProd = process.env.NODE_ENV === "production";

    const response = NextResponse.json(
      { ok: true, message: "Authenticated successfully" },
      { headers: { "X-Robots-Tag": "noindex" } }
    );

    response.cookies.set({
      name: COOKIE_NAME,
      value: token,
      httpOnly: true,
      secure: isProd,
      sameSite: "strict",
      path: "/",
      maxAge: Math.floor(SESSION_MAX_AGE_MS / 1000),
    });

    return response;
  } catch (err) {
    console.error("Admin login error:", err);
    return NextResponse.json({ error: "Authentication failed" }, { status: 500 });
  }
}
