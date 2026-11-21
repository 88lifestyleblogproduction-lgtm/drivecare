import type { SavedLocation } from './types';

export interface LatLng {
  lat: number;
  lng: number;
}

export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371.0088;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function hasCoords(l: { lat: number | null; lng: number | null } | null | undefined): l is { lat: number; lng: number } {
  return !!l && typeof l.lat === 'number' && typeof l.lng === 'number' && Number.isFinite(l.lat) && Number.isFinite(l.lng);
}

/** Nearest saved location within `maxMeters`, if any. */
export function nearestLocation(p: LatLng, locations: SavedLocation[], maxMeters = 250): SavedLocation | null {
  let best: SavedLocation | null = null;
  let bestD = Infinity;
  for (const l of locations) {
    if (!hasCoords(l)) continue;
    const d = haversineKm(p, l) * 1000;
    if (d < bestD) {
      bestD = d;
      best = l;
    }
  }
  return best && bestD <= maxMeters ? best : null;
}

export function polylineKm(points: [number, number, ...number[]][]): number {
  let km = 0;
  for (let i = 1; i < points.length; i++) {
    km += haversineKm({ lat: points[i - 1][0], lng: points[i - 1][1] }, { lat: points[i][0], lng: points[i][1] });
  }
  return km;
}
