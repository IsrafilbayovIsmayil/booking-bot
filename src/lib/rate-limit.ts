/**
 * Лёгкий fixed-window rate limiter в памяти процесса. На Vercel это
 * best-effort защита (каждый инстанс считает независимо), но она отсекает
 * наивные скрипты и случайные даблклики. Для жёсткой гарантии подключите
 * внешнее хранилище (Upstash Redis / Vercel KV) с тем же интерфейсом.
 */

interface WindowState {
  windowStartMs: number;
  count: number;
}

const windows = new Map<string, WindowState>();

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();
  const state = windows.get(key);

  if (state === undefined || now - state.windowStartMs >= windowMs) {
    windows.set(key, { windowStartMs: now, count: 1 });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (state.count >= limit) {
    const retryAfterMs = state.windowStartMs + windowMs - now;
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
    };
  }

  state.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}

/** IP клиента за прокси Vercel/Cloudflare; fallback — "unknown". */
export function clientIpFromHeaders(headers: Headers): string {
  const forwardedFor = headers.get("x-forwarded-for");
  if (forwardedFor !== null && forwardedFor.length > 0) {
    const firstHop = forwardedFor.split(",")[0];
    if (firstHop !== undefined && firstHop.trim().length > 0) {
      return firstHop.trim();
    }
  }
  const realIp = headers.get("x-real-ip");
  if (realIp !== null && realIp.length > 0) {
    return realIp;
  }
  return "unknown";
}
