import { cacheGet, cacheSet } from './db';
import { fetchWithTimeout, throttled } from './net';
import type { AppSettings } from './types';
import type { LatLng } from './geo';

/**
 * Driving distances come only from a real routing engine. If the engine fails,
 * callers show "Distance unavailable" and let the user type the distance.
 *
 * Providers:
 *  - OSRM public demo server (router.project-osrm.org): no key, "reasonable use" only,
 *    max ~1 request/second, no uptime guarantee. Good enough for a single personal user.
 *  - openrouteservice (api.openrouteservice.org): free key required, daily/minute quotas.
 */
export interface RouteResult {
  km: number;
  durationMin: number;
  geometry: [number, number][];
  provider: string;
  computedAt: string;
}

const TTL = 180 * 864e5;
const r5 = (n: number) => n.toFixed(5);

export function providerName(s: AppSettings): string {
  return s.routingProvider === 'ors' ? 'openrouteservice' : 'OSRM';
}

function routeKey(a: LatLng, b: LatLng, s: AppSettings) {
  return `route:${s.routingProvider}:${r5(a.lat)},${r5(a.lng)}>${r5(b.lat)},${r5(b.lng)}`;
}

/** Returns a previously computed route without making a network request. */
export function peekRoute(a: LatLng, b: LatLng, s: AppSettings): Promise<RouteResult | null> {
  return cacheGet<RouteResult>(routeKey(a, b, s), TTL);
}

export async function routeBetween(a: LatLng, b: LatLng, s: AppSettings): Promise<RouteResult> {
  const provider = s.routingProvider;
  const key = routeKey(a, b, s);
  const cached = await cacheGet<RouteResult>(key, TTL);
  if (cached) return cached;

  const result = provider === 'ors' ? await routeOrs(a, b, s.orsApiKey) : await routeOsrm(a, b, s.osrmUrl);
  await cacheSet(key, result);
  return result;
}

async function routeOsrm(a: LatLng, b: LatLng, base: string): Promise<RouteResult> {
  const root = (base || 'https://router.project-osrm.org').replace(/\/+$/, '');
  const url = `${root}/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=geojson&alternatives=false&steps=false`;
  const res = await throttled(`osrm:${root}`, 1100, () => fetchWithTimeout(url, {}, 20000));
  if (res.status === 429) throw new Error('Routing service rate limit reached.');
  if (!res.ok) throw new Error(`Routing service error (HTTP ${res.status}).`);
  const json = (await res.json()) as {
    code: string;
    message?: string;
    routes?: { distance: number; duration: number; geometry: { coordinates: [number, number][] } }[];
  };
  if (json.code !== 'Ok' || !json.routes?.length) throw new Error(json.message || `No route found (${json.code}).`);
  const r = json.routes[0];
  return {
    km: r.distance / 1000,
    durationMin: r.duration / 60,
    geometry: r.geometry.coordinates.map(([lng, lat]) => [lat, lng] as [number, number]),
    provider: 'OSRM',
    computedAt: new Date().toISOString(),
  };
}

async function routeOrs(a: LatLng, b: LatLng, apiKey: string): Promise<RouteResult> {
  if (!apiKey) throw new Error('openrouteservice API key is missing (Settings → Routing).');
  const res = await throttled('ors', 1600, () =>
    fetchWithTimeout(
      'https://api.openrouteservice.org/v2/directions/driving-car/geojson',
      {
        method: 'POST',
        headers: { Authorization: apiKey, 'Content-Type': 'application/json', Accept: 'application/geo+json' },
        body: JSON.stringify({ coordinates: [[a.lng, a.lat], [b.lng, b.lat]] }),
      },
      20000
    )
  );
  if (res.status === 401) throw new Error('openrouteservice rejected the API key.');
  if (res.status === 403) throw new Error('openrouteservice refused the request (invalid key or daily quota of the free plan used up).');
  if (res.status === 429) throw new Error('openrouteservice per-minute limit reached. Wait a minute and retry.');
  if (!res.ok) throw new Error(`openrouteservice error (HTTP ${res.status}).`);
  const json = (await res.json()) as {
    features?: { geometry: { coordinates: [number, number][] }; properties: { summary: { distance?: number; duration?: number } } }[];
  };
  const f = json.features?.[0];
  if (!f) throw new Error('No route found.');
  return {
    km: (f.properties.summary.distance ?? 0) / 1000,
    durationMin: (f.properties.summary.duration ?? 0) / 60,
    geometry: f.geometry.coordinates.map(([lng, lat]) => [lat, lng] as [number, number]),
    provider: 'openrouteservice',
    computedAt: new Date().toISOString(),
  };
}
