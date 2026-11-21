import { dateKey, dayNumber, daysBetween, monthKey } from './time';
import { sum } from './util';
import type { FuelEntry } from './types';

export type Basis = 'verified' | 'estimate' | 'unavailable';

export interface Metric {
  value: number | null;
  basis: Basis;
  detail: string;
}

export interface ConsumptionInterval {
  fromId: string;
  toId: string;
  toDate: string;
  litres: number;
  km: number;
  lPer100: number;
  cost: number | null;
  included: boolean;
  reason: string;
}

export interface FuelStats {
  entries: FuelEntry[]; // ascending by date
  count: number;
  totalSpent: number;
  totalLitres: number;
  daysSincePrevious: Map<string, number>;
  avgDaysBetween: Metric;
  avgDailyExpense: Metric;
  avgPricePerLitre: Metric;
  monthly: { month: string; spent: number; litres: number; count: number }[];
  intervals: ConsumptionInterval[];
  avgConsumption: Metric;
  costPerKm: Metric;
  avgMonthlyKm: Metric;
  lastOdometer: number | null;
}

const unavailable = (detail: string): Metric => ({ value: null, basis: 'unavailable', detail });

export function sortFuel(entries: FuelEntry[]): FuelEntry[] {
  return [...entries].sort((a, b) => a.datetime.localeCompare(b.datetime) || (a.odometer ?? 0) - (b.odometer ?? 0));
}

/** Fills the third of price / litres / total when exactly two are known. */
export function completeFuelAmounts(price: number | null, litres: number | null, total: number | null) {
  if (price != null && litres != null && total == null) return { price, litres, total: Math.round(price * litres * 100) / 100 };
  if (price == null && litres != null && total != null && litres > 0) return { price: Math.round((total / litres) * 1000) / 1000, litres, total };
  if (price != null && litres == null && total != null && price > 0) return { price, litres: Math.round((total / price) * 1000) / 1000, total };
  return { price, litres, total };
}

