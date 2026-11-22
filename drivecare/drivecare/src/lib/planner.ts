import { getAll, put, putMany, removeMany } from './db';
import { hasCoords, haversineKm } from './geo';
import { locationTitle } from './address';
import { categoryLabel } from './settings';
import { isActiveAppt } from './report';
import { newTrip } from './trips';
import type { RouteResult } from './routing';
import type { AppSettings, Appointment, PlanStop, RoutePlan, SavedLocation, Trip } from './types';
import { nowIso, uid } from './util';
import { dateKey, dayNumber, zonedToIso } from './time';

export interface PlanPoint {
  key: string;
  role: 'start' | 'stop' | 'end';
  locationId: string | null;
  location: SavedLocation | null;
  label: string;
  appointments: Appointment[];
  stopKeys: string[];
  /** When you need to be there / when you leave (appointments and work hours) */
  arrive: string | null;
  leave: string | null;
  /** This stop is your workplace during work hours */
  work: boolean;
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

const timeOfStop = (s: PlanStop, appts: Map<string, Appointment>): string | null =>
  s.type === 'appointment' ? appts.get(s.appointmentId ?? '')?.start ?? null : s.time ?? null;

/** Inserts a stop before the first stop that happens later (stops without a time are skipped). */
function insertByTime(stops: PlanStop[], stop: PlanStop, appts: Map<string, Appointment>) {
  const t = timeOfStop(stop, appts);
  const idx = t ? stops.findIndex((x) => {
    const xt = timeOfStop(x, appts);
    return xt != null && xt > t;
  }) : -1;
  if (idx < 0) stops.push(stop);
  else stops.splice(idx, 0, stop);
}

/** Work hours for a given day: that weekday's own hours, or your usual hours. */
export function workTimesFor(day: string, settings: AppSettings): { start: string; end: string } {
  const h = settings.workHours[String(weekdayOf(day))];
  return { start: h?.start || settings.workStartTime, end: h?.end || settings.workEndTime };
}

export const weekdayOf = (key: string) => (((dayNumber(key) + 4) % 7) + 7) % 7; // 0 = Sunday

/** On your weekly work schedule */
export function isWorkday(key: string, settings: AppSettings): boolean {
  return settings.workDays.includes(weekdayOf(key));
}

export function workLocationOf(settings: AppSettings, locations: SavedLocation[]): SavedLocation | null {
  return (settings.workLocationId ? locations.find((l) => l.id === settings.workLocationId) : undefined) ?? locations.find((l) => l.kind === 'work') ?? null;
}

export function homeLocationOf(settings: AppSettings, locations: SavedLocation[]): SavedLocation | null {
  return (settings.homeLocationId ? locations.find((l) => l.id === settings.homeLocationId) : undefined) ?? locations.find((l) => l.kind === 'home') ?? null;
}

/** A recorded or logged trip that arrived at work before (or shortly after) the start of work hours. */
export function detectedWorkTrip(day: string, trips: Trip[], work: SavedLocation | null, settings: AppSettings): Trip | null {
  if (!work) return null;
  const latest = new Date(new Date(zonedToIso(day, workTimesFor(day, settings).start)).getTime() + 2 * 36e5).toISOString();
  return (
    trips.find((t) => {
      if (t.recording || t.origin === 'route-plan' || !t.endTime || dateKey(t.startTime) !== day || t.endTime > latest) return false;
      if (t.end.locationId === work.id) return true;
      return hasCoords(t.end) && hasCoords(work) && haversineKm(t.end, work) <= 0.25;
    }) ?? null
  );
}

export type WorkdayReason = 'set-on' | 'set-off' | 'schedule' | 'detected' | 'none';

export function workdayStatus(day: string, plan: RoutePlan | undefined, settings: AppSettings, trips: Trip[], locations: SavedLocation[]): { on: boolean; reason: WorkdayReason; trip: Trip | null } {
  if (plan?.workday === true) return { on: true, reason: 'set-on', trip: null };
  if (plan?.workday === false) return { on: false, reason: 'set-off', trip: null };
  if (isWorkday(day, settings)) return { on: true, reason: 'schedule', trip: null };
  const t = detectedWorkTrip(day, trips, workLocationOf(settings, locations), settings);
  return t ? { on: true, reason: 'detected', trip: t } : { on: false, reason: 'none', trip: null };
}

/** Routes start and end at Home; on workdays, work is added as stops at your work hours. */
export function defaultEnds(_day: string, settings: AppSettings, locations: SavedLocation[]) {
  const home = homeLocationOf(settings, locations)?.id ?? null;
  return { start: home, end: home };
}

/** Creates or updates a day's plan so it includes current appointments while keeping manual order/exclusions. */
export function reconcilePlan(
  plan: RoutePlan | undefined,
  day: string,
  dayAppts: Appointment[],
  settings: AppSettings,
  locations: SavedLocation[] = [],
  trips: Trip[] = []
): RoutePlan {
  const { start, end } = defaultEnds(day, settings, locations);
  const base: RoutePlan = plan ?? {
    id: day,
    date: day,
    startLocationId: start,
    endLocationId: end,
    stops: [],
    manualKm: {},
    workday: null,
    updatedAt: nowIso(),
  };
  const valid = new Set(dayAppts.map((a) => a.id));
  const apptById = new Map(dayAppts.map((a) => [a.id, a]));
  const work = workLocationOf(settings, locations);
  const workOn = !!work && workdayStatus(day, plan, settings, trips, locations).on;

  let stops: PlanStop[] = base.stops.filter((s) => {
    if (s.workRole) return workOn;
    return s.type === 'location' || (s.appointmentId && valid.has(s.appointmentId));
  });
  // keep work stops in step with current work hours and address
  stops = stops.map((s) =>
    s.workRole && work
      ? { ...s, locationId: work.id, time: zonedToIso(day, s.workRole === 'work-start' ? workTimesFor(day, settings).start : workTimesFor(day, settings).end) }
      : s
  );
  const present = new Set(stops.map((s) => s.appointmentId).filter(Boolean));
  for (const a of dayAppts) {
    if (present.has(a.id)) continue;
    insertByTime(stops, { key: uid(), type: 'appointment', appointmentId: a.id, locationId: null, excluded: false }, apptById);
  }
  if (workOn && work) {
    for (const role of ['work-start', 'work-end'] as const) {
      if (stops.some((s) => s.workRole === role)) continue;
      const time = zonedToIso(day, role === 'work-start' ? workTimesFor(day, settings).start : workTimesFor(day, settings).end);
      insertByTime(stops, { key: role, type: 'location', appointmentId: null, locationId: work.id, excluded: false, workRole: role, time }, apptById);
    }
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
    arrive: null,
    leave: null,
    work: false,
  });
  const points: PlanPoint[] = [];
  const startLoc = plan.startLocationId ? locs.get(plan.startLocationId) : undefined;
  if (!plan.skipStart) points.push(pt('start', plan.startLocationId, startLoc ? locationTitle(startLoc) : 'Choose a starting point', 'start'));

