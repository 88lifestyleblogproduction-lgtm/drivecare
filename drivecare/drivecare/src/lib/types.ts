export type ID = string;

/** How a trip's distance was obtained. Never mixed silently. */
export type DistanceSource = 'gps' | 'routing' | 'manual' | 'odometer';
export type TripCategory = 'treatment' | 'personal' | 'work' | 'other';
export type LocationKind = 'home' | 'work' | 'clinic' | 'hospital' | 'lab' | 'pharmacy' | 'office' | 'other';
export type ApptStatus = 'confirmed' | 'tentative' | 'cancelled' | 'removed';

export interface FuelEntry {
  id: ID;
  /** ISO timestamp (UTC) */
  datetime: string;
  station: string;
  pricePerLitre: number | null;
  litres: number | null;
  total: number | null;
  odometer: number | null;
  fullTank: boolean;
  /** User says a fill-up before this one was not recorded: breaks consumption chains. */
  missedPrevious: boolean;
  hasReceipt: boolean;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReceiptRecord {
  id: ID; // same id as the fuel entry
  type: string;
  data: ArrayBuffer;
}

export interface SavedLocation {
  id: ID;
  kind: LocationKind;
  name: string;
  street: string;
  city: string;
  province: string;
  postalCode: string;
  lat: number | null;
  lng: number | null;
  coordSource: 'geocoded' | 'map' | 'gps' | null;
  geocodeLabel: string;
  /** Normalised calendar location strings (or "title:<summary>") that map to this place. */
  matchKeys: string[];
  notes: string;
  /** Located automatically from calendar text; not yet checked by the user */
  autoLocated?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CategoryDef {
  id: string;
  label: string;
  keywords: string[];
  builtIn: boolean;
  color: string;
}

export interface Appointment {
  id: ID; // `${calendarId}|${eventId}` for Google, uuid for manual
  source: 'google' | 'manual';
  calendarId: string;
  calendarName: string;
  eventId: string;
  summary: string;
  /** Location text exactly as it appears in Google Calendar */
  locationRaw: string;
  start: string;
  end: string;
  allDay: boolean;
  status: ApptStatus;
  statusNote: string;
  googleUpdated: string;
  categoryId: string;
  categoryOverride: boolean;
  matchedKeyword: string;
  locationId: ID | null;
  /** True when the user linked the clinic by hand (sync will not unlink it). */
  locationManual: boolean;
  /** User marked "not a treatment"; kept so sync does not re-add it. */
  excluded: boolean;
  lastSynced: string;
  createdAt: string;
  updatedAt: string;
}

export interface TripPoint {
  label: string;
  locationId: ID | null;
  lat: number | null;
  lng: number | null;
}

export interface Trip {
  id: ID;
  startTime: string;
  endTime: string | null;
  start: TripPoint;
  end: TripPoint;
  category: TripCategory;
  gpsKm: number | null;
  routedKm: number | null;
  routedProvider: string | null;
  manualKm: number | null;
  odometerStart: number | null;
  odometerEnd: number | null;
  /** Which distance is used in totals. */
  distanceSource: DistanceSource | null;
  /** [lat, lng, epochMs] */
  track: [number, number, number][];
  /** [lat, lng] */
  routeGeometry: [number, number][] | null;
  /** Appointment this trip drives TO (confirmed link) */
  toAppointmentId: ID | null;
  /** Appointment this trip drives FROM (confirmed link) */
  fromAppointmentId: ID | null;
  rejectedMatches: string[];
  origin: 'gps' | 'manual' | 'route-plan' | 'confirmed';
  routePlanId: string | null;
  recording: boolean;
  /** Planned (route estimate) distance for this leg, kept to measure detours */
  plannedKm?: number | null;
  /** Fuel cost snapshot when the trip was confirmed (CAD) */
  fuelCost?: number | null;
  plannedFuelCost?: number | null;
  confirmedAt?: string | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface PlanStop {
  key: string;
  type: 'appointment' | 'location';
  appointmentId: ID | null;
  locationId: ID | null;
  excluded: boolean;
  /** Work-day stops added automatically from your work hours */
  workRole?: 'work-start' | 'work-end';
  /** Scheduled time for work stops (ISO) */
  time?: string;
}

export interface RoutePlan {
  id: string; // date key YYYY-MM-DD
  date: string;
  startLocationId: ID | null;
  endLocationId: ID | null;
  stops: PlanStop[];
  /** Manual km overrides keyed by `${fromLocationId}>${toLocationId}` */
  manualKm: Record<string, number>;
  /** null/undefined = automatic (schedule or detected trip to work); true/false = set by you */
  workday?: boolean | null;
  /** You removed the first leg (leaving home) / last leg (going home) for this day */
  skipStart?: boolean;
  skipEnd?: boolean;
  /** Your answers to "did you drive this leg?" keyed by leg */
  legDecisions?: Record<string, LegDecision>;
  updatedAt: string;
}

export interface LegDecision {
  status: 'yes' | 'other' | 'skipped';
  at: string;
  tripId: string | null;
  note: string;
}

export interface CalendarRef {
  id: string;
  name: string;
}

export interface AppSettings {
  id: 'app';
  googleClientId: string;
  googleConnected: boolean;
  googleAccountHint: string;
  availableCalendars: CalendarRef[];
  selectedCalendars: CalendarRef[];
  syncPastDays: number;
  syncFutureDays: number;
  lastSync: string | null;
  lastSyncError: string | null;
  lastSyncSummary: string;
  categories: CategoryDef[];
  routingProvider: 'osrm' | 'ors';
  osrmUrl: string;
  orsApiKey: string;
  homeLocationId: ID | null;
  workLocationId: ID | null;
  gpsMaxAccuracy: number;
  theme: 'system' | 'light' | 'dark';
  /** Days you go to work: 0 = Sunday … 6 = Saturday */
  workDays: number[];
  /** Where a workday's treatment route starts and ends by default */
  workdayStart: 'home' | 'work';
  workdayEnd: 'home' | 'work';
  /** Work hours, "HH:mm" in Vancouver time */
  workStartTime: string;
  workEndTime: string;
  /** Per-weekday hours ("0" = Sunday … "6" = Saturday); falls back to workStartTime/workEndTime */
  workHours: Record<string, { start: string; end: string }>;
  tabLabelCustom: boolean;
  /** Sync records between devices through your Google Drive (hidden app folder) */
  cloudSyncEnabled: boolean;
  lastCloudSync: string | null;
  lastCloudError: string | null;
  /** When settings that sync between devices last changed */
  prefsUpdatedAt: string;
  reportTitleCustom: boolean;
  /** Name of the appointments tab (e.g. "Treatments", "Visits", "Clients") */
  tabLabel: string;
  /** Title printed on PDF/CSV reports */
  reportTitle: string;
  /** Optional reimbursement rate in CAD per km (e.g. an employer's or insurer's rate) */
  reimburseRate: number | null;
  /** Also import calendar events that have a location but match no keyword (business use) */
  importAllWithLocation: boolean;
  /** Which calendar events to import: every timed event, only events with a location, or only keyword matches */
  importMode: 'all' | 'location' | 'keywords';
  lastBackupAt: string | null;
}

export interface CacheRecord {
  id: string;
  value: unknown;
  savedAt: number;
}
