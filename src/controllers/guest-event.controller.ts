import { Request, Response } from 'express';
import {
  GuestEvent,
  GuestEventType,
  guestSubscriberCount,
  notifyPaymentConfirmed,
  normalizeGuestEmail,
  subscribeGuestEmail,
} from '../services/guestEvents.service';
import { issuePreRegistrationLink } from '../services/preRegistrationLink.service';
import { prisma } from '../config/prisma';

/**
 * Realtime guest notifications.
 *
 * Three endpoints, all under the public `/middleware` prefix that the booking engine
 * already talks to:
 *
 *   GET  /middleware/guest/stream?email=…   SSE. The guest's browser holds it open.
 *   POST /middleware/guest/notify          the booking engine pushes an event.
 *   GET  /middleware/guest/events?email=…  replay, for a client that just reconnected.
 *
 * ## Why the stream is public and keyed on email
 *
 * The booking engine authenticates its own `users` table and has no HMS session to
 * forward, which is why `GuestNotificationController` is also keyed on email. This is no
 * looser: `EventSource` cannot set an `Authorization` header at all, so any authenticated
 * variant would need the credential in the query string, where it lands in access logs and
 * every proxy in between.
 *
 * The exposure is bounded by what the bus carries. Events hold a folio number, a property
 * name, dates, and a pre-registration link — the same thin shape
 * `GuestNotificationController` returns, and it needs an email address to guess. No
 * balances, no amounts, no profile fields.
 *
 * ## Why replay exists even though the bus is in-memory
 *
 * A bus that is empty on boot is fine for a *nudge* channel but useless as the only way
 * to learn about a stay. `EventSource` reconnects on its own, and the reconnect lands
 * after the event that caused the drop, so the guest would never hear about it. The SSE
 * handler therefore sends the current state on connect, and `/guest/events` exposes the
 * same payload for clients that cannot hold a stream at all (a corporate proxy stripping
 * `text/event-stream`, or `prefers-reduced-motion` clients we do not want pushing audio
 * at unprompted).
 */

/** Comment frames keep proxies from reaping an idle connection. 25s is under the usual 30s. */
const HEARTBEAT_MS = 25000;

/**
 * A stream held open forever would accumulate on a client that vanished without sending
 * FIN (a phone losing signal). The cap is generous for a browser tab and small enough
 * that a leaked socket cannot pin memory.
 */
const MAX_STREAM_MS = 30 * 60 * 1000;

export class GuestEventController {
  /**
   * GET /middleware/guest/stream?email=…
   *
   * Server-sent events. Three frame types reach the browser:
   *
   *   `ready`     once, after headers, so the client can stop its fallback timer
   *   `state`     the guest's full stay list — sent on connect and after every event
   *   `guest`     one event, so the toast can be raised without re-reading the list
   *   `: ping`    comment frame, invisible to `addEventListener`
   */
  static async stream(req: Request, res: Response): Promise<void> {
    const email = normalizeGuestEmail(req.query.email);
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
      res.status(400).json({ code: 400, message: 'The email field is required.' });
      return;
    }

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    // Nginx buffers proxied responses by default, which turns a live stream into one
    // large response delivered whenever the buffer happens to fill. This is the header
    // that prevents that, and the production deploy sits behind Nginx.
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const send = (event: string, data: unknown, id?: string): void => {
      if (res.writableEnded) return;
      if (id) res.write(`id: ${id}\n`);
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    send('ready', { at: new Date().toISOString() });

    // The current state first, so a client that reconnects after missing an event still
    // converges. A failure here must not close the stream — the bus is the live part and
    // the next event will carry a fresh list too.
    try {
      send('state', await GuestEventController.currentState(email));
    } catch (err: any) {
      console.error('[GuestEventController] initial state failed:', err?.message);
    }

    const unsubscribe = subscribeGuestEmail(email, (event: GuestEvent) => {
      send('guest', event, event.at);
      // Re-read rather than mutating the pushed payload. The event carries the link for
      // one folio; the list carries every stay, and a guest with two open stays needs
      // both badges correct.
      void GuestEventController.currentState(email)
        .then((state) => send('state', state))
        .catch(() => undefined);
    });

    const heartbeat = setInterval(() => {
      if (res.writableEnded) return;
      res.write(': ping\n\n');
    }, HEARTBEAT_MS);

    const close = (): void => {
      clearInterval(heartbeat);
      unsubscribe();
    };

    req.on('close', close);
    req.on('error', close);
    // `finish` fires when the response is flushed to the socket, which for a stream is
    // on teardown. Safe to double-register because `close` is idempotent by way of
    // `unsubscribe`.
    res.on('close', close);

    const cap = setTimeout(() => {
      // Tell the client why so it reconnects immediately instead of waiting out the
      // browser's own retry backoff, which starts around 3s and grows.
      send('bye', { reason: 'max_duration', at: new Date().toISOString() });
      close();
      res.end();
    }, MAX_STREAM_MS);

    const clearCap = (): void => clearTimeout(cap);
    req.on('close', clearCap);
    res.on('close', clearCap);
  }

