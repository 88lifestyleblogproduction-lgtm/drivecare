import { cacheGet, cacheSet, getAll, put } from './db';
import { normalizeKey, parseAddress } from './address';
import { geocodeAddress, type GeocodeResult } from './geocode';
import { haversineKm, hasCoords } from './geo';
import { isActiveAppt } from './report';
import { applyLocationToMatching } from './sync';
import type { Appointment, LocationKind, SavedLocation } from './types';
import { nowIso, uid } from './util';

let running = false;

const VANCOUVER = { lat: 49.2827, lng: -123.1207 };
const MAX_KM = 120;

const cityKey = (c: string) => c.toLowerCase().replace(/[^a-z]/g, '');

/**
 * Only accept an automatic match when it is plausible: within ~120 km of your home (or Vancouver),
 * and in the same city when both the calendar text and the result name a city.
 * Anything doubtful is left for you to confirm instead of being guessed.
 */
function plausible(r: GeocodeResult, city: string, province: string, home: { lat: number; lng: number } | null): boolean {
  if (province && r.province && r.province !== province) return false;
  if (haversineKm(home ?? VANCOUVER, r) > MAX_KM) return false;
  if (city && r.city && !r.approximate) {
    const a = cityKey(city);
    const b = cityKey(r.city);
    if (a && b && !a.includes(b) && !b.includes(a)) return false;
  }
  if (city && !r.city && !r.approximate && r.displayName && !cityKey(r.displayName).includes(cityKey(city))) return false;
  return true;
}

const KIND_BY_CATEGORY: Record<string, LocationKind> = {
  icbc: 'office',
  imaging: 'lab',
  hospital: 'hospital',
  pharmacy: 'pharmacy',
  general: 'other',
};

/**
 * Finds map positions for calendar locations that contain a street address or postal code.
 * Only the coordinates come from OpenStreetMap; the address fields are copied from the calendar
 * text, never invented. Places created this way are marked "auto-located" until you check them.
 */
export async function autoLocateAppointments(): Promise<number> {
  if (running) return 0;
  running = true;
  try {
    const [appts, locs] = await Promise.all([getAll<Appointment>('appointments'), getAll<SavedLocation>('locations')]);
    const known = new Set(locs.flatMap((l) => l.matchKeys));
    const homeLoc = locs.find((l) => l.kind === 'home' && hasCoords(l));
    const home = homeLoc ? { lat: homeLoc.lat!, lng: homeLoc.lng! } : null;
    const todo = new Map<string, Appointment>();
    for (const a of appts) {
      if (!isActiveAppt(a) || a.locationId || !a.locationRaw.trim()) continue;
      const key = normalizeKey(a.locationRaw);
      if (key && !known.has(key) && !todo.has(key)) todo.set(key, a);
    }
    let created = 0;

    // Saved places (e.g. Home typed in by hand) that have a street address but no map position yet
    for (const l of locs) {
      if (hasCoords(l) || (!l.street && !l.postalCode)) continue;
      const failKey = `autoloc3-place-fail:${l.id}:${normalizeKey(l.street + l.city + l.postalCode)}`;
      if (await cacheGet<boolean>(failKey, 7 * 864e5)) continue;
      let results;
      try {
        results = await geocodeAddress({ name: '', street: l.street, city: l.city, province: l.province, postalCode: l.postalCode });
      } catch {
        return created;
      }
      const g = results.find((r) => plausible(r, l.city, l.province, l.kind === 'home' ? null : home));
      if (!g) {
        await cacheSet(failKey, true);
        continue;
      }
      await put('locations', { ...l, lat: g.lat, lng: g.lng, coordSource: 'geocoded', geocodeLabel: g.displayName, autoLocated: true, updatedAt: nowIso() });
      created++;
    }

    for (const [key, a] of todo) {
      if (await cacheGet<boolean>(`autoloc3-fail:${key}`, 7 * 864e5)) continue;
      const p = parseAddress(a.locationRaw);
      if (!p.street && !p.postalCode && p.name.trim().length < 6) {
        await cacheSet(`autoloc3-fail:${key}`, true);
        continue;
      }
      let results;
      try {
        results = await geocodeAddress({ name: p.street ? '' : p.name, street: p.street, city: p.city, province: p.province, postalCode: p.postalCode });
      } catch {
        break; // offline or rate-limited: try again later
      }
      const g = results.find((r) => plausible(r, p.city, p.province, home)) ?? null;
      if (!g) {
        await cacheSet(`autoloc3-fail:${key}`, true);
        continue;
      }
      const stamp = nowIso();
      const loc: SavedLocation = {
        id: uid(),
        kind: KIND_BY_CATEGORY[a.categoryId] ?? 'clinic',
        name: p.name,
        street: p.street,
        city: p.city,
        province: p.province,
        postalCode: p.postalCode,
        lat: g.lat,
        lng: g.lng,
        coordSource: 'geocoded',
        geocodeLabel: g.displayName,
        matchKeys: [key],
        notes: '',
        autoLocated: true,
        createdAt: stamp,
        updatedAt: stamp,
      };
      await put('locations', loc);
      await applyLocationToMatching(loc);
      created++;
    }
    return created;
  } finally {
    running = false;
  }
}
