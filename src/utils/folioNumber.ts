/**
 * Folio number generation — parity with the Laravel reference.
 *
 * The reference generates the number in a model hook, not in the controller:
 *
 *   app/Models/Folio.php:52-68   static::creating() -> generateCodeReservation()
 *   app/Models/Folio.php:298-304 generateCodeReservation()
 *                               -> folioNumberFormat($code, getLastResevation())
 *   app/Helpers/Global.php:400-408  folioNumberFormat()
 *   app/Models/Folio.php:2125-2141 getCodeReservation()  type -> letter
 *   app/Models/Folio.php:2143-2160 getLastResevation()    last folio of the prefix
 *
 * The node port never had that hook, so every folio created outside the Laravel-shaped
 * screens — the booking engine sync in particular — landed with `folio_number = NULL`.
 * Knock-on effects, all verified: `/module/notification` rendered the literal string
 * "null" where the folio link should be, and `PreRegistrationController::findFolio`
 * looks the folio up by `UPPER(folio_number) = ?`, so a guest who booked online could
 * never be found by the folio number printed on their card.
 *
 * Format: <code><property:3><ym><seq:4>
 *   fit -> F, git -> G, day-use -> D, anything else -> V
 *   F + 999 + 2610 + 0001 = F99926100001
 */

/** getCodeReservation() — Folio.php:2125. */
export function folioCodeFor(typeReservation: any): string {
  switch (String(typeReservation ?? '').toLowerCase()) {
    case 'git':
      return 'G';
    case 'fit':
      return 'F';
    case 'day-use':
      return 'D';
    default:
      return 'V';
  }
}

/**
 * `date('ym')`, which on the reference server is Asia/Jakarta wall time.
 *
 * Deliberately local-time parts rather than `toISOString()`: UTC would roll the stamp
 * at 17:00 WIB and put an evening folio in the previous month's series, which then
 * restarts its sequence at 0001 and collides.
 */
export function ymStamp(now: Date = new Date()): string {
  const yy = String(now.getFullYear()).slice(2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  return `${yy}${mm}`;
}

function padProperty(propertyId: number | bigint | string): string {
  return String(propertyId).padStart(3, '0');
}

/** folioNumberFormat() — Global.php:400. `prefix` + incremented 4-digit sequence. */
export function folioNumberFormat(
  code: string,
  lastFolioNumber: string | null | undefined,
  propertyId: number | bigint | string,
  now: Date = new Date()
): string {
  const prefix = `${code}${padProperty(propertyId)}${ymStamp(now)}`;
  const stripped = (lastFolioNumber ?? '').replace(prefix, '');
  // PHP does `(int) $stripped + 1`, and `(int)"NaN"` is 0, so a folio number in the series
  // that does not end in digits restarts the sequence at 0001 rather than producing
  // garbage. `parseInt` returns NaN here instead, and "F99926100NaN" written into the
  // UNIQUE folio_number column would poison the series for every later booking.
  const parsed = stripped ? parseInt(stripped, 10) : 0;
  const seq = Number.isFinite(parsed) && stripped ? String(parsed + 1).padStart(4, '0') : '0001';
  return prefix + seq;
}

/**
 * getLastResevation() + folioNumberFormat(), for any prisma-like client.
 *
 * Laravel filters `parent = 0` (a sub-folio of a GIT group is not numbered) and the
 * same `type_reservation` — day-use shares the `fit` series, so a day-use folio
 * continues the FIT numbering instead of opening a D series of its own.
 */
export async function generateFolioNumber(
  client: any,
  opts: { propertyId: number | bigint | string; typeReservation: string; now?: Date }
): Promise<string> {
  const { propertyId, typeReservation } = opts;
  const now = opts.now ?? new Date();
  const code = folioCodeFor(typeReservation);
  const prefix = `${code}${padProperty(propertyId)}${ymStamp(now)}`;
  const seriesType = String(typeReservation).toLowerCase() === 'day-use' ? 'fit' : typeReservation;

  const last = await client.folios.findFirst({
    where: {
      folio_number: { startsWith: prefix },
      parent: 0,
      ...(seriesType ? { type_reservation: seriesType } : {}),
    },
    orderBy: { folio_number: 'desc' },
    select: { folio_number: true },
  });

  return folioNumberFormat(code, last?.folio_number, propertyId, now);
}

/**
 * Assign a folio number to a freshly created folio, retrying on the unique index.
 *
 * `folios.folio_number` has a UNIQUE btree index, so two booking-engine requests that
 * read the same "last folio" cannot both insert the same number — the second one hits
 * P2002 and we recompute. The reference has the same read-then-increment race inside a
 * request-scoped transaction; without the retry the loser would surface to the guest as
 * a 500 on an otherwise successful payment.
 */
export async function assignFolioNumber(
  client: any,
  folioId: number | bigint | string,
  opts: { propertyId: number | bigint | string; typeReservation: string; attempts?: number }
): Promise<string | null> {
  const attempts = opts.attempts ?? 5;
  for (let i = 0; i < attempts; i++) {
    const folioNumber = await generateFolioNumber(client, {
      propertyId: opts.propertyId,
      typeReservation: opts.typeReservation,
    });
    try {
      await client.folios.update({ where: { id: folioId }, data: { folio_number: folioNumber } });
      return folioNumber;
    } catch (err: any) {
      const isUniqueViolation = err?.code === 'P2002' || /folio_number|duplicate key/i.test(String(err?.message ?? ''));
      if (!isUniqueViolation) throw err;
      console.warn(
        `[folioNumber] ${folioNumber} already taken for folio ${folioId}, recomputing (attempt ${i + 2}/${attempts})`
      );
    }
  }
  console.error(`[folioNumber] gave up after ${attempts} attempts on folio ${folioId}`);
  return null;
}