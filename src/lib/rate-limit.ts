/**
 * Fixed-window, in-memory rate limiter keyed by client (IP). Per server
 * instance only: good enough for dev and a single deployment; Phase 7 can
 * swap in a shared store.
 */
export type RateLimiter = (
  key: string,
  now?: number,
) => { ok: true } | { ok: false; retryAfterSeconds: number };

export function createRateLimiter(limit: number, windowMs: number): RateLimiter {
  const windows = new Map<string, { start: number; count: number }>();
  return (key, now = Date.now()) => {
    const w = windows.get(key);
    if (!w || now - w.start >= windowMs) {
      windows.set(key, { start: now, count: 1 });
      if (windows.size > 10_000) windows.clear();
      return { ok: true };
    }
    if (w.count >= limit) {
      return { ok: false, retryAfterSeconds: Math.ceil((w.start + windowMs - now) / 1000) };
    }
    w.count++;
    return { ok: true };
  };
}

export function clientKey(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || req.headers.get("x-real-ip") || "local";
}
