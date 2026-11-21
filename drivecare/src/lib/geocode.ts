import { cacheGet, cacheSet } from './db';
import { fetchWithTimeout, throttled } from './net';
import { normalizeKey, provinceCode } from './address';

/**
 * Geocoding uses the public OpenStreetMap Nominatim service:
 *  - max 1 request per second, no bulk/automatic geocoding, attribution required
 *  - the address text you search is sent to nominatim.openstreetmap.org
 * We only geocode when the user taps "Find", and results are cached locally.
 */
export interface GeocodeResult {
  lat: number;
  lng: number;
  displayName: string;
  street: string;
  city: string;
  province: string;
  postalCode: string;
}

interface NominatimItem {
  lat: string;
  lon: string;
  display_name: string;
  address?: Record<string, string>;
}

const TTL = 90 * 864e5;

export async function geocode(query: string): Promise<GeocodeResult[]> {
  const q = query.trim();
  if (!q) return [];
  const key = `geo:${normalizeKey(q)}`;
  const cached = await cacheGet<GeocodeResult[]>(key, TTL);
  if (cached) return cached;

  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=5&countrycodes=ca&q=${encodeURIComponent(q)}`;
  const res = await throttled('nominatim', 1100, () => fetchWithTimeout(url, { headers: { Accept: 'application/json', 'Accept-Language': 'en' } }));
  if (res.status === 429) throw new Error('Geocoding rate limit reached. Wait a minute and try again, or drop a pin on the map.');
  if (!res.ok) throw new Error(`Geocoding failed (HTTP ${res.status}). You can drop a pin on the map instead.`);
  const items = (await res.json()) as NominatimItem[];
  const out = items.map((it): GeocodeResult => {
    const a = it.address ?? {};
    const street = [a.house_number, a.road].filter(Boolean).join(' ');
    return {
      lat: Number(it.lat),
      lng: Number(it.lon),
      displayName: it.display_name,
      street,
      city: a.city || a.town || a.village || a.municipality || a.city_district || '',
      province: provinceCode(a.state ?? '') ?? '',
      postalCode: (a.postcode ?? '').toUpperCase(),
    };
  });
  await cacheSet(key, out);
  return out;
}
