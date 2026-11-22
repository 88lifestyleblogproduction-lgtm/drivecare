/**
 * "Did you drive this leg?" — builds the list of past appointment legs waiting for your answer,
 * and saves the answer as a trip (with planned vs actual km, so detours are visible).
 */
import { getAll, put, putMany, removeMany } from './db';
import { haversineKm, hasCoords } from './geo';
import { buildPoints, buildSegments, dayAppointments, pointRef, reconcilePlan, segmentTimes, type PlanPoint, type PlanSegment, type SegmentState } from './planner';
import { addDays, dateKey, todayKey } from './time';
import { newTrip } from './trips';
import type { AppSettings, Appointment, LegDecision, RoutePlan, SavedLocation, Trip } from './types';
import { nowIso, round } from './util';

export const CONFIRM_DAYS = 14;

export interface DayPlan {
  day: string;
  plan: RoutePlan;
  points: PlanPoint[];
}

export interface PendingLeg {
  key: string;
  day: string;
  plan: RoutePlan;
  seg: PlanSegment;
  start: string;
  end: string;
  /** A GPS trip recorded around this time that looks like this leg */
  gps: Trip | null;
}

export function recentDayPlans(appointments: Appointment[], routePlans: RoutePlan[], settings: AppSettings, locations: SavedLocation[], trips: Trip[]): DayPlan[] {
  const apptMap = new Map(appointments.map((a) => [a.id, a]));
  const locMap = new Map(locations.map((l) => [l.id, l]));
  const out: DayPlan[] = [];
  const today = todayKey();
  for (let i = CONFIRM_DAYS; i >= 0; i--) {
    const day = addDays(today, -i);
    const dAppts = dayAppointments(appointments, day);
    const plan = reconcilePlan(
      routePlans.find((p) => p.id === day),
      day,
      dAppts,
      settings,
      locations,
      trips
    );
    if (!plan.stops.some((s) => !s.excluded)) continue; // no appointments and not a workday
    out.push({ day, plan, points: buildPoints(plan, apptMap, locMap, settings) });
  }
  return out;
}

export const legKey = (s: PlanSegment) => `${s.fromApptId ?? s.from.role + ':' + (s.from.locationId ?? '')}>${s.toApptId ?? s.to.role + ':' + (s.to.locationId ?? '')}`;

function near(a: { lat: number | null; lng: number | null }, b: SavedLocation | null, km = 0.5) {
  return !!b && hasCoords(a) && hasCoords(b) && haversineKm(a, b) <= km;
}

export function pendingLegs(days: DayPlan[], results: Map<string, SegmentState>, trips: Trip[], commuteSince = '', now = new Date().toISOString()): PendingLeg[] {
  const out: PendingLeg[] = [];
  const used = new Set<string>();
  for (const d of days) {
    const segs = buildSegments(d.points, d.plan, results);
    for (const seg of segs) {
      if (seg.kind === 'same') continue;
      // ask about legs that involve an appointment or your workplace (commute)
      if (!seg.fromApptId && !seg.toApptId && !seg.from.work && !seg.to.work) continue;
      if (!seg.fromApptId && !seg.toApptId && (!commuteSince || d.day < commuteSince)) continue;
      const key = legKey(seg);
      if (d.plan.legDecisions?.[key]) continue;
      const { start, end } = segmentTimes(seg, d.day);
      if (end > now) continue;
      const done = trips.some(
        (t) => t.origin !== 'route-plan' && !t.recording && (t.fromAppointmentId ?? null) === seg.fromApptId && (t.toAppointmentId ?? null) === seg.toApptId
      );
      if (done) continue;
      // A GPS recording (e.g. with CarPlay) around the same time that ends near the destination
      const gps =
        trips.find((t) => {
          if (t.origin !== 'gps' || t.recording || used.has(t.id) || t.toAppointmentId || t.fromAppointmentId || !t.endTime) return false;
          if (dateKey(t.startTime) !== d.day) return false;
          const ts = new Date(t.startTime).getTime();
          const te = new Date(t.endTime).getTime();
          const s0 = new Date(start).getTime() - 2 * 36e5;
          const e0 = new Date(end).getTime() + 36e5;
          if (te < s0 || ts > e0) return false;
          return near(t.end, seg.to.location) || near(t.start, seg.from.location) || !seg.to.location;
        }) ?? null;
      if (gps) used.add(gps.id);
      out.push({ key, day: d.day, plan: d.plan, seg, start, end, gps });
    }
  }
  return out.sort((a, b) => b.start.localeCompare(a.start));
}

