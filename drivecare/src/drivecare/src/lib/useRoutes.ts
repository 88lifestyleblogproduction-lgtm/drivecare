import { useEffect, useRef, useState } from 'react';
import { hasCoords, type LatLng } from './geo';
import { pairKeyOf, type PlanPoint, type SegmentState } from './planner';
import { peekRoute, routeBetween } from './routing';
import type { AppSettings } from './types';
import { errMsg } from './util';

export interface Pair {
  key: string;
  a: LatLng;
  b: LatLng;
}

/** Route pairs (consecutive points at different, mapped places) for a list of plan points. */
export function pairsOf(points: PlanPoint[]): Pair[] {
  const out: Pair[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const from = points[i].location;
    const to = points[i + 1].location;
    const key = pairKeyOf(points[i], points[i + 1]);
    if (!key || !from || !to || from.id === to.id || !hasCoords(from) || !hasCoords(to)) continue;
    out.push({ key, a: { lat: from.lat!, lng: from.lng! }, b: { lat: to.lat!, lng: to.lng! } });
  }
  return out;
}

/** Loads cached routes for the given pairs (no network) and calculates missing ones on request. */
export function useRouteResults(pairs: Pair[], settings: AppSettings) {
  const [results, setResults] = useState<Map<string, SegmentState>>(new Map());
  const resultsRef = useRef(results);
  resultsRef.current = results;
  const sig = [...new Set(pairs.map((p) => p.key))].sort().join('|') + settings.routingProvider;

  useEffect(() => {
    let alive = true;
    (async () => {
      for (const p of pairs) {
        if (resultsRef.current.get(p.key)?.result) continue;
        const r = await peekRoute(p.a, p.b, settings);
        if (r && alive) setResults((m) => new Map(m).set(p.key, { result: r }));
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  async function calculate(list: Pair[]): Promise<number> {
    let failures = 0;
    for (const p of list) {
      if (resultsRef.current.get(p.key)?.result) continue;
      setResults((m) => new Map(m).set(p.key, { loading: true }));
      try {
        const r = await routeBetween(p.a, p.b, settings);
        setResults((m) => new Map(m).set(p.key, { result: r }));
      } catch (e) {
        failures++;
        setResults((m) => new Map(m).set(p.key, { error: errMsg(e) }));
      }
    }
    return failures;
  }

  return { results, calculate };
}
