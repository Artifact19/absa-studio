/**
 * Lightweight in-memory sliding-window IP rate limiter
 * Protects public API endpoints from denial-of-service, quota drain, and scraping loops.
 */

interface RateLimitRecord {
  count: number;
  resetTime: number;
}

const rateLimitStore = new Map<string, RateLimitRecord>();

export function checkPublicEndpointRateLimit(
  ip: string,
  maxRequests = 40,
  windowMs = 10 * 60 * 1000 // 10 minutes
): { allowed: boolean; remaining: number; retryAfterSeconds: number } {
  const now = Date.now();

  // Periodic cleanup of expired records if map exceeds 5000 items
  if (rateLimitStore.size > 5000) {
    for (const [k, v] of rateLimitStore.entries()) {
      if (now > v.resetTime) {
        rateLimitStore.delete(k);
      }
    }
  }

  const existing = rateLimitStore.get(ip);

  if (!existing || now > existing.resetTime) {
    rateLimitStore.set(ip, { count: 1, resetTime: now + windowMs });
    return {
      allowed: true,
      remaining: maxRequests - 1,
      retryAfterSeconds: Math.ceil(windowMs / 1000),
    };
  }

  if (existing.count >= maxRequests) {
    const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetTime - now) / 1000));
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds,
    };
  }

  existing.count += 1;
  return {
    allowed: true,
    remaining: maxRequests - existing.count,
    retryAfterSeconds: Math.ceil((existing.resetTime - now) / 1000),
  };
}
