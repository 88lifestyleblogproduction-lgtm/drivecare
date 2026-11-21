import type { SavedLocation } from './types';

export const PROVINCES: Record<string, string> = {
  BC: 'British Columbia',
  AB: 'Alberta',
  SK: 'Saskatchewan',
  MB: 'Manitoba',
  ON: 'Ontario',
  QC: 'Quebec',
  NB: 'New Brunswick',
  NS: 'Nova Scotia',
  PE: 'Prince Edward Island',
  NL: 'Newfoundland and Labrador',
  YT: 'Yukon',
  NT: 'Northwest Territories',
  NU: 'Nunavut',
};

export function provinceCode(text: string): string | null {
  const t = text.trim().toLowerCase().replace(/\./g, '');
  for (const [code, name] of Object.entries(PROVINCES)) {
    if (t === code.toLowerCase() || t === name.toLowerCase()) return code;
  }
  return null;
}

export interface ParsedAddress {
  name: string;
  street: string;
  city: string;
  province: string;
  postalCode: string;
  complete: boolean;
}

const POSTAL_RE = /\b([ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z])\s?(\d[ABCEGHJ-NPRSTV-Z]\d)\b/i;
const STREET_RE = /^\s*(?:(?:#|unit|suite|ste\.?)\s*[\w-]+\s*[-,]?\s*)?\d+[a-z]?(?:\s*-\s*\d+[a-z]?)?\s+\S+/i;
const SUITE_RE = /^(suite|unit|ste\.?|#|floor|fl\.?|room|rm\.?)\b/i;
const PROVINCE_WORDS = Object.entries(PROVINCES)
  .flatMap(([c, n]) => [n, c])
  .sort((a, b) => b.length - a.length);

/**
 * Splits a free-text calendar location into address parts.
 * It only reorganises text that is actually present — nothing is invented.
 */
export function parseAddress(raw: string): ParsedAddress {
  const out: ParsedAddress = { name: '', street: '', city: '', province: '', postalCode: '', complete: false };
  let s = (raw || '').replace(/\s+/g, ' ').trim();
  if (!s) return out;
  s = s.replace(/,?\s*canada\s*$/i, '');

  const pm = s.match(POSTAL_RE);
  if (pm) {
    out.postalCode = `${pm[1]} ${pm[2]}`.toUpperCase();
    s = s.replace(pm[0], ' ');
  }

  let parts = s
    .split(/[,\n]/)
    .map((p) => p.trim())
    .filter(Boolean);

  // Province: search from the end
  for (let i = parts.length - 1; i >= 0 && !out.province; i--) {
    const part = parts[i];
    for (const word of PROVINCE_WORDS) {
      const re = new RegExp(`(^|\\s)${word.replace(/\./g, '\\.')}\\.?$`, 'i');
      if (re.test(part)) {
        out.province = provinceCode(word) ?? '';
        const rest = part.replace(re, '').trim();
        if (rest) {
          parts[i] = rest;
          if (!out.city && i > 0 && !STREET_RE.test(rest)) out.city = rest;
        } else {
          parts.splice(i, 1);
        }
        break;
      }
    }
  }
  if (out.city) parts = parts.filter((p) => p !== out.city);

  const streetIdx = parts.findIndex((p) => STREET_RE.test(p));
  if (streetIdx >= 0) {
    let street = parts[streetIdx];
    let after = streetIdx + 1;
    if (parts[after] && SUITE_RE.test(parts[after])) {
      street = `${parts[after]}, ${street}`;
      after++;
    }
    if (streetIdx > 0 && SUITE_RE.test(parts[streetIdx - 1])) {
      street = `${parts[streetIdx - 1]}, ${street}`;
      out.name = parts.slice(0, streetIdx - 1).join(', ');
    } else {
      out.name = parts.slice(0, streetIdx).join(', ');
    }
    out.street = street;
    if (!out.city && parts[after]) out.city = parts[after];
  } else if (parts.length) {
    out.name = parts[0];
    if (!out.city && parts.length > 1) out.city = parts[parts.length - 1];
  }

  out.complete = !!(out.street && out.city && out.province);
  return out;
}

export function formatAddress(l: Pick<SavedLocation, 'street' | 'city' | 'province' | 'postalCode'>): string {
  const region = [l.province, l.postalCode].filter(Boolean).join(' ');
  return [l.street, l.city, region].filter(Boolean).join(', ');
}

export function locationTitle(l: SavedLocation): string {
  return l.name || l.street || 'Unnamed place';
}

export function isAddressComplete(l: Pick<SavedLocation, 'street' | 'city' | 'province'>): boolean {
  return !!(l.street && l.city && l.province);
}

/** Normalised key used to recognise the same calendar location text again. */
export function normalizeKey(raw: string): string {
  return (raw || '')
    .toLowerCase()
    .replace(/,?\s*canada\s*$/i, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export const titleKey = (summary: string) => `title:${normalizeKey(summary)}`;

export function isValidPostal(pc: string): boolean {
  return !pc || /^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z] ?\d[ABCEGHJ-NPRSTV-Z]\d$/i.test(pc.trim());
}

export function googleMapsUrl(query: string, lat?: number | null, lng?: number | null): string {
  const dest = query || (lat != null && lng != null ? `${lat},${lng}` : '');
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}&travelmode=driving`;
}
