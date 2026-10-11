import { EventEmitter } from 'events';

/**
 * Guest realtime event bus.
 *
 * What this closes: a guest finishes paying, Xendit returns them to the hotel page, and
 * the one thing left to do — fill in their details for the pre-registration form — is
 * behind a bell they have to notice and click. Before this, the only signal was a 45s
 * poll of `GET /middleware/guest/notifications`.
 *
 * Two producers push onto this bus:
 *
 *   - `syncCheckStatusBookingEngine` / `reconcileBookingEnginePayments`, when Xendit
 *     reports an invoice paid and the folio is booked. This is the authoritative path:
 *     HMS owns the folio and owns the pre-registration token.
 *   - `POST /middleware/guest/notify` from the booking engine, so the webhook runs in
 *     both directions rather than depending on the queue job's schedule.
 *
 * ## Why this lives in Node and not in the booking engine
 *
 * Server-sent events hold a request open for as long as the browser keeps the
 * connection. `php artisan serve` is PHP's built-in server, which handles one request at
 * a time, and `PHP_CLI_SERVER_WORKERS` is not set on this deployment — so a single open
 * `EventSource` against the Laravel API would park that one worker until the guest closed
 * the tab, and every other API call would queue behind it: the search page would stop
 * loading rooms. Node handles concurrent connections natively, so the stream lives on
 * port 3001 and the guest browser talks to it directly.
 *
 * ## Deliberately in-memory
 *
 * This is a nudge channel, not a queue. A missed event costs the guest one poll interval
 * of latency, because `useGuestNotifications` still polls as a fallback and the list it
 * renders comes from the database either way. That is why there is no delivery
 * acknowledgement and no replay: the durable record is `folios`, not this bus. Events are
 * also broadcast rather than queued per-recipient, so a guest with three tabs open sees
 * the same notification in all three — a per-connection queue would deliver it once and
 * make the other two tabs silently stale.
 */

/** Fan-out registry. Keyed by normalised email; one Set of subscribers per guest. */
const bus = new EventEmitter();

// One subscriber set per email address. At the scale this runs at (a property's
// live guests) the default limit of 10 listeners is never approached, but a long-lived
// dev process with reconnects could reach it, and the warning it prints is noise.
bus.setMaxListeners(0);

export type GuestEventType =
  | 'payment.confirmed'
  | 'pre_register.ready'
  | 'pre_register.completed'
  | 'reservation.updated'
  | 'reward.redeemed';

export interface GuestEvent {
  type: GuestEventType;
  /** Lowercased + trimmed. The one field that decides who receives this. */
  email: string;
  /** ISO timestamp the event was raised, not when it was received. */
  at: string;
  /** Short human-readable headline, already localised by the caller if it cares. */
  title?: string;
  /** One sentence of detail for the toast body. */
  message?: string;
  /** Deep link — the guest is expected to act on this. */
  url?: string;
  folio_number?: string | null;
  property_name?: string | null;
  check_in_date?: string | null;
  check_out_date?: string | null;
  /** Free-form extras. Never put profile fields or amounts in here. */
  data?: Record<string, unknown>;
}

/**
 * Gmail dots and case do not matter to delivery but do matter to storage — the folio
 * table holds uppercase addresses with surrounding spaces. Two subscribers for the same
 * person is a duplicated toast, so the key is normalised once, here, rather than at each
 * call site.
 */
export function normalizeGuestEmail(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase();
}

const isEmail = (value: string): boolean => /^\S+@\S+\.\S+$/.test(value);

/**
 * Publishes an event to every open connection for that guest.
 *
 * Returns the number of connections reached, which is only useful for logging: a return
 * of 0 is normal, not an error. It means nobody is watching right now, and the next poll
 * will pick the change up from the database.
 */
export function publishGuestEvent(event: Partial<GuestEvent> & { email: string; type: GuestEventType }): number {
  const email = normalizeGuestEmail(event.email);
  if (!isEmail(email)) {
    console.warn('[guestEvents] dropped event with unusable email:', event.email);
    return 0;
  }

  const payload: GuestEvent = {
    type: event.type,
    email,
    at: event.at ?? new Date().toISOString(),
    title: event.title,
    message: event.message,
    url: event.url,
    folio_number: event.folio_number ?? null,
    property_name: event.property_name ?? null,
    check_in_date: event.check_in_date ?? null,
    check_out_date: event.check_out_date ?? null,
    data: event.data,
  };

  // `rawListeners` rather than `listeners`: the Set wrapper installed by `subscribe` is a
  // plain function, so both work, but raw keeps this independent of how it was added.
  const listeners = bus.rawListeners(email) as Array<(e: GuestEvent) => void>;
  let delivered = 0;
  for (const fn of listeners) {
    try {
      fn(payload);
      delivered += 1;
    } catch (err: any) {
      // A dead connection must not stop the other tabs from being told.
      console.error('[guestEvents] subscriber threw:', err?.message ?? err);
    }
  }
  return delivered;
}

/**
 * Subscribes one connection. The returned function unsubscribes and is safe to call
 * more than once — an SSE `close` event and an `error` event both fire on a dropped
 * connection, and double-removal must not throw.
 */
export function subscribeGuestEmail(
  email: string,
  handler: (event: GuestEvent) => void
): () => void {
  const key = normalizeGuestEmail(email);
  if (!isEmail(key)) return () => undefined;

  let removed = false;
  bus.on(key, handler);

  return () => {
    if (removed) return;
    removed = true;
    bus.off(key, handler);
  };
}

/** Open connection count for one guest. Used by the SSE endpoint's keep-alive comment. */
export function guestSubscriberCount(email: string): number {
  return bus.listenerCount(normalizeGuestEmail(email));
}

/**
 * The event a paid booking raises.
 *
 * Built in one place because the two producers otherwise drift: one says "payment
 * received", the other "fill in your details", and the guest sees whichever fired last.
 * The pre-registration link is the payload — without it the notification is an
 * announcement with nothing to act on.
 */
export async function notifyPaymentConfirmed(params: {
  email?: string | null;
  folioNumber?: string | null;
  propertyName?: string | null;
  checkInDate?: string | Date | null;
  checkOutDate?: string | Date | null;
  preRegistrationUrl?: string | null;
}): Promise<number> {
  const email = normalizeGuestEmail(params.email);
  if (!email) {
    console.warn('[guestEvents] payment confirmation had no guest email — folio', params.folioNumber);
    return 0;
  }

  const iso = (v: string | Date | null | undefined): string | null => {
    if (!v) return null;
    const d = v instanceof Date ? v : new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  };

  return publishGuestEvent({
    type: 'payment.confirmed',
    email,
    title: params.propertyName ? `Payment received at ${params.propertyName}` : 'Payment received',
    message: params.preRegistrationUrl
      ? 'Fill in your guest details so the hotel can prepare for your stay.'
      : 'Your booking is confirmed.',
    url: params.preRegistrationUrl ?? undefined,
    folio_number: params.folioNumber ?? null,
    property_name: params.propertyName ?? null,
    check_in_date: iso(params.checkInDate),
    check_out_date: iso(params.checkOutDate),
  });
}