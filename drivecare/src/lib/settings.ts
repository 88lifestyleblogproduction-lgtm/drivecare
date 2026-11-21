import { get, put } from './db';
import type { AppSettings, CategoryDef } from './types';

/** Order matters: the first category whose keyword matches wins, so more specific ones come first. */
export const DEFAULT_CATEGORIES: CategoryDef[] = [
  {
    id: 'vestibular',
    label: 'Vestibular Therapy',
    keywords: ['vestibular', 'vestibular therapy', 'vestibular rehab', 'vestibular rehabilitation'],
    builtIn: true,
    color: '#af52de',
  },
  {
    id: 'kinesiology',
    label: 'Kinesiology / Active Rehab',
    keywords: ['kinesiology', 'kinesiologist', 'kinesio', 'active rehab', 'active rehabilitation'],
    builtIn: true,
    color: '#ff9f0a',
  },
  {
    id: 'rmt',
    label: 'Registered Massage Therapy',
    keywords: ['rmt', 'registered massage', 'massage therapy', 'massage'],
    builtIn: true,
    color: '#ff375f',
  },
  {
    id: 'acupuncture',
    label: 'Acupuncture',
    keywords: ['acupuncture', 'acupuncturist'],
    builtIn: true,
    color: '#30b0c7',
  },
  {
    id: 'physio',
    label: 'Physiotherapy',
    keywords: ['physiotherapy', 'physiotherapist', 'physio', 'physical therapy', 'pt'],
    builtIn: true,
    color: '#0a84ff',
  },
  {
    id: 'doctor',
    label: 'Doctor / Physician / Specialist',
    keywords: ['doctor', 'physician', 'specialist', 'dr', 'gp', 'physiatrist', 'neurologist'],
    builtIn: true,
    color: '#34c759',
  },
];

export const DEFAULT_SETTINGS: AppSettings = {
  id: 'app',
  googleClientId: '',
  googleConnected: false,
  googleAccountHint: '',
  availableCalendars: [],
  selectedCalendars: [],
  syncPastDays: 120,
  syncFutureDays: 60,
  lastSync: null,
  lastSyncError: null,
  lastSyncSummary: '',
  categories: DEFAULT_CATEGORIES,
  routingProvider: 'osrm',
  osrmUrl: 'https://router.project-osrm.org',
  orsApiKey: '',
  homeLocationId: null,
  workLocationId: null,
  gpsMaxAccuracy: 50,
  theme: 'system',
  lastBackupAt: null,
};

export function withDefaults(s: Partial<AppSettings> | undefined): AppSettings {
  const merged: AppSettings = { ...DEFAULT_SETTINGS, ...(s ?? {}), id: 'app' };
  if (!Array.isArray(merged.categories) || merged.categories.length === 0) merged.categories = DEFAULT_CATEGORIES;
  return merged;
}

export async function loadSettings(): Promise<AppSettings> {
  return withDefaults(await get<AppSettings>('settings', 'app'));
}

export async function saveSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const cur = await loadSettings();
  const next = withDefaults({ ...cur, ...patch });
  await put('settings', next);
  return next;
}

/** The Google OAuth client ID: value saved in the app, else the build-time env var. */
export function effectiveClientId(s: AppSettings): string {
  const env = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) ?? '';
  return (s.googleClientId || env || '').trim();
}

export function categoryById(s: AppSettings, id: string): CategoryDef | undefined {
  return s.categories.find((c) => c.id === id);
}

export function categoryLabel(s: AppSettings, id: string): string {
  return categoryById(s, id)?.label ?? 'Treatment';
}
