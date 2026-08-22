import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { success, error, badRequest, notFound, validationError } from '../utils/response';
import { getPermissionFlags } from '../middleware/permission.middleware';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// ─────────────────────────────────────────────────────────────────────────────
// Dynamic Rate engine — Laravel app/Services/DynamicRateService.php parity.
// Port penuh: reservation history (ADR + occupancy), blend tahun lalu 0.6/0.4,
// seasonality dari data (monthly + dow), 5 metode forecast, confidence,
// apply dengan original recording, disable restore. Tanpa Math.random().
// ─────────────────────────────────────────────────────────────────────────────

const DOW_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const fmtDate = (d: Date) => d.toISOString().slice(0, 10);

function addDaysStr(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return fmtDate(d);
}

function dateRangeList(startStr: string, endStr: string): string[] {
  const out: string[] = [];
  for (let s = startStr; s <= endStr; s = addDaysStr(s, 1)) {
    out.push(s);
    if (out.length > 400) break;
  }
  return out;
}

// Laravel getValueRate-like transform for cascade rules is not used here.

async function countActiveRooms(propertyId: bigint, roomTypeId?: bigint): Promise<number> {
  return prisma.rooms.count({
    where: { property_id: propertyId, status: 1, deleted_at: null, ...(roomTypeId ? { room_type_id: roomTypeId } : {}) },
  });
}

// Laravel fetchHistoricalData — ADR & occupancy per (date|room_type) from
// reservations (excl cancel/pending folios, house use, complimentary, company
// house-use/compliment rates) minus inclusive items and extra beds.
async function fetchHistoricalData(propertyId: bigint, startStr: string, endStr: string): Promise<Map<string, any>> {
  const history = new Map<string, any>();
  if (!startStr || !endStr || startStr > endStr) return history;

  const reservations = await prisma.reservations.findMany({
    where: {
      property_id: propertyId,
      date: { gte: new Date(`${startStr}T00:00:00Z`), lte: new Date(`${endStr}T23:59:59Z`) },
      deleted_at: null,
      folios: {
        is: {
          status_reservation: { notIn: [2, 5] }, // cancel, pending
          is_house_use: false,
          complimentary: false,
          deleted_at: null,
        },
      },
    },
    select: {
      id: true, date: true, room_type_id: true, room_id: true, rate_id: true,
      total: true, total_extra_bed: true, adult: true, child: true,
      folios: { select: { status_reservation: true } },
    },
  });

  // Filter company house-use/compliment rates: rate's types group company-type with
  // name like compliment/house use.
  const rateIds = [...new Set(reservations.map((r) => r.rate_id).filter((v): v is bigint => v !== null))];
  let badRateIds = new Set<number>();
  if (rateIds.length) {
    const typeLinks = await prisma.model_has_types.findMany({
      where: { model_id: { in: rateIds }, model_type: 'App\\Models\\Rate' },
      select: { model_id: true, types: { select: { group: true, name: true } } },
    });
    for (const link of typeLinks) {
      const t: any = link.types;
      if (t && t.group === 'company-type' && /compliment|house use/i.test(t.name ?? '')) {
        badRateIds.add(Number(link.model_id));
      }
    }
  }

  // Inclusive items per rate: cost breakdown by codePost name keyword + calculator.
  // Laravel quirk: RateInclusive::codeItem belongsTo CodeItem keyed by `stock` column.
  const incRows = rateIds.length
    ? await prisma.rate_inclusives.findMany({
        where: { rate_id: { in: rateIds }, deleted_at: null },
        select: { rate_id: true, cost: true, stock: true },
      })
    : [];
  const codeItemIds = [...new Set(incRows.map((i) => i.stock).filter((s): s is string => s !== null && /^\d+$/.test(String(s))))].map((s) => BigInt(s));
  const codeItemRows = codeItemIds.length
    ? await prisma.code_items.findMany({ where: { id: { in: codeItemIds } }, select: { id: true, calculator: true, code_post_id: true } })
    : [];
  const codeItemById = new Map(codeItemRows.map((ci) => [Number(ci.id), ci]));
  const codePostIds = [...new Set(codeItemRows.map((ci) => Number(ci.code_post_id)).filter(Boolean))] as number[];
  const postNames = codePostIds.length
    ? await prisma.code_posts.findMany({ where: { id: { in: codePostIds.map((id) => BigInt(id)) } }, select: { id: true, name: true } })
    : [];
  const postNameById = new Map(postNames.map((p) => [Number(p.id), p.name ?? '']));

  const inclusivesByRate = new Map<number, { cost: number; calc: string; kind: 'breakfast' | 'lunch' | 'dinner' | 'other' }[]>();
  for (const inc of incRows) {
    if (!inc.stock || !/^\d+$/.test(String(inc.stock))) continue;
    const rateKey = Number(inc.rate_id);
    const list = inclusivesByRate.get(rateKey) ?? [];
    const ci = codeItemById.get(Number(inc.stock));
    const nameLc = (postNameById.get(Number(ci?.code_post_id)) ?? '').toLowerCase();
    const kind = nameLc.includes('breakfast') ? 'breakfast' : nameLc.includes('lunch') ? 'lunch' : nameLc.includes('dinner') ? 'dinner' : 'other';
    list.push({ cost: Number(inc.cost ?? 0), calc: String(ci?.calculator ?? '').toLowerCase(), kind });
    inclusivesByRate.set(rateKey, list);
  }

  // Rooms per room type for occupancy denominator
  const roomsByType = new Map<number, number>();
  const roomTypeRows = await prisma.room_types.findMany({ where: { property_id: propertyId }, select: { id: true } });
  for (const rt of roomTypeRows) {
    roomsByType.set(Number(rt.id), await countActiveRooms(propertyId, rt.id));
  }

  // Group by date|room_type
  const groups = new Map<string, any[]>();
  for (const r of reservations) {
    if (r.room_type_id === null || r.date === null) continue;
    if (badRateIds.has(Number(r.rate_id))) continue;
    const key = `${fmtDate(r.date)}|${Number(r.room_type_id)}`;
    const list = groups.get(key) ?? [];
    list.push(r);
    groups.set(key, list);
  }

  for (const [key, group] of groups) {
    const [dateStr, roomTypeIdStr] = key.split('|');
    const roomCount = Math.max(roomsByType.get(Number(roomTypeIdStr)) ?? 0, 1);

    const revenueReservations = group.filter(
      (r) => r.room_id !== null && [0, 1, 3, 4].includes(r.folios?.status_reservation)
    );

    let totalAmount = 0;
    for (const r of revenueReservations) {
      const total = Number(r.total ?? 0);
      let inclusiveTotal = 0;
      const incs = inclusivesByRate.get(Number(r.rate_id)) ?? [];
      for (const inc of incs) {
        const value =
          inc.calc === 'room' ? inc.cost :
          inc.calc === 'adult' ? inc.cost * Number(r.adult ?? 0) :
          inc.calc === 'child' ? inc.cost * Number(r.child ?? 0) :
          inc.cost;
        inclusiveTotal += value;
      }
      const roomOnly = total - inclusiveTotal - Number(r.total_extra_bed ?? 0);
      totalAmount += Math.max(0, roomOnly);
    }

    const roomSold = revenueReservations.length;
    const adr = roomSold > 0 ? totalAmount / roomSold : 0;
    const occupancy = (roomSold / roomCount) * 100;

    history.set(key, {
      date: dateStr,
      room_type_id: Number(roomTypeIdStr),
      adr,
      occupancy,
      room_sold: roomSold,
      total_revenue: totalAmount,
    });
  }

  return history;
}

