import type { Appointment, DistanceSource, Trip, TripCategory } from './types';
import { nowIso, uid } from './util';

export const SOURCE_LABEL: Record<DistanceSource, string> = {
  gps: 'GPS recorded',
  routing: 'Routing estimate',
  manual: 'Manually entered',
  odometer: 'Odometer',
};

export const SOURCE_SHORT: Record<DistanceSource, string> = {
  gps: 'GPS',
  routing: 'Route est.',
  manual: 'Manual',
  odometer: 'Odometer',
};

export const CATEGORY_LABEL: Record<TripCategory, string> = {
  treatment: 'Treatment',
  personal: 'Personal',
  work: 'Work',
  other: 'Other',
};

export function odometerKm(t: Trip): number | null {
  if (t.odometerStart == null || t.odometerEnd == null) return null;
  const d = t.odometerEnd - t.odometerStart;
  return d >= 0 ? d : null;
}

export function kmForSource(t: Trip, s: DistanceSource): number | null {
  switch (s) {
    case 'gps':
      return t.gpsKm;
    case 'routing':
      return t.routedKm;
    case 'manual':
      return t.manualKm;
    case 'odometer':
      return odometerKm(t);
  }
}

export function availableSources(t: Trip): DistanceSource[] {
  return (['manual', 'odometer', 'gps', 'routing'] as DistanceSource[]).filter((s) => kmForSource(t, s) != null);
}

/** The distance used in totals: the chosen source, or null if that source has no value. */
export function effectiveKm(t: Trip): number | null {
  if (!t.distanceSource) return null;
  return kmForSource(t, t.distanceSource);
}

/** Picks a sensible default source when the current one has no value. */
export function normaliseSource(t: Trip): Trip {
  if (t.distanceSource && kmForSource(t, t.distanceSource) != null) return t;
  const avail = availableSources(t);
  return { ...t, distanceSource: avail[0] ?? null };
}

export function isTreatmentLinked(t: Trip): boolean {
  return !!(t.toAppointmentId || t.fromAppointmentId);
}

export type LegType = 'outbound' | 'between' | 'return';

export function legType(t: Trip): LegType | null {
  if (t.toAppointmentId && t.fromAppointmentId) return 'between';
  if (t.toAppointmentId) return 'outbound';
  if (t.fromAppointmentId) return 'return';
  return null;
}

/** A trip is attributed to the appointment it drives to; return legs to the one they leave. */
export function attributedAppointmentId(t: Trip): string | null {
  return t.toAppointmentId ?? t.fromAppointmentId ?? null;
}

/**
 * Linked treatment trips without double counting: when an actual trip (GPS, manual, odometer)
 * exists for the same appointment leg, the route-plan estimate for that leg is dropped.
 */
export function treatmentTrips(trips: Trip[], appointments: Map<string, Appointment>): Trip[] {
  const linked = trips.filter((t) => !t.recording && isTreatmentLinked(t));
  const groups = new Map<string, Trip[]>();
  for (const t of linked) {
    const k = `${t.fromAppointmentId ?? ''}>${t.toAppointmentId ?? ''}`;
    const g = groups.get(k);
    if (g) g.push(t);
    else groups.set(k, [t]);
  }
  const out: Trip[] = [];
  for (const g of groups.values()) {
    const actual = g.filter((t) => t.origin !== 'route-plan');
    out.push(...(actual.length ? actual : g));
  }
  return out.filter((t) => {
    const a = appointments.get(attributedAppointmentId(t) ?? '');
    return !!a && !a.excluded;
  });
}

export function newTrip(partial: Partial<Trip> = {}): Trip {
  const stamp = nowIso();
  return {
    id: uid(),
    startTime: stamp,
    endTime: stamp,
    start: { label: '', locationId: null, lat: null, lng: null },
    end: { label: '', locationId: null, lat: null, lng: null },
    category: 'personal',
    gpsKm: null,
    routedKm: null,
    routedProvider: null,
    manualKm: null,
    odometerStart: null,
    odometerEnd: null,
    distanceSource: null,
    track: [],
    routeGeometry: null,
    toAppointmentId: null,
    fromAppointmentId: null,
    rejectedMatches: [],
    origin: 'manual',
    routePlanId: null,
    recording: false,
    notes: '',
    createdAt: stamp,
    updatedAt: stamp,
    ...partial,
  };
}
