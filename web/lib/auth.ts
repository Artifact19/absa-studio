import crypto from "crypto";

const COOKIE_NAME = "absa_admin_session";
const SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1000; // 8 hours

/**
 * Constant-time comparison between user input and admin passkey
 */
export function verifyAdminPasskey(inputKey: string): boolean {
  const masterKey = process.env.ADMIN_PASSKEY || "";
  if (!masterKey || !inputKey) return false;

  const bufA = Buffer.from(inputKey);
  const bufB = Buffer.from(masterKey);

  if (bufA.length !== bufB.length) {
    // Constant-time dummy comparison to prevent timing leak on length
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }

  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Creates an HMAC signed session token: "<timestamp>.<hmac>"
 */
export function createAdminSessionToken(): string {
  const secret = process.env.ADMIN_COOKIE_SECRET || "fallback_default_secret_32_bytes_min_length!";
  const timestamp = Date.now().toString();
  const signature = crypto.createHmac("sha256", secret).update(timestamp).digest("hex");
  return `${timestamp}.${signature}`;
}

/**
 * Verifies the HMAC signed session token and checks expiry (8 hours)
 */
export function verifyAdminSessionToken(token: string | undefined | null): boolean {
  if (!token || typeof token !== "string") return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;

  const [timestampStr, signature] = parts;
  const timestamp = parseInt(timestampStr, 10);
  if (isNaN(timestamp)) return false;

  // Check 8-hour expiration
  if (Date.now() - timestamp > SESSION_MAX_AGE_MS || timestamp > Date.now() + 60000) {
    return false;
  }

  const secret = process.env.ADMIN_COOKIE_SECRET || "fallback_default_secret_32_bytes_min_length!";
  const expectedSignature = crypto.createHmac("sha256", secret).update(timestampStr).digest("hex");

  const bufA = Buffer.from(signature);
  const bufB = Buffer.from(expectedSignature);
  if (bufA.length !== bufB.length) return false;

  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Rate limiting for login attempts: 5 attempts per 15 minutes per IP
 */
const rateLimitMap = new Map<string, { count: number; firstAttempt: number }>();
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 mins
const MAX_ATTEMPTS = 5;

export function checkLoginRateLimit(ip: string): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const record = rateLimitMap.get(ip);

  if (!record || now - record.firstAttempt > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(ip, { count: 1, firstAttempt: now });
    return { allowed: true, remaining: MAX_ATTEMPTS - 1 };
  }

  if (record.count >= MAX_ATTEMPTS) {
    return { allowed: false, remaining: 0 };
  }

  record.count += 1;
  return { allowed: true, remaining: MAX_ATTEMPTS - record.count };
}

/**
 * Validates request authorization using either the admin session cookie or X-Admin-Key header
 */
export function isRequestAuthorized(req: Request): boolean {
  // Check X-Admin-Key header
  const headerKey = req.headers.get("x-admin-key");
  if (headerKey && verifyAdminPasskey(headerKey)) {
    return true;
  }

  // Check cookie
  const cookieHeader = req.headers.get("cookie") || "";
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
  const token = match ? match[1] : null;

  return verifyAdminSessionToken(token);
}

/**
 * CSRF origin validation for mutating admin requests
 */
export function verifyCsrfOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true; // Direct non-browser curl requests with X-Admin-Key might not have origin

  const host = req.headers.get("host");
  if (!host) return true;

  try {
    const originUrl = new URL(origin);
    return originUrl.host === host;
  } catch {
    return false;
  }
}

export { COOKIE_NAME, SESSION_MAX_AGE_MS };
