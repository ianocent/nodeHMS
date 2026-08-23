// Simple fixed-window rate limiter (no external dep) + payload redaction
// for STAAH endpoints — Laravel RateLimiter 10k/hour parity (:1548-1549 area).
import { Request, Response, NextFunction } from 'express';

const WINDOW_MS = 60 * 60 * 1000; // 1 hour
const DEFAULT_LIMIT = 10_000; // Laravel: 10k per hour

interface Bucket { count: number; resetAt: number }
const buckets = new Map<string, Bucket>();

// periodic sweep so the map doesn't grow forever
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (b.resetAt < now) buckets.delete(k);
}, WINDOW_MS).unref();

export function staahRateLimit(req: Request, res: Response, next: NextFunction): void {
  const limit = Number(process.env.STAAH_RATE_LIMIT ?? DEFAULT_LIMIT);
  // key by interface token if present, else IP
  const ifaceToken = String((req.headers?.authorization ?? '') || req.ip || 'anon');
  const key = `${ifaceToken.slice(0, 64)}:${req.ip}`;
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    bucket = { count: 0, resetAt: now + WINDOW_MS };
    buckets.set(key, bucket);
  }
  bucket.count += 1;
  res.setHeader('X-RateLimit-Limit', String(limit));
  res.setHeader('X-RateLimit-Remaining', String(Math.max(0, limit - bucket.count)));
  if (bucket.count > limit) {
    res.status(429).json({ Status: 'Error', Message: 'Too many requests' });
    return;
  }
  next();
}

// Redact sensitive fields before persisting third-party payloads to logs.
export function redactPayload(payload: any): any {
  if (!payload || typeof payload !== 'object') return payload;
  try {
    const clone = JSON.parse(JSON.stringify(payload));
    const walk = (obj: any): void => {
      for (const k of Object.keys(obj)) {
        if (/card(_?number)?|cvv|cvc|password/i.test(k)) obj[k] = '***REDACTED***';
        else if (obj[k] && typeof obj[k] === 'object') walk(obj[k]);
      }
    };
    walk(clone);
    return clone;
  } catch {
    return '[unserializable]';
  }
}
