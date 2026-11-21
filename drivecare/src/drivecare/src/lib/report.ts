import { formatAddress, parseAddress } from './address';
import { categoryLabel } from './settings';
import { dateKey, fmtTime } from './time';
import { attributedAppointmentId, effectiveKm, legType, SOURCE_LABEL, treatmentTrips, type LegType } from './trips';
import type { Metric } from './fuel';
import type { AppSettings, Appointment, SavedLocation, Trip } from './types';

export interface ReportFilter {
  startKey: string;
  endKey: string;
  categoryId: string; // 'all' or id
  locationId: string; // 'all' or id
}

export interface ClinicInfo {
  name: string;
  address: string;
  confirmed: boolean;
}

export interface ReportRow {
  tripId: string;
  appointmentId: string;
  date: string;
  apptTime: string;
  treatment: string;
  clinicName: string;
  clinicAddress: string;
  clinicConfirmed: boolean;
  fromLabel: string;
  toLabel: string;
  leg: LegType;
  km: number | null;
  source: string;
  estCost: number | null;
}

export interface Breakdown {
  key: string;
  label: string;
  appts: number;
  trips: number;
  km: number;
  cost: number | null;
}

export interface TreatmentReport {
  filter: ReportFilter;
  rows: ReportRow[];
  appointments: Appointment[];
  apptsWithoutTravel: Appointment[];
  totals: {
    appointments: number;
    trips: number;
    outboundKm: number;
    betweenKm: number;
    returnKm: number;
    totalKm: number;
    tripsMissingDistance: number;
    estCost: number | null;
    costPerTrip: number | null;
    reimbursement: number | null;
  };
  reimburseRate: number | null;
  title: string;
  byCategory: Breakdown[];
  byClinic: Breakdown[];
  bySource: { source: string; km: number; trips: number }[];
  costPerKm: Metric;
  generatedAt: string;
}

export const LEG_LABEL: Record<LegType, string> = { outbound: 'Outbound', between: 'Between treatments', return: 'Return' };

export function clinicInfo(a: Appointment, locations: Map<string, SavedLocation>): ClinicInfo {
  const loc = a.locationId ? locations.get(a.locationId) : undefined;
  if (loc) return { name: loc.name || a.summary, address: formatAddress(loc), confirmed: true };
  const p = parseAddress(a.locationRaw);
  const addr = [p.street, p.city, [p.province, p.postalCode].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return { name: p.name || a.summary, address: addr || a.locationRaw || 'Address not provided', confirmed: false };
}

export function isActiveAppt(a: Appointment): boolean {
  return !a.excluded && a.status !== 'cancelled' && a.status !== 'removed';
}

export function buildTreatmentReport(
  filter: ReportFilter,
  allAppointments: Appointment[],
  allTrips: Trip[],
  locations: SavedLocation[],
  settings: AppSettings,
  costPerKm: Metric
): TreatmentReport {
  const locMap = new Map(locations.map((l) => [l.id, l]));
  const apptMap = new Map(allAppointments.map((a) => [a.id, a]));
  const inScope = allAppointments
    .filter(isActiveAppt)
    .filter((a) => {
      const k = dateKey(a.start);
      return k >= filter.startKey && k <= filter.endKey;
    })
    .filter((a) => filter.categoryId === 'all' || a.categoryId === filter.categoryId)
    .filter((a) => filter.locationId === 'all' || a.locationId === filter.locationId)
    .sort((a, b) => a.start.localeCompare(b.start));
  const scopeIds = new Set(inScope.map((a) => a.id));

  const trips = treatmentTrips(allTrips, apptMap)
    .filter((t) => scopeIds.has(attributedAppointmentId(t) ?? ''))
    .sort((a, b) => a.startTime.localeCompare(b.startTime));

  const cpk = costPerKm.value;
  const rows: ReportRow[] = trips.map((t) => {
    const a = apptMap.get(attributedAppointmentId(t)!)!;
    const ci = clinicInfo(a, locMap);
    const km = effectiveKm(t);
    return {
      tripId: t.id,
      appointmentId: a.id,
      date: dateKey(a.start),
      apptTime: a.allDay ? 'All day' : `${fmtTime(a.start)}–${fmtTime(a.end)}`,
      treatment: categoryLabel(settings, a.categoryId),
      clinicName: ci.name,
      clinicAddress: ci.address,
      clinicConfirmed: ci.confirmed,
      fromLabel: t.start.label || 'Unspecified',
      toLabel: t.end.label || 'Unspecified',
      leg: legType(t)!,
      km,
      source: t.distanceSource ? SOURCE_LABEL[t.distanceSource] : 'No distance',
      estCost: km != null && cpk != null ? km * cpk : null,
    };
  });

  const withTravel = new Set(rows.map((r) => r.appointmentId));
  for (const t of trips) if (t.fromAppointmentId) withTravel.add(t.fromAppointmentId);
  const apptsWithoutTravel = inScope.filter((a) => !withTravel.has(a.id));

  const kmOf = (leg: LegType) => rows.filter((r) => r.leg === leg).reduce((s, r) => s + (r.km ?? 0), 0);
  const totalKm = rows.reduce((s, r) => s + (r.km ?? 0), 0);
  const tripsWithKm = rows.filter((r) => r.km != null).length;

  const breakdown = (keyOf: (a: Appointment) => string, labelOf: (key: string, a: Appointment) => string): Breakdown[] => {
    const m = new Map<string, Breakdown>();
    for (const a of inScope) {
      const k = keyOf(a);
      const b = m.get(k) ?? { key: k, label: labelOf(k, a), appts: 0, trips: 0, km: 0, cost: null };
      b.appts++;
      m.set(k, b);
    }
    for (const r of rows) {
      const a = apptMap.get(r.appointmentId)!;
      const b = m.get(keyOf(a));
      if (!b) continue;
      b.trips++;
      b.km += r.km ?? 0;
    }
    for (const b of m.values()) b.cost = cpk != null ? b.km * cpk : null;
    return [...m.values()].sort((x, y) => y.km - x.km || y.appts - x.appts);
  };

  const byCategory = breakdown(
    (a) => a.categoryId,
    (k) => categoryLabel(settings, k)
  );
  const byClinic = breakdown(
    (a) => a.locationId ?? `raw:${a.locationRaw || a.summary}`,
    (_k, a) => {
      const ci = clinicInfo(a, locMap);
      return ci.confirmed ? ci.name : `${ci.name} (address unconfirmed)`;
    }
  );

  const sourceMap = new Map<string, { source: string; km: number; trips: number }>();
  for (const r of rows) {
    const s = sourceMap.get(r.source) ?? { source: r.source, km: 0, trips: 0 };
    s.km += r.km ?? 0;
    s.trips++;
    sourceMap.set(r.source, s);
  }

  return {
    filter,
    rows,
    appointments: inScope,
    apptsWithoutTravel,
    totals: {
      appointments: inScope.length,
      trips: rows.length,
      outboundKm: kmOf('outbound'),
      betweenKm: kmOf('between'),
      returnKm: kmOf('return'),
      totalKm,
      tripsMissingDistance: rows.length - tripsWithKm,
      estCost: cpk != null ? totalKm * cpk : null,
      costPerTrip: cpk != null && tripsWithKm > 0 ? (totalKm * cpk) / tripsWithKm : null,
      reimbursement: settings.reimburseRate != null ? totalKm * settings.reimburseRate : null,
    },
    reimburseRate: settings.reimburseRate,
    title: settings.reportTitle,
    byCategory,
    byClinic,
    bySource: [...sourceMap.values()],
    costPerKm,
    generatedAt: new Date().toISOString(),
  };
}