function extractRoomTypeHistory(historicalData: Map<string, any>, roomTypeId: number): Map<string, any> {
  const out = new Map<string, any>();
  for (const [key, item] of historicalData) {
    if (item.room_type_id === roomTypeId) out.set(item.date, item);
  }
  return out;
}

function getAverageAdr(history: Map<string, any>, fallbackRate = 300000): number {
  const adrs = [...history.values()].map((v) => v.adr).filter((v) => v > 0);
  return adrs.length > 0 ? adrs.reduce((s, v) => s + v, 0) / adrs.length : fallbackRate;
}

// Laravel calculatePerSeasonality — config factors win; else derive from data.
function calculatePerSeasonality(config: any, history: Map<string, any>): { monthly_factors: Record<number, number>; dow_factors: Record<string, number> } {
  if (config.seasonality_factors && typeof config.seasonality_factors === 'object') {
    const sf = typeof config.seasonality_factors === 'string' ? JSON.parse(config.seasonality_factors) : config.seasonality_factors;
    const monthly: Record<number, number> = {};
    for (let m = 1; m <= 12; m++) monthly[m] = sf?.monthly?.[m] ?? 1.0;
    const dow: Record<string, number> = {};
    for (const d of DOW_NAMES) dow[d] = sf?.dow?.[d] ?? 1.0;
    return { monthly_factors: monthly, dow_factors: dow };
  }

  const monthlyAdr: Record<number, number[]> = {};
  for (let m = 1; m <= 12; m++) monthlyAdr[m] = [];
  const dowAdr: Record<string, number[]> = {};

  const adrsAll: number[] = [];
  for (const item of history.values()) {
    if (!(item.adr > 0)) continue;
    adrsAll.push(item.adr);
    const d = new Date(`${item.date}T00:00:00Z`);
    monthlyAdr[d.getUTCMonth() + 1].push(item.adr);
    const dowName = DOW_NAMES[d.getUTCDay()];
    (dowAdr[dowName] = dowAdr[dowName] || []).push(item.adr);
  }
  const overallAvg = adrsAll.length ? adrsAll.reduce((s, v) => s + v, 0) / adrsAll.length : 1;

  const monthlyFactors: Record<number, number> = {};
  for (let m = 1; m <= 12; m++) {
    const arr = monthlyAdr[m];
    const avg = arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : overallAvg;
    monthlyFactors[m] = overallAvg > 0 ? avg / overallAvg : 1.0;
  }
  const dowFactors: Record<string, number> = {};
  for (const day of DOW_NAMES) {
    const arr = dowAdr[day] ?? [];
    const avg = arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : overallAvg;
    dowFactors[day] = overallAvg > 0 ? avg / overallAvg : 1.0;
  }
  return { monthly_factors: monthlyFactors, dow_factors: dowFactors };
}

function calculateConfidence(history: Map<string, any>, lookbackDays: number): number {
  const values = [...history.values()].map((v) => v.occupancy).filter((v) => v > 0);
  const n = values.length;
  if (n < 2) return 0.3;
  const mean = values.reduce((s, v) => s + v, 0) / n;
  let variance = 0;
  for (const v of values) variance += Math.pow(v - mean, 2);
  variance /= n;
  const dataCoverage = Math.min(1.0, n / Math.max(lookbackDays, 1));
  const stability = Math.max(0.1, 1.0 - Math.sqrt(variance) / Math.max(mean, 1));
  return Math.round((dataCoverage * 0.5 + stability * 0.5) * 10000) / 10000;
}

type ForecastMap = Record<string, number>;

function forecastDispatch(method: string, values: number[], startStr: string, endStr: string): ForecastMap {
  switch (method) {
    case 'exponential_smoothing': return exponentialSmoothing(values, startStr, endStr, 0.3);
    case 'linear_regression': return linearRegression(values, startStr, endStr);
    case 'seasonal_decomposition': return seasonalDecomposition(values, startStr, endStr, 7);
    case 'holt_winters': return holtWinters(values, startStr, endStr, 7);
    default: return movingAverage(values, startStr, endStr, 7);
  }
}

function forecastOccupancy(method: string, history: Map<string, any>, startStr: string, endStr: string): ForecastMap {
  const values = [...history.values()].map((v) => v.occupancy).filter((v) => v > 0);
  if (values.length < 3) {
    const avg = values.length ? values.reduce((s, v) => s + v, 0) / values.length : 50;
    const out: ForecastMap = {};
    for (const d of dateRangeList(startStr, endStr)) out[d] = avg;
    return out;
  }
  return forecastDispatch(method, values, startStr, endStr);
}

function forecastAdr(method: string, history: Map<string, any>, startStr: string, endStr: string, fallbackRate = 300000): ForecastMap {
  const values = [...history.values()].map((v) => v.adr).filter((v) => v > 0);
  if (values.length < 3) {
    const avg = values.length ? values.reduce((s, v) => s + v, 0) / values.length : fallbackRate;
    const out: ForecastMap = {};
    for (const d of dateRangeList(startStr, endStr)) out[d] = avg;
    return out;
  }
  return forecastDispatch(method, values, startStr, endStr);
}

function movingAverage(values: number[], startStr: string, endStr: string, window = 7): ForecastMap {
  const out: ForecastMap = {};
  const n = values.length;
  if (n < window) window = n;
  const dates = dateRangeList(startStr, endStr);
  dates.forEach((d, i) => {
    const idx = i % window;
    let slice = values.slice(Math.max(0, n - window + idx - window), Math.max(0, n - window + idx - window) + window);
    if (slice.length < 1) slice = values.slice(Math.max(0, n - window), Math.max(0, n - window) + window);
    const avg = slice.length ? slice.reduce((s, v) => s + v, 0) / slice.length : 0;
    out[d] = Math.round(avg * 100) / 100;
  });
  return out;
}

