import { NextRequest, NextResponse } from "next/server";
import {
  verifyAdminPasskey,
  createAdminSessionToken,
  checkLoginRateLimit,
  COOKIE_NAME,
  SESSION_MAX_AGE_MS,
} from "@/lib/auth";

const ADMIN_EMAIL = "arnavraut4567@gmail.com";

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "127.0.0.1";
    const rateLimit = checkLoginRateLimit(ip);

    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "Too many failed attempts. Please try again in 15 minutes." },
        { status: 429, headers: { "X-Robots-Tag": "noindex" } }
      );
    }

    const body = await req.json().catch(() => ({}));
    const email = (body.email || "").trim().toLowerCase();
    const passkey = body.passkey ? String(body.passkey).trim() : "";

    const isMasterPasskey = verifyAdminPasskey(passkey);

    // If matching admin email AND master passkey -> grant admin
    if (email === ADMIN_EMAIL && isMasterPasskey) {
      const token = createAdminSessionToken();
      const isProd = process.env.NODE_ENV === "production";

      const response = NextResponse.json(
        {
          ok: true,
          role: "admin",
          email: ADMIN_EMAIL,
          redirect: "/admin",
          message: "Welcome back, Admin!",
        },
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
    }

    // Direct passkey match (CLI or direct admin login)
    if (!email && isMasterPasskey) {
      const token = createAdminSessionToken();
      const isProd = process.env.NODE_ENV === "production";

      const response = NextResponse.json(
        { ok: true, role: "admin", redirect: "/admin" },
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
    }

    // Standard user login / sign-in (any other valid email)
    if (email && email.includes("@")) {
      return NextResponse.json({
        ok: true,
        role: "user",
        email,
        message: `Signed in as ${email}`,
      });
    }

    return NextResponse.json(
      { error: "Invalid email or passkey", remainingAttempts: rateLimit.remaining },
      { status: 401, headers: { "X-Robots-Tag": "noindex" } }
    );
  } catch (err) {
    console.error("Login route error:", err);
    return NextResponse.json({ error: "Authentication failed" }, { status: 500 });
  }
}
