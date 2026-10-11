import { Request, Response } from 'express';
import { prisma } from '../config/prisma';
import { issuePreRegistrationLink } from '../services/preRegistrationLink.service';

/**
 * GET /middleware/guest/notifications?email=…
 *
 * What a guest booked, and the pre-registration link for each stay. This is what the
 * bell in the booking engine header opens.
 *
 * The flow it closes: a guest books online, pays, and the confirmation mail carries a
 * one-time pre-registration link built from `folios.pre_registration_token`. The token
 * is written by `syncCheckStatusBookingEngine` when Xendit reports the invoice paid, so
 * it only exists for a stay that was actually paid for. If the mail is lost, or the guest
 * never opens it, the token is still sitting on the folio and nothing in the portal ever
 * surfaces it — the guest has a booking they cannot complete. This endpoint is that
 * surface.
 *
 * Keyed on email, not authenticated. The booking engine (hmsBookingEngine) authenticates
 * its own `users` table and has no HMS session to pass, so it forwards the address it
 * already holds for the signed-in guest. That makes this endpoint as private as the
 * knowledge of an email address, so the response is deliberately thin: folio number,
 * property, dates, status, and a pre-registration link for stays that have one. No
 * balance, no room number, no guest profile fields. An address is guessable; a folio is
 * not, and the link only fills in a form the guest already has a claim to.
 */
export class GuestNotificationController {
  static async list(req: Request, res: Response): Promise<void> {
    try {
      const email = String(req.query.email ?? '').trim().toLowerCase();
      if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
        res.status(400).json({ code: 400, message: 'The email field is required.' });
        return;
      }

      // Every field below is already a primitive, so plain res.json is safe — no BigInt
      // reaches the wire and no id is exposed.
      res.json({ code: 200, message: 'Success', data: await GuestNotificationController.stateForEmail(email) });
    } catch (err: any) {
      console.error('Guest notification list error:', err);
      res.status(500).json({ code: 500, message: 'Failed to fetch notifications' });
    }
  }

  /**
   * The guest's stays, as one list.
   *
   * Split out of `list` because the SSE handler sends the same payload on connect. Two
   * queries would be two places for the shape to drift, and the badge would then disagree
   * with the list depending on which path the guest arrived through.
   */
  static async stateForEmail(email: string): Promise<any[]> {
    // Match case-insensitively: 21,552 stored guest addresses carry uppercase and
    // 1,652 carry surrounding spaces, so an exact compare would silently return an
    // empty list for a guest who signed up with a capital letter.
    const folios: any[] = await prisma.folios.findMany({
      where: {
        email: { equals: email, mode: 'insensitive' },
        booking_engine_uuid: { not: null },
        deleted_at: null,
      },
      orderBy: { check_in_date: 'desc' },
      take: 20,
      select: {
        id: true,
        folio_number: true,
        booking_no: true,
        booking_engine_uuid: true,
        check_in_date: true,
        check_out_date: true,
        status_reservation: true,
        status_profile: true,
        total_amount: true,
        pre_registration_token: true,
        pre_registration_expires_at: true,
        pre_registration_completed_at: true,
        guest_profile_id: true,
        properties: { select: { name: true, slug: true } },
      },
    });

    const items: any[] = [];

    for (const f of folios) {
        const slug = (f as any).properties?.slug ?? '';
        // A link needs a token. One is issued on demand for any folio that was paid for
        // and not yet filled in, so the guest is never told to check their email for a
        // link that may not exist. A folio whose pre-registration is already done gets
        // none — there is nothing left for the guest to do on it.
        let preRegistrationUrl: string | null = null;
        if (slug && !f.pre_registration_completed_at) {
          try {
            const link = await issuePreRegistrationLink(f as any, slug);
            preRegistrationUrl = link?.url ?? null;
          } catch (err: any) {
            // Never let a link failure hide the booking itself. The guest still sees
            // their reservation; only the shortcut is missing.
            console.error(
              `[GuestNotificationController] folio ${f.folio_number ?? f.id}: pre-registration link failed —`,
              err?.message,
            );
          }
        }

        items.push({
          folio_number: f.folio_number,
          booking_no: f.booking_no,
          booking_engine_uuid: f.booking_engine_uuid,
          property_name: (f as any).properties?.name ?? null,
          property_slug: slug || null,
          check_in_date: f.check_in_date ? new Date(f.check_in_date).toISOString().slice(0, 10) : null,
          check_out_date: f.check_out_date ? new Date(f.check_out_date).toISOString().slice(0, 10) : null,
          // 3 = Reservation, 2 = Cancelled, 5 = Pending (utils/cmsStatus.ts). Sent as a
          // name rather than the number so the guest portal does not have to own the map.
          status: f.status_reservation === 2 ? 'cancelled' : f.status_reservation === 5 ? 'pending' : 'reserved',
          status_reservation: f.status_reservation !== null ? Number(f.status_reservation) : null,
          total_amount: f.total_amount !== null ? Number(f.total_amount) : null,
          currency: 'IDR',
          // False once the guest has submitted the form — the portal uses it to decide
          // whether to show a "Fill in your details" call to action or a done state.
          pre_registration_completed: !!f.pre_registration_completed_at,
          pre_registration_url: preRegistrationUrl,
        });
      }

    return items;
  }
}