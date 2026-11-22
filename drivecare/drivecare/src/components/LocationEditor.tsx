import { useEffect, useState } from 'react';
import { Badge, Banner, Button, Field, List, Row, Select, Sheet, Spinner, TextArea, TextInput, Toggle, useToast } from './ui';
import MapView from './MapView';
import { geocodeAddress, type GeocodeResult } from '../lib/geocode';
import { formatAddress, isValidPostal, locationTitle, PROVINCES } from '../lib/address';
import { put, remove } from '../lib/db';
import { applyLocationToMatching } from '../lib/sync';
import { saveSettings } from '../lib/settings';
import { useData } from '../lib/data';
import { hasCoords } from '../lib/geo';
import type { LocationKind, SavedLocation } from '../lib/types';
import { errMsg, nowIso, uid } from '../lib/util';

export interface LocationDraft {
  id?: string;
  kind?: LocationKind;
  name?: string;
  street?: string;
  city?: string;
  province?: string;
  postalCode?: string;
  lat?: number | null;
  lng?: number | null;
  matchKeys?: string[];
  notes?: string;
}

const KIND_OPTIONS: { value: LocationKind; label: string }[] = [
  { value: 'clinic', label: 'Clinic / provider' },
  { value: 'hospital', label: 'Hospital' },
  { value: 'lab', label: 'Lab / imaging' },
  { value: 'pharmacy', label: 'Pharmacy' },
  { value: 'office', label: 'Office (ICBC, lawyer, assessor…)' },
  { value: 'home', label: 'Home' },
  { value: 'work', label: 'Work' },
  { value: 'other', label: 'Other place' },
];

export const KIND_LABEL: Record<LocationKind, string> = {
  clinic: 'Clinic',
  hospital: 'Hospital',
  lab: 'Lab',
  pharmacy: 'Pharmacy',
  office: 'Office',
  home: 'Home',
  work: 'Work',
  other: 'Place',
};
export const KIND_ORDER: Record<LocationKind, number> = { home: 0, work: 1, clinic: 2, hospital: 3, lab: 4, pharmacy: 5, office: 6, other: 7 };