export function computeFuelStats(raw: FuelEntry[]): FuelStats {
  const entries = sortFuel(raw);
  const n = entries.length;
  const totalSpent = sum(entries.map((e) => e.total ?? 0));
  const totalLitres = sum(entries.map((e) => e.litres ?? 0));

  // Days between consecutive purchases (calendar days, Vancouver)
  const daysSincePrevious = new Map<string, number>();
  for (let i = 1; i < n; i++) {
    daysSincePrevious.set(entries[i].id, dayNumber(dateKey(entries[i].datetime)) - dayNumber(dateKey(entries[i - 1].datetime)));
  }

  const spanDays = n >= 2 ? daysBetween(entries[0].datetime, entries[n - 1].datetime) : 0;

  const avgDaysBetween: Metric =
    n >= 2 && spanDays > 0
      ? { value: spanDays / (n - 1), basis: 'verified', detail: `Across ${n} purchases` }
      : unavailable('Needs at least two fuel purchases');

  // Fuel bought at the last fill-up is used after the period ends, so it is excluded.
  const spentBeforeLast = sum(entries.slice(0, -1).map((e) => e.total ?? 0));
  const avgDailyExpense: Metric =
    n >= 2 && spanDays >= 1
      ? {
          value: spentBeforeLast / spanDays,
          basis: 'estimate',
          detail: `Spending between first and last purchase (${Math.round(spanDays)} days), excluding the most recent fill`,
        }
      : unavailable('Needs at least two purchases on different days');

  const priced = entries.filter((e) => e.litres != null && e.litres > 0 && e.total != null);
  const pricedLitres = sum(priced.map((e) => e.litres!));
  const avgPricePerLitre: Metric =
    priced.length && pricedLitres > 0
      ? { value: sum(priced.map((e) => e.total!)) / pricedLitres, basis: 'verified', detail: `Litre-weighted, ${priced.length} purchases` }
      : unavailable('No purchases with litres and total');

  const monthlyMap = new Map<string, { month: string; spent: number; litres: number; count: number }>();
  for (const e of entries) {
    const m = monthKey(e.datetime);
    const row = monthlyMap.get(m) ?? { month: m, spent: 0, litres: 0, count: 0 };
    row.spent += e.total ?? 0;
    row.litres += e.litres ?? 0;
    row.count++;
    monthlyMap.set(m, row);
  }
  const monthly = [...monthlyMap.values()].sort((a, b) => a.month.localeCompare(b.month));

  // Full-tank to full-tank consumption. Litres of every fill after the previous full fill
  // (partials included) up to and including the next full fill, over the odometer distance.
  const intervals: ConsumptionInterval[] = [];
  let lastFull = -1;
  for (let j = 0; j < n; j++) {
    const e = entries[j];
    if (j > lastFull && lastFull >= 0 && e.missedPrevious) {
      // chain broken: a fill-up between the last full tank and here was not recorded
      lastFull = e.fullTank ? j : -1;
      continue;
    }
    if (!e.fullTank) {
      if (e.missedPrevious) lastFull = -1;
      continue;
    }
    if (lastFull < 0) {
      lastFull = j;
      continue;
    }
    const from = entries[lastFull];
    const fills = entries.slice(lastFull + 1, j + 1);
    let reason = '';
    if (from.odometer == null || e.odometer == null) reason = 'Missing odometer reading';
    else if (fills.some((f) => f.litres == null || f.litres <= 0)) reason = 'Missing litres on a fill-up';
    else if (fills.some((f) => f.missedPrevious)) reason = 'A fill-up was marked as missed';
    const km = from.odometer != null && e.odometer != null ? e.odometer - from.odometer : 0;
    if (!reason && km <= 0) reason = 'Odometer did not increase';
    const litres = sum(fills.map((f) => f.litres ?? 0));
    const lPer100 = km > 0 ? (litres / km) * 100 : 0;
    if (!reason && (lPer100 < 2 || lPer100 > 40)) reason = 'Implausible result — check odometer and litres';
    const cost = fills.every((f) => f.total != null) ? sum(fills.map((f) => f.total!)) : null;
    intervals.push({ fromId: from.id, toId: e.id, toDate: e.datetime, litres, km, lPer100, cost, included: !reason, reason });
    lastFull = j;
  }
  const good = intervals.filter((i) => i.included);
  const goodKm = sum(good.map((i) => i.km));
  const avgConsumption: Metric = good.length
    ? { value: (sum(good.map((i) => i.litres)) / goodKm) * 100, basis: 'verified', detail: `${good.length} full-tank interval${good.length > 1 ? 's' : ''}, ${Math.round(goodKm)} km` }
    : unavailable('Needs two full-tank fill-ups with odometer readings and no missed fills between them');

  const costed = good.filter((i) => i.cost != null);
  const costedKm = sum(costed.map((i) => i.km));
  let costPerKm: Metric;
  if (costed.length && costedKm > 0) {
    costPerKm = { value: sum(costed.map((i) => i.cost!)) / costedKm, basis: 'verified', detail: `From ${costed.length} full-tank interval${costed.length > 1 ? 's' : ''}` };
  } else {
    const withOdo = entries.filter((e) => e.odometer != null);
    if (withOdo.length >= 2) {
      const first = withOdo[0];
      const last = withOdo[withOdo.length - 1];
      const km = last.odometer! - first.odometer!;
      const between = entries.filter((e) => e.datetime > first.datetime && e.datetime <= last.datetime);
      const spent = sum(between.map((e) => e.total ?? 0));
      costPerKm =
        km > 0 && spent > 0 && between.every((e) => e.total != null)
          ? { value: spent / km, basis: 'estimate', detail: 'Odometer span with partial fills; record consecutive full tanks for a verified figure' }
          : unavailable('Needs fuel totals and two increasing odometer readings');
    } else {
      costPerKm = unavailable('Needs at least two fill-ups with odometer readings');
    }
  }

  const withOdo = entries.filter((e) => e.odometer != null);
  let avgMonthlyKm: Metric = unavailable('Needs odometer readings at least a week apart');
  if (withOdo.length >= 2) {
    const first = withOdo[0];
    const last = withOdo[withOdo.length - 1];
    const days = daysBetween(first.datetime, last.datetime);
    const km = last.odometer! - first.odometer!;
    if (days >= 7 && km > 0) avgMonthlyKm = { value: (km / days) * 30.4375, basis: 'estimate', detail: `From odometer readings over ${Math.round(days)} days` };
  }

  const lastOdometer = [...entries].reverse().find((e) => e.odometer != null)?.odometer ?? null;

  return {
    entries,
    count: n,
    totalSpent,
    totalLitres,
    daysSincePrevious,
    avgDaysBetween,
    avgDailyExpense,
    avgPricePerLitre,
    monthly,
    intervals,
    avgConsumption,
    costPerKm,
    avgMonthlyKm,
    lastOdometer,
  };
}