function exponentialSmoothing(values: number[], startStr: string, endStr: string, alpha = 0.3): ForecastMap {
  let smoothed = values[0] ?? 0;
  for (let i = 1; i < values.length; i++) smoothed = alpha * values[i] + (1 - alpha) * smoothed;
  const out: ForecastMap = {};
  for (const d of dateRangeList(startStr, endStr)) out[d] = Math.round(smoothed * 100) / 100;
  return out;
}

function linearRegression(values: number[], startStr: string, endStr: string): ForecastMap {
  const n = values.length;
  const dates = dateRangeList(startStr, endStr);
  if (n < 2) {
    const avg = n > 0 ? values[0] : 0;
    const out: ForecastMap = {};
    dates.forEach((d) => (out[d] = Math.round(avg * 100) / 100));
    return out;
  }
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  values.forEach((y, i) => { sumX += i; sumY += y; sumXY += i * y; sumXX += i * i; });
  const slope = (n * sumXY - sumX * sumY) / Math.max(n * sumXX - sumX * sumX, 1);
  const intercept = (sumY - slope * sumX) / n;
  const out: ForecastMap = {};
  dates.forEach((d, j) => {
    const x = n + j;
    out[d] = Math.round(Math.max(0, intercept + slope * x) * 100) / 100;
  });
  return out;
}

function seasonalDecomposition(values: number[], startStr: string, endStr: string, period = 7): ForecastMap {
  const n = values.length;
  if (n < period * 2) return movingAverage(values, startStr, endStr, Math.min(period, n));

  const trend: number[] = [];
  for (let i = 0; i < n; i++) {
    const s = Math.max(0, i - Math.floor(period / 2));
    const e = Math.min(n - 1, i + Math.floor(period / 2));
    const slice = values.slice(s, e + 1);
    trend[i] = slice.reduce((acc, v) => acc + v, 0) / slice.length;
  }

  const seasonal = new Array(period).fill(0);
  const seasonalCount = new Array(period).fill(0);
  for (let i = 0; i < n; i++) {
    const idx = i % period;
    seasonal[idx] += values[i] - trend[i];
    seasonalCount[idx]++;
  }
  for (let i = 0; i < period; i++) seasonal[i] = seasonalCount[i] > 0 ? seasonal[i] / seasonalCount[i] : 0;

  const lastTrend = trend[n - 1] ?? 0;
  const trendSlope = n >= 2 ? (trend[n - 1] - trend[0]) / (n - 1) : 0;
  const out: ForecastMap = {};
  dateRangeList(startStr, endStr).forEach((d, j) => {
    const t = lastTrend + trendSlope * (j + 1);
    const s = seasonal[(n + j) % period];
    out[d] = Math.round(Math.max(0, t + s) * 100) / 100;
  });
  return out;
}

function holtWinters(values: number[], startStr: string, endStr: string, period = 7): ForecastMap {
  const n = values.length;
  if (n < period * 2) return seasonalDecomposition(values, startStr, endStr, period);

  const alpha = 0.3, beta = 0.1, gamma = 0.1;
  let level = values[0];
  let trend = 0;
  const seasonals = new Array(period).fill(1.0);

  for (let i = 0; i < Math.min(period, n); i++) trend += (values[i] - values[0]) / Math.max(period, 1);
  trend /= Math.max(period * 2, 1);

  for (let i = 0; i < n; i++) {
    const oldLevel = level;
    const seasonIdx = i % period;
    level = alpha * (values[i] / Math.max(seasonals[seasonIdx], 0.01)) + (1 - alpha) * (oldLevel + trend);
    trend = beta * (level - oldLevel) + (1 - beta) * trend;
    seasonals[seasonIdx] = gamma * (values[i] / Math.max(level, 0.01)) + (1 - gamma) * seasonals[seasonIdx];
  }

  const out: ForecastMap = {};
  dateRangeList(startStr, endStr).forEach((d, j) => {
    const f = (level + trend * (j + 1)) * seasonals[(n + j) % period];
    out[d] = Math.round(Math.max(0, f) * 100) / 100;
  });
  return out;
}

// Laravel calculateExtraRatios — median extra ratios from historical rate_rates.
async function calculateExtraRatios(propertyId: bigint): Promise<{ extra_adult_ratio: number; extra_child_ratio: number }> {
  const rates: any[] = await prisma.$queryRaw`
    SELECT one_adult, extra_adult, extra_child FROM rate_rates
    WHERE property_id = ${propertyId} AND extra_adult > 0 AND one_adult > 0 AND extra_adult < one_adult
    LIMIT 5000
  `;
  const median = (arr: number[]) => {
    if (!arr.length) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  };
  const ratiosAdult: number[] = [];
  const ratiosChild: number[] = [];
  for (const r of rates) {
    ratiosAdult.push(Number(r.extra_adult) / Number(r.one_adult));
    if (Number(r.extra_child) > 0) ratiosChild.push(Number(r.extra_child) / Number(r.one_adult));
  }
  return { extra_adult_ratio: median(ratiosAdult), extra_child_ratio: median(ratiosChild) };
}

