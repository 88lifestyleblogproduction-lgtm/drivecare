/**
 * Foreground GPS trip recorder.
 *
 * iOS limits (by design, not a bug): a Home Screen web app can only receive location
 * while it is open and on screen. Recording pauses when the phone locks, the app is
 * switched away, or iOS suspends it, and it cannot start automatically (e.g. on CarPlay).
 * Points are saved every few seconds so an interrupted recording can be resumed or finished.
 */
import { get, put } from './db';
import { haversineKm, nearestLocation } from './geo';
import { newTrip } from './trips';
import type { SavedLocation, Trip } from './types';
import { locationTitle } from './address';

export interface RecorderState {
  active: boolean;
  tripId: string | null;
  startedAt: number | null;
  km: number;
  points: number;
  rejected: number;
  lastAccuracy: number | null;
  lastFixAt: number | null;
  error: string | null;
  wakeLock: boolean;
}

type WakeLockSentinelLike = { release: () => Promise<void>; addEventListener?: (t: string, f: () => void) => void };

class Recorder {
  state: RecorderState = { active: false, tripId: null, startedAt: null, km: 0, points: 0, rejected: 0, lastAccuracy: null, lastFixAt: null, error: null, wakeLock: false };
  private listeners = new Set<() => void>();
  private watchId: number | null = null;
  private trip: Trip | null = null;
  private last: { lat: number; lng: number; t: number } | null = null;
  private dirty = false;
  private saveTimer: ReturnType<typeof setInterval> | null = null;
  private lock: WakeLockSentinelLike | null = null;
  maxAccuracy = 50;

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private set(patch: Partial<RecorderState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((f) => f());
  }

  async start(maxAccuracy: number): Promise<string> {
    if (this.state.active) return this.state.tripId!;
    if (!('geolocation' in navigator)) throw new Error('Location services are not available in this browser.');
    this.maxAccuracy = maxAccuracy;
    const trip = newTrip({ origin: 'gps', recording: true, distanceSource: 'gps', gpsKm: 0, endTime: null });
    this.trip = trip;
    this.last = null;
    await put('trips', trip);
    this.set({ active: true, tripId: trip.id, startedAt: Date.now(), km: 0, points: 0, rejected: 0, error: null, lastAccuracy: null, lastFixAt: null });
    this.watch();
    return trip.id;
  }

  /** Continue a recording that was interrupted (app closed). Distance across the gap is not counted. */
  async resume(tripId: string, maxAccuracy: number): Promise<void> {
    const trip = await get<Trip>('trips', tripId);
    if (!trip) throw new Error('Trip not found.');
    this.maxAccuracy = maxAccuracy;
    this.trip = trip;
    const lp = trip.track[trip.track.length - 1];
    this.last = null; // do not bridge the gap with a straight line
    this.set({
      active: true,
      tripId: trip.id,
      startedAt: new Date(trip.startTime).getTime(),
      km: trip.gpsKm ?? 0,
      points: trip.track.length,
      rejected: 0,
      error: null,
      lastFixAt: lp ? lp[2] : null,
    });
    this.watch();
  }

  private watch() {
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => this.onPosition(pos),
      (err) => {
        const msg =
          err.code === err.PERMISSION_DENIED
            ? 'Location permission denied. Enable it in iPhone Settings → Privacy & Security → Location Services → Safari Websites (While Using).'
            : err.code === err.POSITION_UNAVAILABLE
              ? 'Location unavailable. Waiting for GPS signal…'
              : 'Location request timed out. Still trying…';
        this.set({ error: msg });
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 }
    );
    this.saveTimer = setInterval(() => void this.flush(), 5000);
    void this.acquireWakeLock();
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  private onVisibility = () => {
    if (document.visibilityState === 'visible' && this.state.active) void this.acquireWakeLock();
  };