  /**
   * GET /middleware/guest/events?email=…
   *
   * One-shot read of the same payload the stream sends. This is the path for a client
   * that cannot hold a connection, and it is deliberately the same shape so
   * `useGuestNotifications` has one reducer rather than two.
   */
  static async list(req: Request, res: Response): Promise<void> {
    const email = normalizeGuestEmail(req.query.email);
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
      res.status(400).json({ code: 400, message: 'The email field is required.' });
      return;
    }
    try {
      res.json({ code: 200, message: 'Success', data: await GuestEventController.currentState(email) });
    } catch (err: any) {
      console.error('[GuestEventController] list failed:', err?.message);
      res.status(500).json({ code: 500, message: 'Failed to load notifications' });
    }
  }

  /**
   * POST /middleware/guest/notify
   *
   * The inbound half of the webhook. The booking engine calls this when it learns
   * something the guest should see — today that means the invoice came back paid, so the
   * guest is told without waiting for HMS's next queue run.
   *
   * `resolve_pre_registration` is the interesting flag. When set, the folio is looked up
   * and a pre-registration link minted server-side, so the notification always carries
   * something to act on. Without it the event is a bare ping, which is only useful for
   * flows that already hold their own link.
   */
  static async notify(req: Request, res: Response): Promise<void> {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const type = String(body.type ?? 'reservation.updated') as GuestEventType;

    // Either the caller names the guest, or it names the folio and we look it up. The
    // folio is the better key: it is what the booking engine has in hand at the moment
    // the payment settles, and the guest's email may be spelled differently there than in
    // HMS (uppercase, trailing space — 21,552 stored addresses look like that).
    let email = normalizeGuestEmail(body.email);
    let folio: any = null;

    const folioRef = String(body.booking_engine_uuid ?? body.folio_number ?? '').trim();
    if (!email && folioRef) {
      folio = await GuestEventController.findFolio(folioRef);
      email = normalizeGuestEmail(folio?.email);
    }

    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
      // 400 rather than a silent 200: a webhook that cannot address anyone has a bug, and
      // a 2xx would teach the sender it was delivered.
      res.status(400).json({
        code: 400,
        message: 'Could not resolve a guest email for this notification.',
      });
      return;
    }

    if (!folio && folioRef) {
      folio = await GuestEventController.findFolio(folioRef);
    }

    let preRegistrationUrl: string | null = null;
    if (body.resolve_pre_registration !== false) {
      try {
        // Reuse the folio the notify already carries when it has the columns, otherwise
        // reload it. `issuePreRegistrationLink` reuses a live token rather than minting,
        // so calling it here cannot invalidate the link in the confirmation mail.
        const subject = folio ?? (await GuestEventController.findFolio(folioRef));
        if (subject) {
          const slug = (subject as any).properties?.slug ?? null;
          const link = await issuePreRegistrationLink(subject, slug);
          preRegistrationUrl = link?.url ?? null;
        }
      } catch (err: any) {
        // Never let link minting cost the guest the notification itself.
        console.error('[GuestEventController] pre-registration link failed:', err?.message);
      }
    }

    const reached = await notifyPaymentConfirmed({
      email,
      folioNumber: (body.folio_number ?? folio?.folio_number ?? null) as string | null,
      propertyName: (body.property_name ?? folio?.properties?.name ?? null) as string | null,
      checkInDate: (body.check_in_date ?? folio?.check_in_date ?? null) as string | null,
      checkOutDate: (body.check_out_date ?? folio?.check_out_date ?? null) as string | null,
      preRegistrationUrl,
    });

    // `reached: 0` is the normal case for a guest with no tab open, and it must not be an
    // error — the durable record is the folio, and their next poll finds it.
    res.json({
      code: 200,
      message: 'Success',
      data: { delivered_to: reached, pre_registration_url: preRegistrationUrl },
    });
  }

  /**
   * The guest's stays, in the exact shape `GuestNotificationController` returns.
   *
   * Kept as a delegate rather than a second query so the SSE payload, the poll fallback,
   * and the bell can never disagree about what a stay looks like.
   */
  private static async currentState(email: string): Promise<unknown> {
    const { GuestNotificationController } = await import('./guest-notification.controller');
    return GuestNotificationController.stateForEmail(email);
  }

  /** Look up a folio by its booking-engine uuid, falling back to the folio number. */
  private static async findFolio(ref: string): Promise<any | null> {
    if (!ref) return null;
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(ref);
    try {
      const where = isUuid
        ? { booking_engine_uuid: ref, deleted_at: null }
        : { folio_number: ref, deleted_at: null };
      const folio = await prisma.folios.findFirst({
        where,
        select: {
          id: true,
          folio_number: true,
          booking_no: true,
          booking_engine_uuid: true,
          email: true,
          check_in_date: true,
          check_out_date: true,
          pre_registration_token: true,
          pre_registration_expires_at: true,
          pre_registration_completed_at: true,
          properties: { select: { name: true, slug: true } },
        },
      });
      return folio ?? null;
    } catch (err: any) {
      console.error('[GuestEventController] folio lookup failed for', ref, err?.message);
      return null;
    }
  }

  /** Diagnostic only — how many tabs this guest has open. */
  static subscribers(email: string): number {
    return guestSubscriberCount(email);
  }
}