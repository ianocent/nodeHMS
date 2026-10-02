/**
 * Mandatory guest-profile fields for check-in.
 *
 * Laravel parity: `Property::$mandatory_check_in` is a cast-to-array column
 * holding a list of `guest_profiles` column names. `Folio.php:1245-1269`
 * refuses check-in when any of them is blank on the guest.
 *
 * Two things this module fixes versus a naive `guest[field]` read:
 *
 *  1. The property form used to post labels that never matched a column
 *     (`id_expired`, `birth_date`, `nationality`, `phone`, `city`,
 *     `country`). Those always resolve to undefined, so a configured
 *     property would reject every check-in with an unfixable list.
 *     `MANDATORY_FIELD_ALIASES` maps them onto the real columns.
 *  2. `birth_of_date` and friends can be legitimately falsey-ish values
 *     stored as the literal string 'null' by older imports; Laravel
 *     treats those as blank too, so we do.
 */

/** Canonical name (a real guest_profiles column) -> human label. */
export const MANDATORY_FIELD_LABELS: Record<string, string> = {
  card_type: 'Card Type',
  card_number: 'Card Number',
  card_expiry: 'ID Expiry',
  birth_of_date: 'Date of Birth',
  gender: 'Gender',
  nationality_id: 'Nationality',
  email: 'Email',
  mobile_phone: 'Mobile Phone',
  telp: 'Telephone',
  address: 'Address',
  region: 'Region',
  country_id: 'Country',
  city_id: 'City',
  postal_code: 'Postal Code',
};

/**
 * Legacy / label spellings that shipped in the property form before the
 * option list was pointed at real columns. Anything not in the canonical
 * set resolves to `null` so it can be dropped instead of silently
 * satisfying the gate.
 */
const MANDATORY_FIELD_ALIASES: Record<string, string> = {
  id_expired: 'card_expiry',
  id_expiry: 'card_expiry',
  expired_date: 'card_expiry',
  birth_date: 'birth_of_date',
  birth_of_date: 'birth_of_date',
  dob: 'birth_of_date',
  nationality: 'nationality_id',
  nationality_id: 'nationality_id',
  phone: 'telp',
  telephone: 'telp',
  telp: 'telp',
  city: 'city_id',
  city_id: 'city_id',
  country: 'country_id',
  country_id: 'country_id',
  region: 'region',
  email: 'email',
  mobile_phone: 'mobile_phone',
  address: 'address',
  postal_code: 'postal_code',
  gender: 'gender',
  card_type: 'card_type',
  card_number: 'card_number',
};

/**
 * Coerce whatever shape the column/payload holds (`jsonb` array, JSON
 * string, comma string) into a de-duplicated list of real column names.
 */
export function normalizeMandatoryList(raw: any): string[] {
  let items: any[] = [];

  if (Array.isArray(raw)) {
    items = raw;
  } else if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) items = parsed;
      } catch {
        items = trimmed.split(',');
      }
    } else {
      items = trimmed.split(',');
    }
  }

  const out: string[] = [];
  for (const item of items) {
    const key = typeof item === 'string' ? item : item?.value ?? item?.key ?? item?.name;
    if (typeof key !== 'string') continue;
    const canonical = MANDATORY_FIELD_ALIASES[key.trim().toLowerCase()];
    if (canonical && !out.includes(canonical)) out.push(canonical);
  }
  return out;
}

/** Laravel treats null / '' / whitespace / the literal string 'null' as blank. */
function isBlank(value: any): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') {
    const t = value.trim().toLowerCase();
    return t === '' || t === 'null';
  }
  return false;
}

/** Column names that are not guest_profiles columns are never reported. */
export function missingMandatoryFields(guest: any, mandatory: string[]): string[] {
  if (!guest || !mandatory.length) return [];
  return mandatory.filter(
    (field) => MANDATORY_FIELD_LABELS[field] !== undefined && isBlank((guest as any)[field]),
  );
}

/**
 * The `mandatory_check_in` block Laravel's folio formatters attach, so the
 * front desk can show *which* fields are outstanding instead of a bare
 * "profile is not complete".
 */
export function mandatoryCheckInBlock(guest: any, rawMandatory: any) {
  const fields = normalizeMandatoryList(rawMandatory);
  const missing = missingMandatoryFields(guest, fields);
  return { fields, missing_fields: missing, is_complete: missing.length === 0 };
}

/**
 * Read a property's mandatory list off the raw `properties` row.
 *
 * Deliberately a raw read: this must not throw before the column exists,
 * because a property row with no `mandatory_check_in` must behave as
 * "no gate" rather than breaking check-in outright.
 */
export async function readPropertyMandatory(prisma: any, propertyId: bigint | number | null | undefined): Promise<string[]> {
  if (propertyId === null || propertyId === undefined) return [];
  let raw: any = null;
  try {
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT mandatory_check_in FROM properties WHERE id = $1`,
      propertyId,
    );
    raw = rows[0]?.mandatory_check_in;
  } catch {
    // Column absent (migration not applied yet) — behave as "no gate",
    // which is exactly what Laravel does with `$property->mandatory_check_in ?? []`.
    return [];
  }
  return normalizeMandatoryList(raw);
}