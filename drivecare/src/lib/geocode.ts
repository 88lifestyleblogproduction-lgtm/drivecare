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
  /** Only the postal area is known (first 3 characters) — position may be off by a few km */
  approximate?: boolean;
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
  return search({ q });
}

async function search(params: Record<string, string>): Promise<GeocodeResult[]> {
  const key = `geo:${normalizeKey(JSON.stringify(params))}`;
  const cached = await cacheGet<GeocodeResult[]>(key, TTL);
  if (cached && cached.length) return cached;

  const qs = new URLSearchParams({ format: 'jsonv2', addressdetails: '1', limit: '5', countrycodes: 'ca', ...params });
  const url = `https://nominatim.openstreetmap.org/search?${qs.toString()}`;
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
  if (out.length) await cacheSet(key, out);
  return out;
}

/** Removes suite/unit parts that OpenStreetMap search does not understand. */
export function cleanStreet(street: string): string {
  let s = street.trim();
  s = s.replace(/^(suite|unit|ste\.?|#|apt\.?|room|rm\.?|floor|fl\.?)\s*[\w-]+\s*[,-]?\s*/i, '');
  s = s.replace(/,?\s*(suite|unit|ste\.?|#|apt\.?|room|rm\.?)\s*[\w-]+\s*$/i, '');
  s = s.replace(/^\d+[a-z]?\s*-\s*(?=\d)/i, ''); // "200-555 W 8th Ave" -> "555 W 8th Ave"
  return s.trim();
}

const ABBR: [RegExp, string][] = [
  [/\bW\.?(?=\s)/i, 'West'],
  [/\bE\.?(?=\s)/i, 'East'],
  [/\bN\.?(?=\s)/i, 'North'],
  [/\bS\.?(?=\s)/i, 'South'],
  [/\bAve\.?\b/i, 'Avenue'],
  [/\bSt\.?$/i, 'Street'],
  [/\bRd\.?\b/i, 'Road'],
  [/\bBlvd\.?\b/i, 'Boulevard'],
  [/\bDr\.?$/i, 'Drive'],
  [/\bHwy\.?\b/i, 'Highway'],
];

function expandStreet(s: string): string {
  let out = s;
  for (const [re, full] of ABBR) out = out.replace(re, full);
  return out;
}

export interface AddressParts {
  name: string;
  street: string;
  city: string;
  province: string;
  postalCode: string;
}

/**
 * Tries several search styles until one finds a match:
 * street without suite → spelled-out street → structured search → place name → postal code.
 * Each attempt is a separate request (max 1 per second, per the Nominatim policy).
 */
export async function geocodeAddress(p: AddressParts, onAttempt?: (label: string) => void): Promise<GeocodeResult[]> {
  const street = cleanStreet(p.street);
  const prov = p.province === 'BC' || !p.province ? 'British Columbia' : p.province;
  const attempts: { label: string; params: Record<string, string> }[] = [];
  const seen = new Set<string>();
  const add = (label: string, params: Record<string, string>) => {
    const k = JSON.stringify(params);
    if (seen.has(k)) return;
    seen.add(k);
    attempts.push({ label, params });
  };
  if (street) {
    add('street address', { q: [street, p.city, prov].filter(Boolean).join(', ') });
    const exp = expandStreet(street);
    if (exp !== street) add('full street name', { q: [exp, p.city, prov].filter(Boolean).join(', ') });
    add('structured search', { street: exp, ...(p.city ? { city: p.city } : {}), state: prov, country: 'Canada' });
  }
  if (p.name) add('place name', { q: [p.name, p.city || 'Vancouver', prov].join(', ') });
  if (p.postalCode) add('postal code', { postalcode: p.postalCode.replace(/\s+/g, ' ').toUpperCase(), country: 'Canada' });
  if (!attempts.length) throw new Error('Enter a street address or a place name first.');
  for (const a of attempts) {
    onAttempt?.(a.label);
    const r = await search(a.params);
    if (r.length) return r;
  }

  // Government of Canada geolocation (Natural Resources Canada): street addresses across Canada.
  const full = [street, p.city, p.province || 'BC'].filter(Boolean).join(', ');
  if (street) {
    onAttempt?.('Canada address service');
    const r = await searchCanada(full);
    if (r.length) return r;
  }
  if (p.name) {
    onAttempt?.('Canada place search');
    const r = await searchCanada([p.name, p.city].filter(Boolean).join(', '));
    if (r.length) return r;
  }
  // Last resort: postal area (first 3 characters of the postal code). Approximate.
  const fsa = p.postalCode.replace(/\s+/g, '').slice(0, 3).toUpperCase();
  if (/^[A-Z]\d[A-Z]$/.test(fsa)) {
    onAttempt?.('postal area');
    const r = await searchCanada(fsa);
    if (r.length) return r.map((x) => ({ ...x, approximate: true, displayName: `Approximate — postal area ${fsa} (${x.displayName})` }));
  }
  return [];
}

/**
 * Natural Resources Canada geolocation services (free, no key). Tries the newer Geolocator API and
 * the older Geolocation service (which NRCan says stops on 31 March 2027). Responses are read
 * defensively because the two services use different formats.
 */
async function searchCanada(q: string): Promise<GeocodeResult[]> {
  const key = `geoca:${normalizeKey(q)}`;
  const cached = await cacheGet<GeocodeResult[]>(key, TTL);
  if (cached && cached.length) return cached;
  const urls = [
    `https://geolocator.api.geo.ca/?q=${encodeURIComponent(q)}&lang=en`,
    `https://geogratis.gc.ca/services/geolocation/en/locate?q=${encodeURIComponent(q)}`,
  ];
  for (const url of urls) {
    try {
      const res = await throttled('nrcan', 500, () => fetchWithTimeout(url, { headers: { Accept: 'application/json' } }, 12000));
      if (!res.ok) continue;
      const out = readCanada(await res.json()).filter((r) => r.lat > 41 && r.lat < 84 && r.lng > -142 && r.lng < -52);
      if (out.length) {
        await cacheSet(key, out);
        return out;
      }
    } catch {
      /* try the next service */
    }
  }
  return [];
}

function num(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : null;
}

function readCanada(json: unknown): GeocodeResult[] {
  const list: unknown[] = Array.isArray(json)
    ? json
    : json && typeof json === 'object'
      ? ((json as Record<string, unknown>).results as unknown[]) ?? ((json as Record<string, unknown>).features as unknown[]) ?? ((json as Record<string, unknown>).items as unknown[]) ?? []
      : [];
  const out: GeocodeResult[] = [];
  for (const it of list.slice(0, 5)) {
    if (!it || typeof it !== 'object') continue;
    const o = it as Record<string, unknown>;
    let lat = num(o.lat ?? o.latitude ?? o.y);
    let lng = num(o.lng ?? o.lon ?? o.longitude ?? o.x);
    const geom = o.geometry as { coordinates?: unknown[] } | undefined;
    if ((lat == null || lng == null) && geom?.coordinates && geom.coordinates.length >= 2) {
      lng = num(geom.coordinates[0]);
      lat = num(geom.coordinates[1]);
    }
    if (lat == null || lng == null) continue;
    const props = (o.properties as Record<string, unknown>) ?? {};
    const title = String(o.title ?? o.name ?? props.title ?? props.name ?? o.description ?? 'Location found');
    out.push({ lat, lng, displayName: title, street: '', city: '', province: '', postalCode: '' });
  }
  return out;
}
