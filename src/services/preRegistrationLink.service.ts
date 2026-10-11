import crypto from 'crypto';
import { prisma } from '../config/prisma';

/**
 * Pre-registration links for online guests.
 *
 * The columns this writes — `pre_registration_token`, `pre_registration_expires_at` —
 * were read and enforced by `PreRegistrationController::findFolio` from the start, but
 * nothing in the codebase ever produced them. Not the Laravel reference either: grepping
 * `hmsBackend/hms-backend/app` for `pre_registration_token` turns up only the verify and
 * complete handlers. So the `?folio=…&token=…` auto-verify branch that already exists in
 * the guest portal (`pre-register.tsx`, `autoVerify`) was unreachable — there was no
 * producer for the token it consumes.
 *
 * This is that producer. It is deliberately a service and not part of the job: the link
 * is worth issuing from more than one place (payment confirmation today, a front-desk
 * "send the guest their form" action tomorrow), and every caller needs the same
 * expiry + URL rules.
 *
 * The guest opens the link, the portal calls `/middleware/pre-registration/verify` with
 * the folio number and token, fills the form, and `/middleware/pre-registration/complete`
 * writes the guest data onto the folio and its guest profile.
 */

/** How long a link stays usable. Override with PRE_REGISTRATION_TOKEN_TTL_DAYS. */
export function preRegistrationTtlDays(): number {
  const raw = Number(process.env.PRE_REGISTRATION_TOKEN_TTL_DAYS ?? 30);
  return Number.isFinite(raw) && raw > 0 ? raw : 30;
}

/**
 * Where the guest portal lives.
 *
 * `BOOKING_ENGINE_FRONTEND_URL` is the frontend origin (3002 locally). The fallback to
 * `BOOKING_ENGINE_URL` is wrong in principle — that env points at the Laravel API
 * (8001), which serves no pages — so it warns loudly instead of quietly building a link
 * that 404s on the guest's phone.
 */
export function bookingEngineFrontendUrl(): string {
  const explicit =
    process.env.BOOKING_ENGINE_FRONTEND_URL || process.env.NEXT_PUBLIC_BOOKING_ENGINE_URL;
  if (explicit) return String(explicit).replace(/\/+$/, '');

  const apiFallback = process.env.BOOKING_ENGINE_URL || '';
  if (apiFallback) {
    console.warn(
      '[preRegistrationLink] BOOKING_ENGINE_FRONTEND_URL is not set; falling back to ' +
        `BOOKING_ENGINE_URL (${apiFallback}), which is the API origin. ` +
        'Pre-registration links will point at the wrong host.'
    );
  }
  return String(apiFallback).replace(/\/+$/, '');
}

export interface PreRegistrationLink {
  folioId: string;
  folioNumber: string;
  token: string;
  expiresAt: Date;
  url: string;
}

/**
 * Mint (or re-mint) the token for a folio and build the guest URL.
 *
 * A live, unexpired token is REUSED rather than replaced. Re-minting is safe from the
 * guest's point of view when it happens once, but it invalidates the previous link: a
 * guest who already has the link from their confirmation mail would find it dead the
 * moment they opened the notification bell, because the bell mints again. So the token
 * is written only when there isn't a usable one, and re-minting stays available for the
 * case it exists for — a booking amended after the confirmation mail went out.
 *
 * Re-issuing for a folio that has already been filled in is refused, because the guest
 * has nothing left to do and a live link would let anyone who saw the email edit their
 * identity record.
 */
export async function issuePreRegistrationLink(
  folio: {
    id: number | bigint | string;
    folio_number?: string | null;
    pre_registration_token?: string | null;
    pre_registration_expires_at?: Date | null;
    pre_registration_completed_at?: Date | null;
  },
  propertySlug?: string | null
): Promise<PreRegistrationLink | null> {
  const folioNumber = String(folio.folio_number ?? '').trim();
  if (!folioNumber) {
    console.warn(`[preRegistrationLink] folio ${folio.id} has no folio_number, cannot build a link`);
    return null;
  }
  if (folio.pre_registration_completed_at) {
    console.log(`[preRegistrationLink] folio ${folioNumber} already pre-registered, no link issued`);
    return null;
  }

  const slug = propertySlug || (await propertySlugForFolio(folio.id));
  if (!slug) {
    console.warn(`[preRegistrationLink] folio ${folioNumber} has no property slug, cannot build a link`);
    return null;
  }

  const base = bookingEngineFrontendUrl();
  const path = `/${slug}/pre-register`;
  const buildUrl = (token: string): string =>
    base
      ? `${base}${path}?folio=${encodeURIComponent(folioNumber)}&token=${encodeURIComponent(token)}`
      : `${path}?folio=${encodeURIComponent(folioNumber)}&token=${encodeURIComponent(token)}`;

  const existingToken = String(folio.pre_registration_token ?? '').trim();
  const existingExpiry = folio.pre_registration_expires_at
    ? new Date(folio.pre_registration_expires_at).getTime()
    : 0;
  if (existingToken && existingExpiry > Date.now()) {
    return {
      folioId: String(folio.id),
      folioNumber,
      token: existingToken,
      expiresAt: new Date(existingExpiry),
      url: buildUrl(existingToken),
    };
  }

  const token = crypto.randomBytes(32).toString('hex');
  const ttlDays = preRegistrationTtlDays();
  const expiresAt = new Date(Date.now() + ttlDays * 86400000);
  const folioId: any = folio.id;

  await prisma.folios.update({
    where: { id: folioId },
    data: { pre_registration_token: token, pre_registration_expires_at: expiresAt },
  });

  return { folioId: String(folio.id), folioNumber, token, expiresAt, url: buildUrl(token) };
}

async function propertySlugForFolio(folioId: number | bigint | string): Promise<string | null> {
  const row: any = await prisma.folios.findUnique({
    where: { id: folioId as any },
    select: { properties: { select: { slug: true } } },
  });
  return row?.properties?.slug ?? null;
}

/**
 * Issue links for every folio in a set, skipping the ones that cannot take one.
 * Never throws: a failure to build a link must not fail the payment that triggered it.
 */
export async function issuePreRegistrationLinks(
  folios: Array<{
    id: number | bigint | string;
    folio_number?: string | null;
    pre_registration_completed_at?: Date | null;
  }>,
  propertySlug?: string | null
): Promise<PreRegistrationLink[]> {
  const out: PreRegistrationLink[] = [];
  for (const folio of folios) {
    try {
      const link = await issuePreRegistrationLink(folio, propertySlug);
      if (link) out.push(link);
    } catch (err: any) {
      console.error(
        `[preRegistrationLink] folio ${folio.id} failed: ${err?.message ?? err}`
      );
    }
  }
  return out;
}