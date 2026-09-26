/**
 * Outgoing JSON normalization shared by every API response.
 *
 * Laravel parity:
 *  - Eloquent date casts serialize as `Y-m-d H:i:s` (no `T` / `Z` / milliseconds),
 *    while raw `Date` objects would be emitted by JSON.stringify as ISO-8601 UTC.
 *  - Postgres `bigint` / numeric columns serialize as JSON numbers, not strings.
 *
 * Both conversions live here so the whole API emits one consistent format.
 */
export function normalizeJson(val: any): any {
  if (val instanceof Date) {
    if (Number.isNaN(val.getTime())) return null;
    const y = val.getUTCFullYear();
    if (y === 1970 && val.getUTCMonth() === 0 && val.getUTCDate() === 1) {
      return val.toISOString().slice(11, 19);
    }
    const s = val.toISOString().slice(0, 19).replace('T', ' ');
    return s.endsWith(' 00:00:00') ? s.slice(0, 10) : s;
  }
  if (typeof val === 'bigint') return Number(val);
  if (Array.isArray(val)) return val.map(normalizeJson);
  if (val && typeof val === 'object' && typeof (val as any).toNumber === 'function') {
    return Number((val as any).toNumber());
  }
  if (val instanceof Map) return normalizeJson(Object.fromEntries(val));
  if (val && typeof val === 'object') {
    // Respect custom serializers (e.g. Decimal wrappers) before walking own keys.
    if (typeof (val as any).toJSON === 'function') {
      return normalizeJson((val as any).toJSON());
    }
    const out: any = {};
    for (const [k, v] of Object.entries(val)) {
      out[k] = normalizeJson(v);
    }
    return out;
  }
  return val;
}
