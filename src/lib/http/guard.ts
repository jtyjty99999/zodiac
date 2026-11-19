interface Bucket {
  count: number;
  resetAt: number;
}

const globalStore = globalThis as typeof globalThis & {
  __zodiacRateBuckets?: Map<string, Bucket>;
};

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);
const MAX_TRACKED_BUCKETS = 5_000;

function buckets(): Map<string, Bucket> {
  if (!globalStore.__zodiacRateBuckets) {
    globalStore.__zodiacRateBuckets = new Map();
  }
  return globalStore.__zodiacRateBuckets;
}

function pruneExpired(store: Map<string, Bucket>, now: number): void {
  if (store.size <= MAX_TRACKED_BUCKETS) return;
  for (const [key, bucket] of store) {
    if (bucket.resetAt <= now) store.delete(key);
  }
}

function hostnameOf(host: string | null): string | null {
  if (!host) return null;
  try {
    return new URL(`http://${host}`).hostname.replace(/^\[|\]$/g, "").toLowerCase();
  } catch {
    return null;
  }
}

export function isLocalHost(host: string | null): boolean {
  const hostname = hostnameOf(host);
  return hostname !== null && LOCAL_HOSTNAMES.has(hostname);
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export function checkRateLimit(key: string, limit = 30, windowMs = 60_000): RateLimitResult {
  const now = Date.now();
  const store = buckets();
  pruneExpired(store, now);
  const current = store.get(key);

  if (!current || current.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 };
  }

  current.count += 1;
  const remaining = Math.max(limit - current.count, 0);
  return {
    allowed: current.count <= limit,
    remaining,
    retryAfterSeconds: Math.ceil((current.resetAt - now) / 1000),
  };
}

// This app is meant to run on localhost only. Forwarded headers are
// client-settable, so trusting them would let a caller rotate rate-limit keys.
export function clientKey(_request: Request): string {
  return "local";
}

export function isSameOrigin(request: Request): boolean {
  // Reject any Host that isn't loopback: this blocks DNS-rebinding attacks
  // where an attacker page resolves its own domain to 127.0.0.1.
  const host = request.headers.get("host");
  if (!isLocalHost(host)) return false;

  const origin = request.headers.get("origin");
  // Mutations from browsers always carry Origin; a missing one is either a
  // non-browser client or a forged simple request, so deny it.
  if (!origin) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
