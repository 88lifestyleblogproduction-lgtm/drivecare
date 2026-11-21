import { getAll, put, putMany, removeMany } from './db';
import { hasCoords } from './geo';
import { locationTitle } from './address';
import { categoryLabel } from './settings';
import { isActiveAppt } from './report';
import { newTrip } from './trips';
import type { RouteResult } from './routing';
import type { AppSettings, Appointment, PlanStop, RoutePlan, SavedLocation, Trip } from './types';
import { nowIso, uid } from './util';
import { dateKey, zonedToIso } from './time';

export interface PlanPoint {
  key: string;
  role: 'start' | 'stop' | 'end';
  locationId: string | null;
  location: SavedLocation | null;
  label: string;
  appointments: Appointment[];
  stopKeys: string[];
}

export interface SegmentState {
  result?: RouteResult;
  error?: string;
  loading?: boolean;
}

export interface PlanSegment {
  index: number;
  pairKey: string | null;
  manualKey: string;
  from: PlanPoint;
  to: PlanPoint;
  kind: 'route' | 'same' | 'missing';
  missingReason: string;
  estKm: number | null;
  durationMin: number | null;
  provider: string | null;
  geometry: [number, number][] | null;
  error: string | null;
  loading: boolean;
  manualKm: number | null;
  /** distance used in totals: manual override, else routing estimate, else 0 for same-location */
  usedKm: number | null;
  fromApptId: string | null;
  toApptId: string | null;
}

export function dayAppointments(appointments: Appointment[], day: string): Appointment[] {
  return appointments
    .filter((a) => isActiveAppt(a) && dateKey(a.start) === day)
    .sort((a, b) => a.start.localeCompare(b.start));
}

/** Creates or updates a day's plan so it includes current appointments while keeping manual order/exclusions. */
export function reconcilePlan(plan: RoutePlan | undefined, day: string, dayAppts: Appointment[], settings: AppSettings, locations: SavedLocation[] = []): RoutePlan {
  const home = settings.homeLocationId ?? locations.find((l) => l.kind === 'home')?.id ?? null;
  const base: RoutePlan = plan ?? {
    id: day,
    date: day,
    startLocationId: home,
    endLocationId: home,
    stops: [],
    manualKm: {},
    updatedAt: nowIso(),
  };
  const valid = new Set(dayAppts.map((a) => a.id));
  const apptById = new Map(dayAppts.map((a) => [a.id, a]));
  const stops: PlanStop[] = base.stops.filter((s) => s.type === 'location' || (s.appointmentId && valid.has(s.appointmentId)));
  const present = new Set(stops.map((s) => s.appointmentId).filter(Boolean));
  for (const a of dayAppts) {
    if (present.has(a.id)) continue;
    const stop: PlanStop = { key: uid(), type: 'appointment', appointmentId: a.id, locationId: null, excluded: false };
    const idx = stops.findIndex((s) => s.type === 'appointment' && s.appointmentId && apptById.get(s.appointmentId)!.start > a.start);
    if (idx < 0) stops.push(stop);
    else stops.splice(idx, 0, stop);
  }
  return { ...base, stops };
}

export function buildPoints(plan: RoutePlan, appts: Map<string, Appointment>, locs: Map<string, SavedLocation>, settings: AppSettings): PlanPoint[] {
  const pt = (role: PlanPoint['role'], locationId: string | null, label: string, key: string): PlanPoint => ({
    key,
    role,
    locationId,
    location: locationId ? locs.get(locationId) ?? null : null,
    label,
    appointments: [],
    stopKeys: [],
  });
  const points: PlanPoint[] = [];
  const startLoc = plan.startLocationId ? locs.get(plan.startLocationId) : undefined;
  points.push(pt('start', plan.startLocationId, startLoc ? locationTitle(startLoc) : 'Choose a starting point', 'start'));

  for (const s of plan.stops) {
    if (s.excluded) continue;
    if (s.type === 'appointment') {
      const a = s.appointmentId ? appts.get(s.appointmentId) : undefined;
      if (!a) continue;
      const prev = points[points.length - 1];
      if (prev.role === 'stop' && a.locationId && prev.locationId === a.locationId) {
        prev.appointments.push(a);
        prev.stopKeys.push(s.key);
        continue;
      }
      const loc = a.locationId ? locs.get(a.locationId) : undefined;
      const p = pt('stop', a.locationId, loc ? locationTitle(loc) : categoryLabel(settings, a.categoryId), s.key);
      p.appointments.push(a);
      p.stopKeys.push(s.key);
      points.push(p);
    } else {
      const loc = s.locationId ? locs.get(s.locationId) : undefined;
      const p = pt('stop', s.locationId, loc ? locationTitle(loc) : 'Removed place', s.key);
      p.stopKeys.push(s.key);
      points.push(p);
    }
  }
  const endLoc = plan.endLocationId ? locs.get(plan.endLocationId) : undefined;
  points.push(pt('end', plan.endLocationId, endLoc ? locationTitle(endLoc) : 'Choose an ending point', 'end'));
  return points;
}

