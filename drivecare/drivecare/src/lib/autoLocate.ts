import { cacheGet, cacheSet, getAll, put } from './db';
import { normalizeKey, parseAddress } from './address';
import { geocodeAddress } from './geocode';
import { hasCoords } from './geo';
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

    // Saved places (e.g. Home typed in by hand) that have a street address but no map position yet
    for (const l of locs) {
      if (hasCoords(l) || (!l.street && !l.postalCode)) continue;
      const failKey = `autoloc2-place-fail:${l.id}:${normalizeKey(l.street + l.city + l.postalCode)}`;
      if (await cacheGet<boolean>(failKey, 7 * 864e5)) continue;
      let results;
      try {
        results = await geocodeAddress({ name: '', street: l.street, city: l.city, province: l.province, postalCode: l.postalCode });
      } catch {
        return created;
      }
      const g = results.find((r) => !l.province || !r.province || r.province === l.province);
      if (!g) {
        await cacheSet(failKey, true);
        continue;
      }
      await put('locations', { ...l, lat: g.lat, lng: g.lng, coordSource: 'geocoded', geocodeLabel: g.displayName, autoLocated: true, updatedAt: nowIso() });
      created++;
    }

    for (const [key, a] of todo) {
      if (await cacheGet<boolean>(`autoloc2-fail:${key}`, 7 * 864e5)) continue;
      const p = parseAddress(a.locationRaw);
      if (!p.street && !p.postalCode && p.name.trim().length < 6) {
        await cacheSet(`autoloc2-fail:${key}`, true);
        continue;
      }
      let results;
      try {
        results = await geocodeAddress({ name: p.street ? '' : p.name, street: p.street, city: p.city, province: p.province, postalCode: p.postalCode });
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