// Shared engine — Laravel DynamicRateService::calculate.
async function runCalculation(configRow: any, roomTypeIds: any[] | undefined, userId?: bigint | null): Promise<number> {
  const propertyId = configRow.property_id;
  const lookbackDays = Number(configRow.lookback_days ?? 30);
  const forecastDays = Number(configRow.forecast_days ?? 30);

  const today = new Date();
  const todayStr = fmtDate(today);
  const yesterdayStr = addDaysStr(todayStr, -1);
  const lookbackStart = addDaysStr(todayStr, -lookbackDays);
  const forecastStart = todayStr;
  const forecastEnd = addDaysStr(todayStr, forecastDays);
  const lastYearStart = addDaysStr(addDaysStr(todayStr, -365), -forecastDays);
  const lastYearEnd = addDaysStr(addDaysStr(todayStr, -365), forecastDays);

  const totalRoomCount = await countActiveRooms(propertyId);
  const method = configRow.forecast_method || 'moving_average';

  const roomTypeWhere: any = { property_id: propertyId, deleted_at: null };
  if (roomTypeIds?.length) roomTypeWhere.id = { in: roomTypeIds.map((rtId: any) => BigInt(rtId)) };
  const roomTypes = await prisma.room_types.findMany({ where: roomTypeWhere, select: { id: true, name: true, rate: true } });

  const historicalData = await fetchHistoricalData(propertyId, lookbackStart, yesterdayStr);
  const lastYearData = await fetchHistoricalData(propertyId, lastYearStart, lastYearEnd);

  let resultsCount = 0;
  for (const roomType of roomTypes) {
    const roomCount = await countActiveRooms(propertyId, roomType.id);
    if (roomCount <= 0) continue;

    const roomTypeHistory = extractRoomTypeHistory(historicalData, Number(roomType.id));
    const roomTypeLastYear = extractRoomTypeHistory(lastYearData, Number(roomType.id));
    const seasonality = calculatePerSeasonality(configRow, roomTypeHistory);

    const forecastedOccupancy = forecastOccupancy(method, roomTypeHistory, forecastStart, forecastEnd);
    let fallbackRate = Number(roomType.rate ?? 0);
    if (fallbackRate <= 0) fallbackRate = 300000;
    const forecastedAdr = forecastAdr(method, roomTypeHistory, forecastStart, forecastEnd, fallbackRate);

    const confidenceBase = calculateConfidence(roomTypeHistory, lookbackDays);
    const avgAdrFallback = getAverageAdr(roomTypeHistory, fallbackRate);

    for (const dateStr of dateRangeList(forecastStart, forecastEnd)) {
      const month = new Date(`${dateStr}T00:00:00Z`).getUTCMonth() + 1;
      const dow = DOW_NAMES[new Date(`${dateStr}T00:00:00Z`).getUTCDay()];
      const lastYearDate = addDaysStr(dateStr, -365);
      const lastYearEntry = roomTypeLastYear.get(lastYearDate) ?? {};
      const lastYearAdr = Number(lastYearEntry.adr ?? 0);
      const lastYearOcc = Number(lastYearEntry.occupancy ?? 0);

      const histAdr = Number(roomTypeHistory.get(dateStr)?.adr ?? 0);
      const lastYearAdrForHist = Number(lastYearEntry.adr ?? 0);
      const methodAdr = forecastedAdr[dateStr] ?? (histAdr > 0 ? histAdr : avgAdrFallback);

      let baseRate = lastYearAdr > 0 ? lastYearAdr * 0.6 + methodAdr * 0.4 : methodAdr;
      baseRate = Math.max(baseRate, 1);

      const occForecast = forecastedOccupancy[dateStr]
        ?? roomTypeHistory.get(dateStr)?.occupancy
        ?? (lastYearOcc > 0 ? lastYearOcc : 50);

      const gdpImpact = (Number(configRow.gdp_growth_rate ?? 0) / 100) * Number(configRow.adjustment_sensitivity ?? 1);
      let inflationImpact = (Number(configRow.inflation_rate ?? 0) / 100) * Number(configRow.adjustment_sensitivity ?? 1);
      if (lastYearAdr > 0) inflationImpact = Math.max(inflationImpact, 0.01);

      const monthFactor = seasonality.monthly_factors[month] ?? 1.0;
      const dowFactor = seasonality.dow_factors[dow] ?? 1.0;
      const seasonalityFactor = (monthFactor + dowFactor) / 2;

      const targetOcc = Math.max(Number(configRow.target_occupancy ?? 70), 1);
      const occRatio = occForecast / Math.max(targetOcc, 1);
      const occupancyFactor = Math.max(0.80, Math.min(1.25, occRatio));

      let adjustmentPercent =
        (gdpImpact + inflationImpact) * 100 +
        (seasonalityFactor - 1) * 100 +
        (occupancyFactor - 1) * 100;
      adjustmentPercent = Math.max(
        Number(configRow.min_adjustment_percent ?? -100),
        Math.min(Number(configRow.max_adjustment_percent ?? 100), adjustmentPercent)
      );

      const suggestedOneAdult = baseRate * (1 + adjustmentPercent / 100);
      const suggestedTwoAdult = suggestedOneAdult;

      let confidence = confidenceBase;
      if (lastYearAdr > 0) confidence = Math.min(1.0, confidence + 0.15);

      await prisma.dynamic_rate_results.upsert({
        where: {
          property_id_dynamic_rate_config_id_room_type_id_date: {
            property_id: propertyId,
            dynamic_rate_config_id: configRow.id,
            room_type_id: roomType.id,
            date: new Date(`${dateStr}T00:00:00Z`),
          },
        } as any,
        update: {
          historical_adr: histAdr > 0 ? histAdr : lastYearAdrForHist,
          forecasted_adr: Math.round(methodAdr * 100) / 100,
          forecasted_occupancy: occForecast,
          base_rate: baseRate,
          suggested_rate_one_adult: round2(suggestedOneAdult),
          suggested_rate_two_adult: round2(suggestedTwoAdult),
          adjustment_percent: round4(adjustmentPercent),
          gdp_impact: round4(gdpImpact),
          inflation_impact: round4(inflationImpact),
          seasonality_factor: round4(seasonalityFactor),
          occupancy_factor: round4(occupancyFactor),
          confidence_score: round4(confidence),
          forecast_method_used: method,
          is_applied: 0,
          original_one_adult: null,
          original_two_adult: null,
          updated_at: new Date(),
          ...(userId ? { updated_by: userId } : {}),
        },
        create: {
          property_id: propertyId,
          dynamic_rate_config_id: configRow.id,
          room_type_id: roomType.id,
          date: new Date(`${dateStr}T00:00:00Z`),
          historical_adr: histAdr > 0 ? histAdr : lastYearAdrForHist,
          forecasted_adr: Math.round(methodAdr * 100) / 100,
          forecasted_occupancy: occForecast,
          base_rate: baseRate,
          suggested_rate_one_adult: round2(suggestedOneAdult),
          suggested_rate_two_adult: round2(suggestedTwoAdult),
          adjustment_percent: round4(adjustmentPercent),
          gdp_impact: round4(gdpImpact),
          inflation_impact: round4(inflationImpact),
          seasonality_factor: round4(seasonalityFactor),
          occupancy_factor: round4(occupancyFactor),
          confidence_score: round4(confidence),
          forecast_method_used: method,
          is_applied: 0,
          original_one_adult: null,
          original_two_adult: null,
          sort: resultsCount,
          status: 1,
          created_by: userId ?? undefined,
        },
      });
      resultsCount++;
    }
  }
  return resultsCount;
}