/** Key for routing results (both ends need a saved place). */
export function pairKeyOf(a: PlanPoint, b: PlanPoint): string | null {
  return a.locationId && b.locationId ? `${a.locationId}>${b.locationId}` : null;
}

/** Key for manual distance overrides; works even when an address is not yet confirmed. */
export function manualKeyOf(a: PlanPoint, b: PlanPoint): string {
  const k = (p: PlanPoint) => p.locationId ?? (p.appointments[0] ? `appt:${p.appointments[0].id}` : `${p.role}:${p.key}`);
  return `${k(a)}>${k(b)}`;
}

export function buildSegments(points: PlanPoint[], plan: RoutePlan, results: Map<string, SegmentState>): PlanSegment[] {
  const segs: PlanSegment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const from = points[i];
    const to = points[i + 1];
    const pairKey = pairKeyOf(from, to);
    const manualKey = manualKeyOf(from, to);
    const manual = plan.manualKm[manualKey] != null ? plan.manualKm[manualKey] : null;
    let kind: PlanSegment['kind'] = 'route';
    let missingReason = '';
    if (!from.location || !to.location) {
      kind = 'missing';
      const bad = !from.location ? from : to;
      missingReason = bad.role === 'stop' ? 'Clinic address not confirmed' : `No ${bad.role === 'start' ? 'starting' : 'ending'} location selected`;
    } else if (!hasCoords(from.location) || !hasCoords(to.location)) {
      kind = 'missing';
      missingReason = 'Location has no map position yet';
    } else if (from.locationId === to.locationId) {
      kind = 'same';
    }
    const st = pairKey ? results.get(pairKey) : undefined;
    const estKm = kind === 'same' ? 0 : st?.result?.km ?? null;
    segs.push({
      index: i,
      pairKey,
      manualKey,
      from,
      to,
      kind,
      missingReason,
      estKm,
      durationMin: kind === 'same' ? 0 : st?.result?.durationMin ?? null,
      provider: kind === 'same' ? 'Same location' : st?.result?.provider ?? null,
      geometry: st?.result?.geometry ?? null,
      error: st?.error ?? null,
      loading: !!st?.loading,
      manualKm: manual,
      usedKm: manual ?? estKm,
      fromApptId: from.appointments.length ? from.appointments[from.appointments.length - 1].id : null,
      toApptId: to.appointments.length ? to.appointments[0].id : null,
    });
  }
  return segs;
}

/** Replaces the trips previously generated from this plan with one trip per segment. */
export async function saveSegmentsAsTrips(plan: RoutePlan, segments: PlanSegment[]): Promise<{ created: number; skipped: number }> {
  const all = await getAll<Trip>('trips');
  const old = all.filter((t) => t.origin === 'route-plan' && t.routePlanId === plan.id).map((t) => t.id);
  const created: Trip[] = [];
  let skipped = 0;
  for (const s of segments) {
    if (s.kind === 'same') continue;
    if (s.usedKm == null) {
      skipped++;
      continue;
    }
    const fromA = s.from.appointments[s.from.appointments.length - 1];
    const toA = s.to.appointments[0];
    const durMs = (s.durationMin ?? 0) * 60000;
    let start: string;
    let end: string;
    if (fromA) {
      start = fromA.end;
      end = toA ? toA.start : new Date(new Date(start).getTime() + durMs).toISOString();
    } else if (toA) {
      end = toA.start;
      start = new Date(new Date(end).getTime() - durMs).toISOString();
    } else {
      start = zonedToIso(plan.date, '12:00');
      end = start;
    }
    if (end < start) end = start;
    const point = (p: PlanPoint) => ({ label: p.label, locationId: p.locationId, lat: p.location?.lat ?? null, lng: p.location?.lng ?? null });
    created.push(
      newTrip({
        origin: 'route-plan',
        routePlanId: plan.id,
        category: 'treatment',
        startTime: start,
        endTime: end,
        start: point(s.from),
        end: point(s.to),
        routedKm: s.estKm,
        routedProvider: s.provider,
        manualKm: s.manualKm,
        distanceSource: s.manualKm != null ? 'manual' : 'routing',
        routeGeometry: s.geometry,
        fromAppointmentId: fromA?.id ?? null,
        toAppointmentId: toA?.id ?? null,
        notes: 'Created from the treatment route planner (estimated distance).',
      })
    );
  }
  await removeMany('trips', old);
  await putMany('trips', created);
  await put('routePlans', { ...plan, updatedAt: nowIso() });
  return { created: created.length, skipped };
}
