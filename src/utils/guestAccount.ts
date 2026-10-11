import { prisma } from '../config/prisma';

/**
 * Next `GA######` guest account number.
 *
 * Counted as a number, and across all properties. Two separate defects produced the
 * duplicate account numbers:
 *
 *  1. `orderBy { account: 'desc' }` sorts lexicographically, so the row it returns as
 *     "last" is not the highest number once the tail stops being zero-padded to one
 *     width. Every call site parsed that row with `parseInt` and added 1.
 *  2. Every call site scoped the lookup to its own `property_id`, but the series is
 *     shared: property 999 runs GA000002..GA085456 and 1002 runs GA000001..GA085459,
 *     interleaved (ids 93426..93430 are 1002, 93431 is 999, both drawing GA0854xx).
 *     Two properties read the same "last" and handed out the same number — 93426/93431
 *     are both GA085455 and 93427/93432 are both GA085456.
 *
 * Nothing caught it: `account` has no UNIQUE constraint (only `property_id` and
 * `(id, property_id, deleted_at)` are indexed). The index has to wait for the existing
 * duplicates to be cleaned up — see OPTIMIZE-BE-HMS.md.
 *
 * Reads the top of the series rather than MAX() because `account` is text and Postgres
 * will not compare text with bigint. Rows arrive newest-first, so the first parseable
 * one holds the maximum and a malformed row sorting to the end is skipped rather than
 * poisoning the count.
 */
export async function nextGuestAccount(): Promise<string> {
  const rows: any[] = await prisma.guest_profiles.findMany({
    where: { account: { startsWith: 'GA' } },
    orderBy: { account: 'desc' },
    take: 25,
    select: { account: true },
  });
  let max = 0;
  for (const row of rows) {
    const m = String(row.account ?? '').match(/^GA(\d{1,9})$/);
    if (!m) continue;
    max = parseInt(m[1], 10);
    break;
  }
  return 'GA' + String(max + 1).padStart(6, '0');
}