// Shared applier — Laravel DynamicRateService::applyRates.
async function runApply(configRow: any, opts: { startDate?: string; endDate?: string; roomTypeId?: any }, userId?: bigint | null): Promise<{ applied: number; eaRatio: number; ecRatio: number }> {
  const startDate = opts.startDate;
  const endDate = opts.endDate ?? opts.startDate;

  const where: any = {
    dynamic_rate_config_id: configRow.id,
    property_id: configRow.property_id,
    is_applied: 0,
    ...(startDate || endDate ? { date: {} } : {}),
  };
  if (startDate) (where.date as any).gte = new Date(`${startDate}T00:00:00Z`);
  if (endDate) (where.date as any).lte = new Date(`${endDate}T00:00:00Z`);
  if (opts.roomTypeId) where.room_type_id = BigInt(opts.roomTypeId);

  const results = await prisma.dynamic_rate_results.findMany({ where });
  const ratios = await calculateExtraRatios(configRow.property_id);
  const eaRatio = ratios.extra_adult_ratio;
  const ecRatio = ratios.extra_child_ratio;

  let applied = 0;
  for (const result of results) {
    const suggested = Math.round(Number(result.suggested_rate_one_adult ?? 0));
    const suggestedTwo = Math.round(Number(result.suggested_rate_two_adult ?? 0));
    const extraAdult = eaRatio > 0 ? Math.round(suggested * eaRatio) : 0;
    const extraChild = ecRatio > 0 ? Math.round(suggested * ecRatio) : 0;

    const rateRates = await prisma.rate_rates.findMany({
      where: {
        property_id: configRow.property_id,
        room_type_id: result.room_type_id,
        date: result.date,
        deleted_at: null,
      },
    });

    if (rateRates.length === 0) {
      // Insert into ALL active BAR rates (Laravel pluck bar ids).
      const barRates = await prisma.rates.findMany({
        where: { property_id: configRow.property_id, module: 'bar', status: 1, deleted_at: null },
        select: { id: true },
      });
      for (const br of barRates) {
        await prisma.rate_rates.create({
          data: {
            property_id: configRow.property_id,
            rate_id: br.id,
            room_type_id: result.room_type_id,
            date: result.date,
            one_adult: suggested,
            two_adult: suggestedTwo,
            extra_adult: extraAdult,
            extra_child: extraChild,
            min_night: 1,
            max_night: 30,
            stop_arrival: 0,
            stop_departure: 0,
            stop_sell: 0,
            min_los: 0,
            sort: 0,
            status: 1,
            created_by: userId ?? undefined,
            created_at: new Date(),
          },
        });
      }
      await prisma.dynamic_rate_results.update({
        where: { id: result.id },
        data: {
          original_one_adult: 0,
          original_two_adult: 0,
          original_extra_adult: 0,
          original_extra_child: 0,
          is_applied: 1,
          applied_at: new Date(),
          updated_at: new Date(),
          ...(userId ? { updated_by: userId } : {}),
        },
      });
    } else {
      const first = rateRates[0];
      const origOne = Number(first.one_adult ?? 0);
      const origTwo = Number(first.two_adult ?? 0);
      const origExtraAdult = Number(first.extra_adult ?? 0);
      const origExtraChild = Number(first.extra_child ?? 0);

      for (const rr of rateRates) {
        await prisma.rate_rates.update({
          where: { id: rr.id },
          data: {
            one_adult: suggested,
            two_adult: suggestedTwo,
            extra_adult: extraAdult,
            extra_child: extraChild,
            updated_at: new Date(),
            ...(userId ? { updated_by: userId } : {}),
          },
        });
      }
      await prisma.dynamic_rate_results.update({
        where: { id: result.id },
        data: {
          original_one_adult: origOne,
          original_two_adult: origTwo,
          original_extra_adult: origExtraAdult,
          original_extra_child: origExtraChild,
          is_applied: 1,
          applied_at: new Date(),
          updated_at: new Date(),
          ...(userId ? { updated_by: userId } : {}),
        },
      });
    }
    applied++;
  }
  return { applied, eaRatio, ecRatio };
}

function round2(v: number) { return Math.round(v * 100) / 100; }
function round4(v: number) { return Math.round(v * 10000) / 10000; }

function bigintToNumber(val: any): any {
  if (val === null || val === undefined) return val;
  if (typeof val === 'bigint') return Number(val);
  if (Array.isArray(val)) return val.map(bigintToNumber);
  if (val && typeof val === 'object' && typeof (val as any).toNumber === 'function') return Number((val as any).toNumber());
  if (typeof val === 'object') {
    const out: any = {};
    for (const [k, v] of Object.entries(val)) out[k] = bigintToNumber(v);
    return out;
  }
  return val;
}

const MENU_ID = 1102;

