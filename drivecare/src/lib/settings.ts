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
    id: 'chiro',
    label: 'Chiropractic',
    keywords: ['chiropractic', 'chiropractor', 'chiro'],
    builtIn: true,
    color: '#a2845e',
  },
  {
    id: 'ot',
    label: 'Occupational Therapy',
    keywords: ['occupational therapy', 'occupational therapist'],
    builtIn: true,
    color: '#64d2ff',
  },
  {
    id: 'counselling',
    label: 'Counselling / Psychology',
    keywords: ['counselling', 'counseling', 'counsellor', 'counselor', 'psychologist', 'psychology', 'psychotherapy', 'clinical counsellor'],
    builtIn: true,
    color: '#5e5ce6',
  },
  {
    id: 'imaging',
    label: 'Imaging / Lab tests',
    keywords: ['x-ray', 'xray', 'mri', 'ct scan', 'ultrasound', 'imaging', 'blood test', 'lab test', 'lifelabs', 'bloodwork'],
    builtIn: true,
    color: '#8e8e93',
  },
  {
    id: 'hospital',
    label: 'Hospital / Surgery',
    keywords: ['hospital', 'surgery', 'emergency', 'day surgery', 'pre-op', 'post-op'],
    builtIn: true,
    color: '#ff453a',
  },
  {
    id: 'pharmacy',
    label: 'Pharmacy',
    keywords: ['pharmacy', 'pharmacist', 'prescription pickup'],
    builtIn: true,
    color: '#32ade6',
  },
  {
    id: 'icbc',
    label: 'ICBC / Legal / Assessment',
    keywords: ['icbc', 'adjuster', 'lawyer', 'independent medical', 'ime'],
    builtIn: true,
    color: '#ffd60a',
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
  workDays: [],
  workdayStart: 'work',
  workdayEnd: 'home',
  lastBackupAt: null,
};

export function withDefaults(s: Partial<AppSettings> | undefined): AppSettings {
  const merged: AppSettings = { ...DEFAULT_SETTINGS, ...(s ?? {}), id: 'app' };
  if (!Array.isArray(merged.categories) || merged.categories.length === 0) merged.categories = DEFAULT_CATEGORIES;
  else merged.categories = addMissingDefaults(merged.categories);
  if (!Array.isArray(merged.workDays)) merged.workDays = [];
  return merged;
}

/** New built-in types added in later versions are inserted in their default position. */
function addMissingDefaults(cats: CategoryDef[]): CategoryDef[] {
  const out = [...cats];
  const have = new Set(out.map((c) => c.id));
  DEFAULT_CATEGORIES.forEach((d, i) => {
    if (have.has(d.id)) return;
    const laterIds = new Set(DEFAULT_CATEGORIES.slice(i + 1).map((x) => x.id));
    const idx = out.findIndex((c) => laterIds.has(c.id));
    if (idx < 0) out.push(d);
    else out.splice(idx, 0, d);
    have.add(d.id);
  });
  return out;
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
