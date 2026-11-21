import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { getAll, subscribe, type StoreName } from './db';
import { withDefaults } from './settings';
import type { AppSettings, Appointment, FuelEntry, RoutePlan, SavedLocation, Trip } from './types';
import { errMsg } from './util';

export interface DataState {
  loaded: boolean;
  error: string | null;
  fuel: FuelEntry[];
  trips: Trip[];
  appointments: Appointment[];
  locations: SavedLocation[];
  routePlans: RoutePlan[];
  settings: AppSettings;
}

const initial: DataState = {
  loaded: false,
  error: null,
  fuel: [],
  trips: [],
  appointments: [],
  locations: [],
  routePlans: [],
  settings: withDefaults(undefined),
};

const Ctx = createContext<DataState>(initial);

type Key = 'fuel' | 'trips' | 'appointments' | 'locations' | 'routePlans' | 'settings';
const KEYS: Key[] = ['fuel', 'trips', 'appointments', 'locations', 'routePlans', 'settings'];

/** Loads all personal records into memory and keeps them in sync with IndexedDB. */
export function DataProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DataState>(initial);

  useEffect(() => {
    let alive = true;
    const load = async (key: Key) => {
      const rows = await getAll<unknown>(key as StoreName);
      if (!alive) return;
      setState((s) => {
        if (key === 'settings') return { ...s, settings: withDefaults((rows as AppSettings[])[0]) };
        return { ...s, [key]: rows } as DataState;
      });
    };
    Promise.all(KEYS.map(load))
      .then(() => alive && setState((s) => ({ ...s, loaded: true })))
      .catch((e) => alive && setState((s) => ({ ...s, loaded: true, error: errMsg(e) })));
    const offs = KEYS.map((k) => subscribe(k as StoreName, () => void load(k).catch(() => undefined)));
    return () => {
      alive = false;
      offs.forEach((f) => f());
    };
  }, []);

  return <Ctx.Provider value={state}>{children}</Ctx.Provider>;
}

export function useData(): DataState {
  return useContext(Ctx);
}