export class DynamicRateController {
  /**
   * GET /api/dynamic-rates
   * Paginated list of dynamic_rate_configs
   */
  static async list(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const search = req.query.search as string;
      const sort = req.query.sort as string || 'id';
      const order = req.query.order === 'desc' ? 'desc' : 'asc';

      const trash = req.query.trash === '1' || req.query.trash === 'true';
      const where: any = { deleted_at: trash ? { not: null } : null };

      if (search) {
        where.OR = [
          { name: { contains: search, mode: 'insensitive' } },
          { forecast_method: { contains: search, mode: 'insensitive' } }
        ];
      }

      const isSuperUser = req.user?.superUser || false;
      if (!isSuperUser) {
        where.property_id = req.user?.lastProperty;
      }

      const [configs, total] = await Promise.all([
        prisma.dynamic_rate_configs.findMany({
          where,
          orderBy: { [sort]: order },
          skip: (page - 1) * limit,
          take: limit
        }),
        prisma.dynamic_rate_configs.count({ where })
      ]);

      const formatted = configs.map(c => ({
        ...c,
        id: Number(c.id),
        property_id: Number(c.property_id)
      }));

      const table = [
        { label: 'Name', key: 'name', type: 'none', is_search: true },
        { label: 'Forecast Method', key: 'forecast_method', type: 'badge', is_search: true },
        { label: 'Is Active', key: 'is_active', type: 'badge', is_search: true },
        { label: 'Auto Apply', key: 'auto_apply', type: 'badge', is_search: true },
        { label: 'Status', key: 'status', type: 'badge', is_search: true },
        { label: 'Action', key: 'action', type: 'action', is_search: false }
      ];

      const permFlags = getPermissionFlags(req.user, MENU_ID);
      const permission = {
        view: true,
        add: req.user?.superUser || permFlags.add,
        edit: req.user?.superUser || permFlags.edit,
        delete: req.user?.superUser || permFlags.delete
      };

      const searchData = [
        { key: 'name', label: 'Name', type: 'text' },
        { key: 'forecast_method', label: 'Forecast Method', type: 'select', options: [
          { value: 'moving_average', label: 'Moving Average' },
          { value: 'exponential_smoothing', label: 'Exponential Smoothing' },
          { value: 'linear_regression', label: 'Linear Regression' },
          { value: 'seasonal_naive', label: 'Seasonal Naive' },
          { value: 'manual', label: 'Manual' }
        ]},
        { key: 'is_active', label: 'Is Active', type: 'select', options: [
          { value: 1, label: 'Active' },
          { value: 0, label: 'Inactive' }
        ]},
        { key: 'auto_apply', label: 'Auto Apply', type: 'select', options: [
          { value: 1, label: 'Yes' },
          { value: 0, label: 'No' }
        ]},
        { key: 'status', label: 'Status', type: 'select', options: [
          { value: 1, label: 'Active' },
          { value: 0, label: 'Inactive' }
        ]}
      ];

      success(res, bigintToNumber(formatted), 'Success', 200, {
        table,
        permission,
        search_data: searchData,
        pagination: {
          current_page: page,
          last_page: Math.ceil(total / limit),
          per_page: limit,
          total,
          from: (page - 1) * limit + 1,
          to: Math.min(page * limit, total)
        }
      });
    } catch (err: any) {
      console.error('Dynamic rate list error:', err);
      error(res, 'Failed to fetch dynamic rates', 500);
    }
  }

  /**
   * GET /api/dynamic-rates/create
   * Get master data for creation form
   */
  static async create(req: Request, res: Response): Promise<void> {
    try {
      const master = {
        statuses: [
          { value: 1, label: 'Active' },
          { value: 0, label: 'Inactive' }
        ],
        forecast_methods: [
          { value: 'moving_average', label: 'Moving Average' },
          { value: 'exponential_smoothing', label: 'Exponential Smoothing' },
          { value: 'linear_regression', label: 'Linear Regression' },
          { value: 'seasonal_naive', label: 'Seasonal Naive' },
          { value: 'manual', label: 'Manual' }
        ]
      };

      success(res, master, 'Success');
    } catch (err: any) {
      console.error('Dynamic rate create form error:', err);
      error(res, 'Failed to load form data', 500);
    }
  }

  /**
   * POST /api/dynamic-rates
   * Create new config
   */
  static async store(req: Request, res: Response): Promise<void> {
    try {
      const {
        name, forecast_method, gdp_growth_rate, inflation_rate,
        adjustment_sensitivity, min_adjustment_percent, max_adjustment_percent,
        lookback_days, forecast_days, target_occupancy, seasonality_factors,
        is_active, auto_apply, sort, status
      } = req.body;

      const errors: Record<string, string[]> = {};
      if (!name) errors.name = ['The name field is required.'];
      if (!forecast_method) errors.forecast_method = ['The forecast method field is required.'];

      if (Object.keys(errors).length > 0) {
        validationError(res, errors);
        return;
      }

      const config = await prisma.dynamic_rate_configs.create({
        data: {
          property_id: BigInt(req.user?.lastProperty!),
          name,
          forecast_method,
          gdp_growth_rate,
          inflation_rate,
          adjustment_sensitivity,
          min_adjustment_percent,
          max_adjustment_percent,
          lookback_days: lookback_days || 90,
          forecast_days: forecast_days || 30,
          target_occupancy,
          seasonality_factors: seasonality_factors || undefined,
          is_active: is_active ?? 1,
          auto_apply: auto_apply ?? 0,
          sort: sort || 0,
          status: status ?? 0,
          created_by: req.user?.id ? BigInt(req.user.id) : undefined
        }
      });

      const created = await prisma.dynamic_rate_configs.findUnique({ where: { id: config.id } });
      success(res, { ...created!, id: Number(created!.id) }, 'Success', 200);
    } catch (err: any) {
      console.error('Dynamic rate store error:', err);
      error(res, 'Failed to create dynamic rate config', 500);
    }
  }

  /**
   * GET /api/dynamic-rates/:id
   * Show single config
   */
  static async show(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);

      const config = await prisma.dynamic_rate_configs.findUnique({ where: { id } });

      if (!config || config.deleted_at) {
        notFound(res, 'Dynamic rate config not found');
        return;
      }

      success(res, { ...config, id: Number(config.id), property_id: Number(config.property_id) }, 'Success');
    } catch (err: any) {
      console.error('Dynamic rate show error:', err);
      error(res, 'Failed to fetch dynamic rate config', 500);
    }
  }

  /**
   * GET /api/dynamic-rates/:id/edit
   * Get config with master data for edit form
   */
  static async edit(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);

      const config = await prisma.dynamic_rate_configs.findUnique({ where: { id } });

      if (!config || config.deleted_at) {
        notFound(res, 'Dynamic rate config not found');
        return;
      }

      const master = {
        statuses: [
          { value: 1, label: 'Active' },
          { value: 0, label: 'Inactive' }
        ],
        forecast_methods: [
          { value: 'moving_average', label: 'Moving Average' },
          { value: 'exponential_smoothing', label: 'Exponential Smoothing' },
          { value: 'linear_regression', label: 'Linear Regression' },
          { value: 'seasonal_naive', label: 'Seasonal Naive' },
          { value: 'manual', label: 'Manual' }
        ]
      };

      success(res, { ...config, id: Number(config.id), property_id: Number(config.property_id), master }, 'Success');
    } catch (err: any) {
      console.error('Dynamic rate edit error:', err);
      error(res, 'Failed to load edit data', 500);
    }
  }

  /**
   * PUT /api/dynamic-rates/:id
   * Update config
   */
  static async update(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);

      const {
        name, forecast_method, gdp_growth_rate, inflation_rate,
        adjustment_sensitivity, min_adjustment_percent, max_adjustment_percent,
        lookback_days, forecast_days, target_occupancy, seasonality_factors,
        is_active, auto_apply, sort, status
      } = req.body;

      const config = await prisma.dynamic_rate_configs.findUnique({ where: { id } });
      if (!config || config.deleted_at) {
        notFound(res, 'Dynamic rate config not found');
        return;
      }

      const errors: Record<string, string[]> = {};
      if (!name) errors.name = ['The name field is required.'];
      if (!forecast_method) errors.forecast_method = ['The forecast method field is required.'];

      if (Object.keys(errors).length > 0) {
        validationError(res, errors);
        return;
      }

      const data: any = {
        name,
        forecast_method,
        gdp_growth_rate,
        inflation_rate,
        adjustment_sensitivity,
        min_adjustment_percent,
        max_adjustment_percent,
        lookback_days,
        forecast_days,
        target_occupancy,
        seasonality_factors: seasonality_factors || undefined,
        is_active,
        auto_apply,
        sort,
        status,
        updated_by: req.user?.id ? BigInt(req.user.id) : undefined
      };

      await prisma.dynamic_rate_configs.update({ where: { id }, data });

      const updated = await prisma.dynamic_rate_configs.findUnique({ where: { id } });
      success(res, { ...updated!, id: Number(updated!.id) }, 'Success');
    } catch (err: any) {
      console.error('Dynamic rate update error:', err);
      error(res, 'Failed to update dynamic rate config', 500);
    }
  }

  /**
   * DELETE /api/dynamic-rates/:id
   * Soft delete config
   */
  static async destroy(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);

      const config = await prisma.dynamic_rate_configs.findUnique({ where: { id } });
      if (!config) {
        notFound(res, 'Dynamic rate config not found');
        return;
      }

      await prisma.dynamic_rate_configs.update({
        where: { id },
        data: {
          deleted_at: new Date(),
          status: 0,
          deleted_by: req.user?.id ? BigInt(req.user.id) : undefined
        }
      });

      success(res, null, 'Success');
    } catch (err: any) {
      console.error('Dynamic rate destroy error:', err);
      error(res, 'Failed to delete dynamic rate config', 500);
    }
  }

  /**
   * DELETE /api/dynamic-rates/:id/force
   * Force delete config
   */
  static async delete(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);

      const config = await prisma.dynamic_rate_configs.findUnique({ where: { id } });
      if (!config) {
        notFound(res, 'Dynamic rate config not found');
        return;
      }

      await prisma.dynamic_rate_results.deleteMany({ where: { dynamic_rate_config_id: id } });
      await prisma.dynamic_rate_configs.delete({ where: { id } });

      success(res, null, 'Success');
    } catch (err: any) {
      console.error('Dynamic rate force delete error:', err);
      error(res, 'Failed to force delete dynamic rate config', 500);
    }
  }

  static async disable(req: Request, res: Response): Promise<void> {
    try {
      const id = BigInt(String(req.params.id));
      const config = await prisma.dynamic_rate_configs.findUnique({ where: { id } });
      if (!config || config.deleted_at) { notFound(res, 'Dynamic rate config not found'); return; }

      // Laravel DynamicRateService::disable — restore originals for ALL applied
      // results (no date range on this endpoint), then deactivate the config.
      const results = await prisma.dynamic_rate_results.findMany({
        where: { dynamic_rate_config_id: id, property_id: config.property_id, is_applied: 1 },
      });

      let restored = 0;
      for (const result of results) {
        const rateRates = await prisma.rate_rates.findMany({
          where: { property_id: config.property_id, room_type_id: result.room_type_id, date: result.date, deleted_at: null },
        });

        if (rateRates.length === 0) {
          await prisma.dynamic_rate_results.update({
            where: { id: result.id },
            data: { is_applied: 0, applied_at: null, updated_at: new Date() },
          });
          restored++;
          continue;
        }

        if (result.original_one_adult !== null && result.original_two_adult !== null) {
          if (Number(result.original_one_adult) === 0 && Number(result.original_two_adult) === 0) {
            // Rows were inserted by apply() — delete them again.
            for (const rr of rateRates) {
              await prisma.rate_rates.delete({ where: { id: rr.id } });
            }
          } else {
            for (const rr of rateRates) {
              const update: any = {
                one_adult: Number(result.original_one_adult),
                two_adult: Number(result.original_two_adult),
                updated_at: new Date(),
              };
              if (result.original_extra_adult !== null) update.extra_adult = Number(result.original_extra_adult);
              if (result.original_extra_child !== null) update.extra_child = Number(result.original_extra_child);
              await prisma.rate_rates.update({ where: { id: rr.id }, data: update });
            }
          }
        } else {
          // Originals never recorded — fall back to the room type default rate.
          const roomType = await prisma.room_types.findUnique({ where: { id: result.room_type_id }, select: { rate: true } });
          const defaultRate = Math.round(Number(roomType?.rate ?? 300000));
          for (const rr of rateRates) {
            await prisma.rate_rates.update({
              where: { id: rr.id },
              data: { one_adult: defaultRate, two_adult: defaultRate, updated_at: new Date() },
            });
          }
        }

        await prisma.dynamic_rate_results.update({
          where: { id: result.id },
          data: { is_applied: 0, applied_at: null, updated_at: new Date() },
        });
        restored++;
      }

      await prisma.dynamic_rate_configs.update({ where: { id }, data: { is_active: 0, updated_at: new Date() } });
      success(res, null, `Disabled dynamic rate: ${restored} rates restored.`);
    } catch (err: any) { console.error('Dynamic rate disable error:', err); error(res, 'Failed to disable config', 500); }
  }

  /**
   * POST /api/dynamic-rates/:id/calculate
   * Run calculation engine
   */
  static async calculate(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);
      const { room_type_ids } = req.body;

      const config = await prisma.dynamic_rate_configs.findUnique({ where: { id } });
      if (!config || config.deleted_at) {
        notFound(res, 'Dynamic rate config not found');
        return;
      }

      const userId = req.user?.id ? BigInt(req.user.id) : null;
      const resultsCount = await runCalculation(config, room_type_ids, userId);

      success(res, { success: true, config_id: Number(id), results_count: resultsCount }, 'Calculation completed');
    } catch (err: any) {
      console.error('Dynamic rate calculate error:', err);
      error(res, 'Failed to calculate dynamic rates', 500);
    }
  }

  /**
   * POST /api/dynamic-rates/:id/apply
   * Apply suggested rates to rate_rates table
   */
  static async apply(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);
      const { start_date, end_date, room_type_id } = req.body;

      const config = await prisma.dynamic_rate_configs.findUnique({ where: { id } });
      if (!config || config.deleted_at) {
        notFound(res, 'Dynamic rate config not found');
        return;
      }

      const userId = req.user?.id ? BigInt(req.user.id) : null;
      const { applied, eaRatio, ecRatio } = await runApply(
        config,
        { startDate: start_date, endDate: end_date, roomTypeId: room_type_id },
        userId
      );

      success(res, {
        success: true,
        applied_count: applied,
        message: `Applied ${applied} rate suggestions. Extra adult ratio: ${Math.round(eaRatio * 1000) / 10}%, extra child: ${Math.round(ecRatio * 1000) / 10}%`,
      }, 'Rates applied successfully');
    } catch (err: any) {
      console.error('Dynamic rate apply error:', err);
      error(res, 'Failed to apply dynamic rates', 500);
    }
  }

  /**
   * POST /api/dynamic-rates/:id/sync
   * Calculate + Apply in one call
   */
  static async sync(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);

      const config = await prisma.dynamic_rate_configs.findUnique({ where: { id } });
      if (!config || config.deleted_at) {
        notFound(res, 'Dynamic rate config not found');
        return;
      }

      const userId = req.user?.id ? BigInt(req.user.id) : null;
      const resultsCount = await runCalculation(config, req.body.room_type_ids, userId);
      const { applied } = await runApply(config, { startDate: undefined, endDate: undefined, roomTypeId: undefined }, userId);

      success(res, { results_count: resultsCount, applied_count: applied }, 'Sync completed');
    } catch (err: any) {
      console.error('Dynamic rate sync error:', err);
      error(res, 'Failed to sync dynamic rates', 500);
    }
  }

  /**
   * GET /api/dynamic-rates/:id/results
   * Paginated list of calculation results
   */
  static async results(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const startDate = req.query.start_date as string;
      const endDate = req.query.end_date as string;
      const roomTypeId = req.query.room_type_id as string;

      const where: any = {
        dynamic_rate_config_id: id,
        deleted_at: null
      };

      if (startDate) where.date = { ...(where.date || {}), gte: new Date(startDate) };
      if (endDate) where.date = { ...(where.date || {}), lte: new Date(endDate) };
      if (roomTypeId) where.room_type_id = BigInt(roomTypeId);

      const [results, total] = await Promise.all([
        prisma.dynamic_rate_results.findMany({
          where,
          orderBy: { date: 'asc' },
          skip: (page - 1) * limit,
          take: limit,
          include: {
            room_types: { select: { id: true, name: true } }
          }
        }),
        prisma.dynamic_rate_results.count({ where })
      ]);

      const formatted = results.map(r => {
        const safe = bigintToNumber(r);
        return {
          ...safe,
          room_type: r.room_types ? { id: Number(r.room_types.id), name: r.room_types.name } : null,
          room_types: undefined
        };
      });

      // Get room types for filter dropdown
      const config = await prisma.dynamic_rate_configs.findUnique({
        where: { id },
        select: { property_id: true }
      });

      let roomTypeOptions: any[] = [];
      if (config) {
        const roomTypes = await prisma.room_types.findMany({
          where: { property_id: config.property_id, deleted_at: null, status: 1 },
          select: { id: true, name: true },
          orderBy: { name: 'asc' }
        });
        roomTypeOptions = roomTypes.map(rt => ({ value: Number(rt.id), label: rt.name }));
      }

      const table = [
        { label: 'Date', key: 'date', type: 'date', is_search: false },
        { label: 'Room Type', key: 'room_type', type: 'none', is_search: false },
        { label: 'Base Rate', key: 'base_rate', type: 'currency', is_search: false },
        { label: 'Suggested 1 Adult', key: 'suggested_rate_one_adult', type: 'currency', is_search: false },
        { label: 'Suggested 2 Adult', key: 'suggested_rate_two_adult', type: 'currency', is_search: false },
        { label: 'Adjustment %', key: 'adjustment_percent', type: 'percent', is_search: false },
        { label: 'Confidence', key: 'confidence_score', type: 'percent', is_search: false },
        { label: 'Applied', key: 'is_applied', type: 'badge', is_search: false },
        { label: 'Action', key: 'action', type: 'action', is_search: false }
      ];

      success(res, { results: formatted, room_type_options: roomTypeOptions }, 'Success', 200, {
        table,
        pagination: {
          current_page: page,
          last_page: Math.ceil(total / limit),
          per_page: limit,
          total,
          from: (page - 1) * limit + 1,
          to: Math.min(page * limit, total)
        }
      });
    } catch (err: any) {
      console.error('Dynamic rate results error:', err);
      error(res, 'Failed to fetch results', 500);
    }
  }

  /**
   * GET /api/dynamic-rates/:id/statistics
   * Dashboard stats for config
   */
  static async statistics(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);

      const config = await prisma.dynamic_rate_configs.findUnique({ where: { id } });
      if (!config || config.deleted_at) {
        notFound(res, 'Dynamic rate config not found');
        return;
      }

      const where = { dynamic_rate_config_id: id, deleted_at: null };

      const [totalResults, appliedResults, aggregation] = await Promise.all([
        prisma.dynamic_rate_results.count({ where }),
        prisma.dynamic_rate_results.count({ where: { ...where, is_applied: 1 } }),
        prisma.dynamic_rate_results.aggregate({
          where,
          _avg: { adjustment_percent: true, confidence_score: true },
          _min: { date: true },
          _max: { date: true }
        })
      ]);

      const stats = {
        total_results: totalResults,
        applied_count: appliedResults,
        pending_count: totalResults - appliedResults,
        avg_adjustment_percent: aggregation._avg.adjustment_percent ? Number(aggregation._avg.adjustment_percent) : 0,
        avg_confidence_score: aggregation._avg.confidence_score ? Number(aggregation._avg.confidence_score) : 0,
        date_from: aggregation._min.date,
        date_to: aggregation._max.date,
        apply_rate: totalResults > 0 ? Math.round((appliedResults / totalResults) * 100 * 100) / 100 : 0
      };

      success(res, stats, 'Success');
    } catch (err: any) {
      console.error('Dynamic rate statistics error:', err);
      error(res, 'Failed to fetch statistics', 500);
    }
  }

  // â”€â”€â”€ Private Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /**
   * Calculate adjustment percent based on forecast method
   */
  private static calcAdjustment(
    method: string,
    gdpGrowthRate: number,
    inflationRate: number,
    sensitivity: number,
    day: number
  ): number {
    switch (method) {
      case 'moving_average':
        // Simple baseline with small random variance
        return (gdpGrowthRate + inflationRate) / 2 * sensitivity + (Math.random() - 0.5) * 2;
      case 'exponential_smoothing':
        // Decay-based: larger adjustments early, smaller later
        return (gdpGrowthRate + inflationRate) / 2 * sensitivity * Math.exp(-day / 30);
      case 'linear_regression':
        // Linear trend based on day
        return (gdpGrowthRate + inflationRate) / 2 * sensitivity + (day * 0.1);
      case 'seasonal_naive':
        // Cyclical pattern
        return (gdpGrowthRate + inflationRate) / 2 * sensitivity + Math.sin(day * Math.PI / 7) * 5;
      case 'manual':
      default:
        return (gdpGrowthRate + inflationRate) / 2 * sensitivity;
    }
  }

  /**
   * Get seasonality factor from stored JSON by month index (0-11)
   */
  private static getSeasonalityFactor(seasonalityJson: any, month: number): number {
    if (!seasonalityJson) return 1;
    try {
      const factors = typeof seasonalityJson === 'string' ? JSON.parse(seasonalityJson) : seasonalityJson;
      if (Array.isArray(factors) && factors.length > month) {
        return Number(factors[month]) || 1;
      }
      if (factors && typeof factors === 'object' && factors[month] !== undefined) {
        return Number(factors[month]) || 1;
      }
      return 1;
    } catch {
      return 1;
    }
  }

  /**
   * Calculate confidence score â€” higher for nearer dates
   */
  private static calcConfidence(day: number, totalDays: number): number {
    const score = 100 - (day / totalDays) * 40;
    return Math.round(Math.max(20, Math.min(100, score)) * 100) / 100;
  }
}

