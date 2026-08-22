// Reservation per-night pricing engine — port of Laravel Folio::saveReservation
// rate lookup + occupancy formula + promo resolution + CodePost.calculate (Folio.php:2374-2489).
import { PrismaClient } from '@prisma/client';
import { calculateCodePost } from './cmsConfig';

export interface PromoLike {
  promotion_type: string | null;
  discount_percentage: number | null;
  discount_flat: number | null;
}

// Folio.php:2415-2421 — posting path enforces min/max night + stop_sell.
// Preview path (getReservation :2263-2268) omits min/max filters.
export async function lookupRateRate(
  prisma: PrismaClient,
  rateId: bigint,
  roomTypeId: bigint,
  night: Date,
  getNight: number,
  enforceMinMax = true
): Promise<any | null> {
  const where: any = {
    rate_id: rateId,
    room_type_id: roomTypeId,
    deleted_at: null,
    date: { gte: startOfDay(night), lt: addDays(startOfDay(night), 1) },
  };
  if (enforceMinMax) {
    where.min_night = { lte: getNight };
    where.max_night = { gte: getNight };
    where.stop_sell = 0;
  }
  const rows = await prisma.rate_rates.findMany({ where, take: 2 });
  return rows[0] ?? null;
}

// Fallback (Folio.php:2423-2426): room type's flat rate.
export async function fallbackRoomTypePrice(prisma: PrismaClient, roomTypeId: bigint): Promise<number> {
  const rt = await prisma.room_types.findUnique({ where: { id: roomTypeId }, select: { rate: true } });
  return Number((rt as any)?.rate ?? 0);
}

// Folio.php:2428-2451 — one_adult/two_adult mutually exclusive; extra adult beyond 2nd; child additive.
export function occupancyPrice(rr: any, adult: number, child: number): number {
  let sum = 0;
  if (adult === 1) sum += Number(rr.one_adult ?? 0);
  if (adult > 1) sum += Number(rr.two_adult ?? 0);
  if (adult > 2) sum += (adult - 2) * Number(rr.extra_adult ?? 0);
  if (child > 0) sum += child * Number(rr.extra_child ?? 0);
  return sum;
}

// Folio.php:2465-2484 — per-night promo lookup via model_has_promotions (model_type 'model' morph).
export async function findPromosForNight(
  prisma: PrismaClient,
  rateId: bigint | null,
  night: Date,
  getNight: number,
  promoCode: string
): Promise<PromoLike[]> {
  if (!promoCode || !rateId) return [];
  const links = await prisma.model_has_promotions.findMany({
    where: { model_id: rateId },
    select: { promotion_id: true },
  });
  if (links.length === 0) return [];
  const promos = await prisma.promotions.findMany({
    where: {
      id: { in: links.map((l: any) => l.promotion_id) },
      status: 1,
      deleted_at: null,
      promotion_code: promoCode,
      from_stay_date: { lte: night },
      to_stay_date: { gte: night },
      min_night: { lte: getNight },
    },
  });
  return promos as PromoLike[];
}

// CodePost.php:68-76 / 135-143 — promo discounts applied to amount BEFORE tax/service calc.
export function applyPromoDiscounts(amount: number, promos: PromoLike[]): number {
  let discounted = amount;
  for (const p of promos) {
    if (!p) continue;
    if (p.promotion_type === 'percentage') {
      discounted -= discounted * (Number(p.discount_percentage ?? 0) / 100);
    } else {
      discounted -= Number(p.discount_flat ?? 0);
    }
  }
  return discounted;
}

export interface NightPricing {
  amount: number;
  service_charge: number;
  pb1: number;
  tax3: number;
  total: number;
  rate_price: number; // pre-tax net after promo (calc.amount)
  source: 'rate_rates' | 'room_type_fallback';
}

export async function priceNight(opts: {
  prisma: PrismaClient;
  rateId: bigint | null;
  roomTypeId: bigint | null;
  night: Date;
  getNight: number;
  adult: number;
  child: number;
  quantity?: number; // day-use multiplier (Folio.php:2446-2448)
  isTax: boolean;
  rateCodePost: any; // rate.code_post relation row or null
  promos: PromoLike[];
}): Promise<NightPricing> {
  const {
    prisma, rateId, roomTypeId, night, getNight, adult, child, quantity = 1, isTax, rateCodePost, promos,
  } = opts;

  let base = 0;
  let source: 'rate_rates' | 'room_type_fallback' = 'room_type_fallback';
  if (rateId && roomTypeId) {
    const rr = await lookupRateRate(prisma, rateId, roomTypeId, night, getNight);
    if (rr) {
      base = occupancyPrice(rr, adult, child);
      source = 'rate_rates';
    } else {
      base = await fallbackRoomTypePrice(prisma, roomTypeId);
    }
  } else if (roomTypeId) {
    base = await fallbackRoomTypePrice(prisma, roomTypeId);
  }

  // Day-use quantity multiply happens before discount/tax (Folio.php:2446-2448).
  const gross = base * quantity;

  const discounted = applyPromoDiscounts(gross, promos);

  const flags = rateCodePost
    ? {
        tax: rateCodePost.tax ?? false,
        tax_percentage: rateCodePost.tax_percentage ? Number(rateCodePost.tax_percentage) : 0,
        local_tax: rateCodePost.local_tax ?? false,
        local_tax_percentage: rateCodePost.local_tax_percentage ? Number(rateCodePost.local_tax_percentage) : 0,
        service_charge: rateCodePost.service_charge ?? false,
        service_charge_percentage: rateCodePost.service_charge_percentage ? Number(rateCodePost.service_charge_percentage) : 0,
        service_charge_include_local_tax: rateCodePost.service_charge_include_local_tax ?? false,
        tax_include_local_tax: rateCodePost.tax_include_local_tax ?? false,
      }
    : null;

  const calc = flags
    ? calculateCodePost(flags as any, discounted, isTax)
    : { amount: discounted, service: 0, pb1: 0, tax3: 0, total: discounted };

  return {
    amount: calc.amount,
    service_charge: calc.service,
    pb1: calc.pb1,
    tax3: calc.tax3,
    total: calc.total,
    rate_price: calc.amount,
    source,
  };
}

export function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function addDays(d: Date, days: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}