async function saveDecision(plan: RoutePlan, key: string, decision: LegDecision) {
  await put('routePlans', { ...plan, legDecisions: { ...(plan.legDecisions ?? {}), [key]: decision }, updatedAt: nowIso() });
}

/** "Yes, I drove this": saves the trip with planned and actual distance and fuel cost. */
export async function confirmLeg(leg: PendingLeg, actualKm: number | null, costPerKm: number | null): Promise<Trip> {
  const s = leg.seg;
  const planned = s.usedKm;
  const actual = actualKm ?? leg.gps?.gpsKm ?? planned;
  const cost = (km: number | null) => (km != null && costPerKm != null ? round(km * costPerKm, 2) : null);
  const common = {
    category: s.fromApptId || s.toApptId ? ('treatment' as const) : ('work' as const),
    fromAppointmentId: s.fromApptId,
    toAppointmentId: s.toApptId,
    plannedKm: planned,
    plannedFuelCost: cost(planned),
    fuelCost: cost(actual),
    confirmedAt: nowIso(),
    updatedAt: nowIso(),
  };
  let trip: Trip;
  if (leg.gps) {
    trip = {
      ...leg.gps,
      ...common,
      manualKm: actualKm,
      distanceSource: actualKm != null ? 'manual' : 'gps',
      start: leg.gps.start.locationId ? leg.gps.start : { ...leg.gps.start, ...(s.from.location ? pointRef(s.from) : {}) },
      end: leg.gps.end.locationId ? leg.gps.end : { ...leg.gps.end, ...(s.to.location ? pointRef(s.to) : {}) },
    };
  } else {
    trip = newTrip({
      ...common,
      origin: 'confirmed',
      startTime: leg.start,
      endTime: leg.end,
      start: pointRef(s.from),
      end: pointRef(s.to),
      routedKm: s.estKm,
      routedProvider: s.provider,
      manualKm: actualKm ?? (s.manualKm != null ? s.manualKm : null),
      distanceSource: actualKm != null || (s.estKm == null && s.manualKm != null) ? 'manual' : s.estKm != null ? 'routing' : null,
      routeGeometry: s.geometry,
      routePlanId: leg.day,
      notes: actualKm != null && planned != null && Math.abs(actualKm - planned) >= 0.1 ? `Detour ${actualKm - planned > 0 ? '+' : ''}${(actualKm - planned).toFixed(1)} km vs planned route` : '',
    });
  }
  // the route-planner estimate for this leg is replaced by the confirmed trip
  const old = (await getAll<Trip>('trips')).filter(
    (t) => t.origin === 'route-plan' && t.fromAppointmentId === s.fromApptId && t.toAppointmentId === s.toApptId
  );
  await putMany('trips', [trip]);
  if (old.length)
    await removeMany(
      'trips',
      old.map((t) => t.id)
    );
  await saveDecision(leg.plan, leg.key, { status: 'yes', at: nowIso(), tripId: trip.id, note: '' });
  return trip;
}

/** "No — it was a different trip": saves what you describe (not counted as appointment travel). */
export async function otherTrip(leg: PendingLeg, description: string, km: number | null, costPerKm: number | null): Promise<void> {
  let tripId: string | null = null;
  if (km != null && km > 0) {
    const t = newTrip({
      origin: 'confirmed',
      category: 'other',
      startTime: leg.start,
      endTime: leg.end,
      start: pointRef(leg.seg.from),
      end: { label: description || 'Other trip', locationId: null, lat: null, lng: null },
      manualKm: km,
      distanceSource: 'manual',
      fuelCost: costPerKm != null ? round(km * costPerKm, 2) : null,
      confirmedAt: nowIso(),
      notes: description,
    });
    await put('trips', t);
    tripId = t.id;
  }
  await saveDecision(leg.plan, leg.key, { status: 'other', at: nowIso(), tripId, note: description });
}

/** "I didn't drive" (cancelled, got a ride, etc.) */
export async function skipLeg(leg: PendingLeg, note = ''): Promise<void> {
  await saveDecision(leg.plan, leg.key, { status: 'skipped', at: nowIso(), tripId: null, note });
}