  for (const s of plan.stops) {
    if (s.excluded) continue;
    const prev: PlanPoint | undefined = points[points.length - 1];
    if (s.type === 'appointment') {
      const a = s.appointmentId ? appts.get(s.appointmentId) : undefined;
      if (!a) continue;
      if (prev && prev.role === 'stop' && a.locationId && prev.locationId === a.locationId) {
        prev.appointments.push(a);
        prev.stopKeys.push(s.key);
        prev.arrive = prev.arrive ?? a.start;
        prev.leave = a.end;
        continue;
      }
      const loc = a.locationId ? locs.get(a.locationId) : undefined;
      const p = pt('stop', a.locationId, loc ? locationTitle(loc) : categoryLabel(settings, a.categoryId), s.key);
      p.appointments.push(a);
      p.stopKeys.push(s.key);
      p.arrive = a.start;
      p.leave = a.end;
      points.push(p);
    } else {
      if (prev && prev.role === 'stop' && s.locationId && prev.locationId === s.locationId) {
        prev.stopKeys.push(s.key);
        if (s.workRole) {
          prev.work = true;
          if (s.workRole === 'work-start') prev.arrive = prev.arrive ?? s.time ?? null;
          else prev.leave = s.time ?? prev.leave;
        }
        continue;
      }
      const loc = s.locationId ? locs.get(s.locationId) : undefined;
      const p = pt('stop', s.locationId, loc ? locationTitle(loc) : 'Removed place', s.key);
      p.stopKeys.push(s.key);
      if (s.workRole) {
        p.work = true;
        if (s.workRole === 'work-start') p.arrive = s.time ?? null;
        else p.leave = s.time ?? null;
      }
      points.push(p);
    }
  }
  const endLoc = plan.endLocationId ? locs.get(plan.endLocationId) : undefined;
  if (!plan.skipEnd) points.push(pt('end', plan.endLocationId, endLoc ? locationTitle(endLoc) : 'Choose an ending point', 'end'));
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
      missingReason = bad.role === 'stop' ? 'Address not confirmed' : `No ${bad.role === 'start' ? 'starting' : 'ending'} location selected`;
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

/** Departure/arrival for a leg: leave when the previous stop ends, arrive when the next one starts. */
export function segmentTimes(s: PlanSegment, day: string): { start: string; end: string } {
  const durMs = (s.durationMin ?? 0) * 60000;
  let start: string;
  let end: string;
  if (s.from.leave) {
    start = s.from.leave;
    end = s.to.arrive ?? new Date(new Date(start).getTime() + durMs).toISOString();
  } else if (s.to.arrive) {
    end = s.to.arrive;
    start = new Date(new Date(end).getTime() - durMs).toISOString();
  } else {
    start = zonedToIso(day, '12:00');
    end = start;
  }
  if (end < start) end = start;
  return { start, end };
}

export const pointRef = (p: PlanPoint) => ({ label: p.label, locationId: p.locationId, lat: p.location?.lat ?? null, lng: p.location?.lng ?? null });

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
    const { start, end } = segmentTimes(s, plan.date);
    const point = pointRef;
    created.push(
      newTrip({
        origin: 'route-plan',
        routePlanId: plan.id,
        category: fromA || toA ? 'treatment' : s.from.work || s.to.work ? 'work' : 'personal',
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
        notes: fromA || toA ? 'Created from the route planner (estimated distance).' : 'Commute / other leg created from the route planner (estimated distance).',
      })
    );
  }
  await removeMany('trips', old);
  await putMany('trips', created);
  await put('routePlans', { ...plan, updatedAt: nowIso() });
  return { created: created.length, skipped };
}