  private async acquireWakeLock() {
    try {
      const wl = (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<WakeLockSentinelLike> } }).wakeLock;
      if (!wl) return this.set({ wakeLock: false });
      this.lock = await wl.request('screen');
      this.lock.addEventListener?.('release', () => this.set({ wakeLock: false }));
      this.set({ wakeLock: true });
    } catch {
      this.set({ wakeLock: false });
    }
  }

  private onPosition(pos: GeolocationPosition) {
    if (!this.trip) return;
    const { latitude: lat, longitude: lng, accuracy } = pos.coords;
    const t = pos.timestamp || Date.now();
    this.set({ lastAccuracy: accuracy, lastFixAt: t, error: null });
    if (accuracy > this.maxAccuracy) {
      this.set({ rejected: this.state.rejected + 1 });
      return;
    }
    if (this.last) {
      const dKm = haversineKm(this.last, { lat, lng });
      const dtS = Math.max(1, (t - this.last.t) / 1000);
      // Ignore jitter smaller than the reported accuracy, and impossible jumps (> 250 km/h).
      if (dKm * 1000 < Math.max(15, accuracy)) return;
      if (dKm / (dtS / 3600) > 250) {
        this.set({ rejected: this.state.rejected + 1 });
        return;
      }
      this.trip.gpsKm = (this.trip.gpsKm ?? 0) + dKm;
    }
    this.trip.track.push([lat, lng, t]);
    if (!this.trip.start.lat) this.trip.start = { ...this.trip.start, lat, lng };
    this.last = { lat, lng, t };
    this.dirty = true;
    this.set({ km: this.trip.gpsKm ?? 0, points: this.trip.track.length });
  }

  private async flush() {
    if (!this.trip || !this.dirty) return;
    this.dirty = false;
    this.trip.updatedAt = new Date().toISOString();
    try {
      await put('trips', { ...this.trip, track: [...this.trip.track] });
    } catch {
      this.dirty = true;
    }
  }

  private teardown() {
    if (this.watchId !== null) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null;
    if (this.saveTimer) clearInterval(this.saveTimer);
    this.saveTimer = null;
    document.removeEventListener('visibilitychange', this.onVisibility);
    void this.lock?.release().catch(() => undefined);
    this.lock = null;
  }

  /** Stops recording and finalises the trip. Returns the trip id. */
  async stop(locations: SavedLocation[]): Promise<string | null> {
    const trip = this.trip ?? (this.state.tripId ? await get<Trip>('trips', this.state.tripId) : null);
    this.teardown();
    this.trip = null;
    this.set({ active: false, wakeLock: false });
    if (!trip) return null;
    const first = trip.track[0];
    const lastP = trip.track[trip.track.length - 1];
    const label = (p: [number, number, number] | undefined) => {
      if (!p) return { label: '', locationId: null, lat: null, lng: null };
      const near = nearestLocation({ lat: p[0], lng: p[1] }, locations, 250);
      return { label: near ? locationTitle(near) : `${p[0].toFixed(4)}, ${p[1].toFixed(4)}`, locationId: near?.id ?? null, lat: p[0], lng: p[1] };
    };
    const startPt = label(first);
    const endPt = label(lastP);
    const kindOf = (id: string | null) => (id ? locations.find((l) => l.id === id)?.kind : undefined);
    // Trips to or from your workplace are marked as work/commute automatically; you can change it.
    const atWork = kindOf(startPt.locationId) === 'work' || kindOf(endPt.locationId) === 'work';
    const done: Trip = {
      ...trip,
      recording: false,
      endTime: new Date().toISOString(),
      start: startPt,
      end: endPt,
      category: atWork ? 'work' : trip.category,
      gpsKm: Math.round((trip.gpsKm ?? 0) * 100) / 100,
      distanceSource: 'gps',
      updatedAt: new Date().toISOString(),
    };
    await put('trips', done);
    this.set({ tripId: null, startedAt: null });
    return done.id;
  }
}

export const recorder = new Recorder();
