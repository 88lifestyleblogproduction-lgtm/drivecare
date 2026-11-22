import { sleep } from './util';

const lastCall = new Map<string, number>();
const chains = new Map<string, Promise<unknown>>();

/** Serialises calls per key and keeps at least `minIntervalMs` between them (provider rate limits). */
export function throttled<T>(key: string, minIntervalMs: number, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(key) ?? Promise.resolve();
  const next = prev
    .catch(() => undefined)
    .then(async () => {
      const wait = (lastCall.get(key) ?? 0) + minIntervalMs - Date.now();
      if (wait > 0) await sleep(wait);
      try {
        return await fn();
      } finally {
        lastCall.set(key, Date.now());
      }
    });
  chains.set(key, next);
  return next;
}

export async function fetchWithTimeout(url: string, init: RequestInit = {}, ms = 15000): Promise<Response> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw new Error('The request timed out.');
    if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('You appear to be offline.');
    throw new Error('Network request failed. The service may be unavailable.');
  } finally {
    clearTimeout(t);
  }
}