export default function LocationEditor({
  open,
  draft,
  onClose,
  onSaved,
  sourceText,
  matchKey,
  titleMatch,
}: {
  open: boolean;
  draft: LocationDraft | null;
  onClose: () => void;
  onSaved?: (loc: SavedLocation) => void;
  /** The original calendar location text, shown for reference */
  sourceText?: string;
  /** Normalised calendar location key to remember */
  matchKey?: string;
  /** Title key ("title:…") to optionally remember */
  titleMatch?: { key: string; summary: string };
}) {
  const { locations, settings } = useData();
  const toast = useToast();
  const existing = draft?.id ? locations.find((l) => l.id === draft.id) : undefined;
  const [f, setF] = useState<Required<Omit<LocationDraft, 'id'>>>(blank());
  const [rememberKey, setRememberKey] = useState(true);
  const [rememberTitle, setRememberTitle] = useState(false);
  const [coordSource, setCoordSource] = useState<SavedLocation['coordSource']>(null);
  const [geocodeLabel, setGeocodeLabel] = useState('');
  const [results, setResults] = useState<GeocodeResult[] | null>(null);
  const [busy, setBusy] = useState<'' | 'geo' | 'gps' | 'save'>('');
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState('');

  useEffect(() => {
    if (!open) return;
    const d = draft ?? {};
    setF({
      kind: d.kind ?? existing?.kind ?? 'clinic',
      name: d.name ?? existing?.name ?? '',
      street: d.street ?? existing?.street ?? '',
      city: d.city ?? existing?.city ?? '',
      province: d.province ?? existing?.province ?? 'BC',
      postalCode: d.postalCode ?? existing?.postalCode ?? '',
      lat: d.lat ?? existing?.lat ?? null,
      lng: d.lng ?? existing?.lng ?? null,
      matchKeys: existing?.matchKeys ?? d.matchKeys ?? [],
      notes: d.notes ?? existing?.notes ?? '',
    });
    setCoordSource(existing?.coordSource ?? null);
    setGeocodeLabel(existing?.geocodeLabel ?? '');
    setResults(null);
    setError(null);
    setRememberKey(true);
    setRememberTitle(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, draft]);

  const set = (patch: Partial<typeof f>) => setF((x) => ({ ...x, ...patch }));
  const addr = formatAddress(f);

  async function find() {
    setError(null);
    setBusy('geo');
    try {
      setResults(null);
      const r = await geocodeAddress(f, (label) => setSearching(label));
      setResults(r);
      if (!r.length) setError('No match found on OpenStreetMap. Tap the map to place the pin yourself — zoom in with two fingers, then tap the building.');
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy('');
      setSearching('');
    }
  }

  function chooseResult(r: GeocodeResult) {
    set({
      lat: r.lat,
      lng: r.lng,
      street: f.street || r.street,
      city: f.city || r.city,
      province: f.province || r.province,
      postalCode: f.postalCode || r.postalCode,
    });
    setCoordSource('geocoded');
    setGeocodeLabel(r.displayName);
    setResults(null);
  }

  function useGps() {
    setError(null);
    setBusy('gps');
    navigator.geolocation.getCurrentPosition(
      (p) => {
        set({ lat: p.coords.latitude, lng: p.coords.longitude });
        setCoordSource('gps');
        setGeocodeLabel(`Current location (±${Math.round(p.coords.accuracy)} m)`);
        setBusy('');
      },
      (e) => {
        setError(e.code === e.PERMISSION_DENIED ? 'Location permission denied.' : 'Could not get your location.');
        setBusy('');
      },
      { enableHighAccuracy: true, timeout: 20000 }
    );
  }

  async function save() {
    setError(null);
    if (!f.name.trim() && !f.street.trim()) return setError('Enter a name or a street address.');
    if (!isValidPostal(f.postalCode)) return setError('Postal code should look like V5K 0A1.');
    setBusy('save');
    try {
      const keys = new Set(f.matchKeys);
      if (matchKey && rememberKey) keys.add(matchKey);
      if (titleMatch && rememberTitle) keys.add(titleMatch.key);
      const stamp = nowIso();
      const loc: SavedLocation = {
        id: existing?.id ?? uid(),
        kind: f.kind,
        name: f.name.trim(),
        street: f.street.trim(),
        city: f.city.trim(),
        province: f.province.trim(),
        postalCode: f.postalCode.trim().toUpperCase(),
        lat: f.lat,
        lng: f.lng,
        coordSource: hasCoords(f) ? coordSource ?? 'map' : null,
        geocodeLabel,
        matchKeys: [...keys],
        notes: f.notes,
        autoLocated: false,
        createdAt: existing?.createdAt ?? stamp,
        updatedAt: stamp,
      };
      await put('locations', loc);
      if (loc.kind === 'home' && !settings.homeLocationId) await saveSettings({ homeLocationId: loc.id });
      if (loc.kind === 'work' && !settings.workLocationId) await saveSettings({ workLocationId: loc.id });
      const linked = await applyLocationToMatching(loc);
      toast(linked > 0 ? `Saved · linked ${linked} more appointment${linked > 1 ? 's' : ''}` : 'Place saved');
      onSaved?.(loc);
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy('');
    }
  }

  async function del() {
    if (!existing) return;
    if (!confirm(`Delete “${locationTitle(existing)}”? Appointments linked to it will show as unconfirmed again.`)) return;
    await remove('locations', existing.id);
    const patch: Record<string, null> = {};
    if (settings.homeLocationId === existing.id) patch.homeLocationId = null;
    if (settings.workLocationId === existing.id) patch.workLocationId = null;
    if (Object.keys(patch).length) await saveSettings(patch);
    toast('Place deleted');
    onClose();
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={existing ? 'Edit place' : 'New place'}
      right={
        <button type="button" className="font-semibold text-accent disabled:opacity-40" disabled={!!busy} onClick={() => void save()}>
          {busy === 'save' ? <Spinner /> : 'Save'}
        </button>
      }
    >
      {sourceText && (
        <Banner tone="info" title="From Google Calendar">
          <span className="break-words">{sourceText}</span>
          <div className="mt-1 text-[13px] text-muted">Check the details below. Nothing is filled in that isn’t in the calendar entry or confirmed by you.</div>
        </Banner>
      )}
      {error && <Banner tone="error">{error}</Banner>}

      <List>
        <Field label="Type">
          <Select value={f.kind} onChange={(v) => set({ kind: v as LocationKind })} options={KIND_OPTIONS} />
        </Field>
        <Field label="Name (clinic, provider, office or place)">
          <TextInput value={f.name} onChange={(v) => set({ name: v })} placeholder="e.g. Kitsilano Physiotherapy" />
        </Field>
        <Field label="Street address">
          <TextInput value={f.street} onChange={(v) => set({ street: v })} placeholder="e.g. Suite 200, 2525 W Broadway" />
        </Field>
        <Field label="City">
          <TextInput value={f.city} onChange={(v) => set({ city: v })} placeholder="Vancouver" />
        </Field>
        <div className="grid grid-cols-2 divide-x divide-line">
          <Field label="Province">
            <Select value={f.province} onChange={(v) => set({ province: v })} options={[{ value: '', label: '—' }, ...Object.keys(PROVINCES).map((c) => ({ value: c, label: c }))]} />
          </Field>
          <Field label="Postal code">
            <TextInput value={f.postalCode} onChange={(v) => set({ postalCode: v.toUpperCase() })} placeholder="V6K 2E9" />
          </Field>
        </div>
      </List>

      <section className="space-y-2">
        <div className="flex flex-wrap gap-2">
          <Button small variant="tinted" onClick={() => void find()} disabled={!!busy}>
            {busy === 'geo' ? <Spinner size={14} /> : null} {busy === 'geo' && searching ? `Searching ${searching}…` : 'Find on map'}
          </Button>
          <Button small variant="secondary" onClick={useGps} disabled={!!busy}>
            {busy === 'gps' ? <Spinner size={14} /> : null} Use my current location
          </Button>
        </div>
        {results && results.length > 0 && (
          <List>
            {results.map((r, i) => (
              <Row key={i} title={<span className="whitespace-normal">{r.displayName}</span>} onClick={() => chooseResult(r)} />
            ))}
          </List>
        )}
        <MapView
          height={220}
          markers={hasCoords(f) ? [{ lat: f.lat!, lng: f.lng!, text: '•', label: f.name || addr }] : []}
          onPick={(lat, lng) => {
            set({ lat, lng });
            setCoordSource('map');
            setGeocodeLabel('Pin placed on map');
          }}
        />
        <p className="px-1 text-[12px] leading-snug text-muted">
          {hasCoords(f) ? (
            <>
              Map position set{geocodeLabel ? ` · ${geocodeLabel}` : ''}. Tap the map to adjust the pin.
            </>
          ) : (
            'No map position yet. Use “Find on map” or tap the map to place the pin. A position is needed to calculate driving distances.'
          )}{' '}
          Address search uses OpenStreetMap Nominatim (the text you search is sent to that service).
        </p>
      </section>

      {(matchKey || titleMatch) && (
        <List>
          {matchKey && (
            <Toggle checked={rememberKey} onChange={setRememberKey} label="Use for future appointments" hint="Appointments with the same calendar location text will link here automatically." />
          )}
          {titleMatch && (
            <Toggle
              checked={rememberTitle}
              onChange={setRememberTitle}
              label="Also match by title"
              hint={`For appointments with no location, titled “${titleMatch.summary}”.`}
            />
          )}
        </List>
      )}

      {f.matchKeys.length > 0 && (
        <section>
          <div className="mb-1.5 px-1 text-[13px] font-semibold text-muted uppercase">Calendar text linked to this place</div>
          <List>
            {f.matchKeys.map((k) => (
              <Row
                key={k}
                title={<span className="text-[14px]">{k.startsWith('title:') ? `Title: ${k.slice(6)}` : k}</span>}
                right={
                  <button type="button" className="text-[14px] text-bad" onClick={() => set({ matchKeys: f.matchKeys.filter((x) => x !== k) })}>
                    Remove
                  </button>
                }
              />
            ))}
          </List>
        </section>
      )}

      <List>
        <Field label="Notes">
          <TextArea value={f.notes} onChange={(v) => set({ notes: v })} rows={2} placeholder="Parking, entrance, phone…" />
        </Field>
      </List>

      {existing && (
        <Button variant="danger" full onClick={() => void del()}>
          Delete place
        </Button>
      )}
      {existing && <div className="text-center text-[12px] text-muted">{existing.coordSource ? <Badge>{existing.coordSource}</Badge> : null}</div>}
    </Sheet>
  );
}

function blank(): Required<Omit<LocationDraft, 'id'>> {
  return { kind: 'clinic', name: '', street: '', city: '', province: 'BC', postalCode: '', lat: null, lng: null, matchKeys: [], notes: '' };
}

export function LocationSelect({
  value,
  onChange,
  locations,
  allowNone = true,
  noneLabel = 'Not set',
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  locations: SavedLocation[];
  allowNone?: boolean;
  noneLabel?: string;
}) {
  const opts = [...locations]
    .sort((a, b) => (KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9) || locationTitle(a).localeCompare(locationTitle(b)))
    .map((l) => ({ value: l.id, label: `${KIND_LABEL[l.kind] ?? 'Place'} · ${locationTitle(l)}${hasCoords(l) ? '' : ' (no map position)'}` }));
  return <Select value={value ?? ''} onChange={(v) => onChange(v || null)} options={[...(allowNone ? [{ value: '', label: noneLabel }] : []), ...opts]} />;
}
