import { cacheGet, cacheSet, getAll, put } from './db';
import { normalizeKey, parseAddress } from './address';
import { geocodeAddress } from './geocode';
import { isActiveAppt } from './report';
import { applyLocationToMatching } from './sync';
import type { Appointment, LocationKind, SavedLocation } from './types';
import { nowIso, uid } from './util';

let running = false;

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
    const todo = new Map<string, Appointment>();
    for (const a of appts) {
      if (!isActiveAppt(a) || a.locationId || !a.locationRaw.trim()) continue;
      const key = normalizeKey(a.locationRaw);
      if (key && !known.has(key) && !todo.has(key)) todo.set(key, a);
    }
    let created = 0;
    for (const [key, a] of todo) {
      if (await cacheGet<boolean>(`autoloc2-fail:${key}`, 7 * 864e5)) continue;
      const p = parseAddress(a.locationRaw);
      if (!p.street && !p.postalCode) {
        await cacheSet(`autoloc2-fail:${key}`, true);
        continue;
      }
      let results;
      try {
        results = await geocodeAddress({ name: '', street: p.street, city: p.city, province: p.province, postalCode: p.postalCode });
      } catch {
        break; // offline or rate-limited: try again later
      }
      const g = results.find((r) => !p.province || !r.province || r.province === p.province) ?? null;
      if (!g) {
        await cacheSet(`autoloc2-fail:${key}`, true);
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
