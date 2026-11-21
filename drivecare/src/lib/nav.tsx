import { createContext, useContext } from 'react';

export type Tab = 'dashboard' | 'trips' | 'fuel' | 'treatments' | 'reports';
export type TreatmentView = 'appointments' | 'route' | 'clinics';

export interface Nav {
  tab: Tab;
  setTab: (t: Tab) => void;
  openSettings: () => void;
  treatmentView: TreatmentView;
  setTreatmentView: (v: TreatmentView) => void;
  routeDate: string;
  setRouteDate: (d: string) => void;
  openRouteFor: (d: string) => void;
}

export const NavContext = createContext<Nav | null>(null);

export function useNav(): Nav {
  const n = useContext(NavContext);
  if (!n) throw new Error('NavContext missing');
  return n;
}
