import { useEffect, useMemo, useState } from 'react';
import { Badge, Banner, Button, Card, Empty, Field, IconButton, List, NumberInput, Page, Row, Section, Segmented, Select, Sheet, Spinner, TextArea, TextInput, useToast } from '../components/ui';
import { IconPlay, IconPlus, IconStop } from '../components/Icons';
import MapView, { type MapLine, type MapMarker } from '../components/MapView';
import { LocationSelect } from '../components/LocationEditor';
import { useData } from '../lib/data';
import { recorder, type RecorderState } from '../lib/recorder';
import { put, remove } from '../lib/db';
import { availableSources, CATEGORY_LABEL, effectiveKm, kmForSource, newTrip, normaliseSource, SOURCE_LABEL, SOURCE_SHORT } from '../lib/trips';
import { confidenceLabel, suggestMatches } from '../lib/matching';
import { routeBetween } from '../lib/routing';
import { hasCoords } from '../lib/geo';
import { locationTitle } from '../lib/address';
import { categoryLabel } from '../lib/settings';
import { dateKey, fmtDateShort, fmtDuration, fmtKey, fmtTime, fromLocalInput, toLocalInput } from '../lib/time';
import { fmtKm, fmtNum1 } from '../lib/format';
import type { Appointment, DistanceSource, SavedLocation, Trip, TripCategory, TripPoint } from '../lib/types';
import { errMsg, groupBy, nowIso, numStr, parseNum } from '../lib/util';

export function useRecorder(): RecorderState {
  const [s, setS] = useState(recorder.state);
  useEffect(() => recorder.subscribe(() => setS(recorder.state)), []);
  return s;
}

export default function TripsScreen() {
  const { trips, appointments, locations, settings } = useData();
  const rec = useRecorder();
  const toast = useToast();
  const [editId, setEditId] = useState<string | null>(null);
  const [showLimits, setShowLimits] = useState(false);
  const [filter, setFilter] = useState<'all' | 'treatment' | 'review'>('all');
  const locMap = useMemo(() => new Map(locations.map((l) => [l.id, l])), [locations]);

  const interrupted = trips.find((t) => t.recording && t.id !== rec.tripId);
  const finished = trips.filter((t) => !t.recording).sort((a, b) => b.startTime.localeCompare(a.startTime));
  const suggestions = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of finished.slice(0, 200)) {
      if (t.toAppointmentId && t.fromAppointmentId) continue;
      const day = dateKey(t.startTime);
      const cand = appointments.filter((a) => Math.abs(new Date(a.start).getTime() - new Date(t.startTime).getTime()) < 864e5 && dateKey(a.start) === day);
      const s = suggestMatches(t, cand, locMap);
      if (s.length) m.set(t.id, s.length);
    }
    return m;
  }, [finished, appointments, locMap]);

  const shown = finished.filter((t) => (filter === 'treatment' ? !!(t.toAppointmentId || t.fromAppointmentId) || t.category === 'treatment' : filter === 'review' ? suggestions.has(t.id) || effectiveKm(t) == null : true));
  const groups = groupBy(shown, (t) => dateKey(t.startTime));

  async function start() {
    try {
      await recorder.start(settings.gpsMaxAccuracy);
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  }
  async function stop() {
    const id = await recorder.stop(locations);
    if (id) {
      toast('Trip saved — review the details');
      setEditId(id);
    }
  }
  async function resume(t: Trip) {
    try {
      await recorder.resume(t.id, settings.gpsMaxAccuracy);
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  }
  async function finishInterrupted(t: Trip) {
    await recorder.resume(t.id, settings.gpsMaxAccuracy).catch(() => undefined);
    await stop();
  }

  return (
    <Page
      title="Trips"
      subtitle="Record or log your driving"
      right={
        <IconButton label="Add trip manually" onClick={() => setEditId('new')}>
          <IconPlus />
        </IconButton>
      }
    >
      {rec.active ? (
        <RecorderCard rec={rec} onStop={() => void stop()} />
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <Button onClick={() => void start()} className="py-4">
            <IconPlay size={18} /> Start Trip
          </Button>
          <Button variant="secondary" onClick={() => setEditId('new')} className="py-4">
            <IconPlus size={18} /> Log a trip
          </Button>
        </div>
      )}

      {interrupted && !rec.active && (
        <Banner tone="warn" title="A recording was interrupted">
          Started {fmtDateShort(interrupted.startTime)} at {fmtTime(interrupted.startTime)} · {fmtKm(interrupted.gpsKm ?? 0)} recorded. The app was closed or suspended, so
          distance during the gap was not measured.
          <div className="mt-2 flex gap-2">
            <Button small onClick={() => void resume(interrupted)}>
              Resume
            </Button>
            <Button small variant="secondary" onClick={() => void finishInterrupted(interrupted)}>
              Finish now
            </Button>
          </div>
        </Banner>
      )}

      <Card className="px-4 py-3 text-[13px] leading-relaxed text-muted">
        <button type="button" className="font-semibold text-accent" onClick={() => setShowLimits((v) => !v)}>
          {showLimits ? 'Hide' : 'About'} GPS recording on iPhone
        </button>
        {showLimits && (
          <div className="mt-2 space-y-1.5">
            <p>GPS recording works only while DriveCare is open on screen. iPhone web apps cannot record in the background, after the phone locks, or start automatically with CarPlay.</p>
            <p>DriveCare asks iOS to keep the screen awake while recording (where supported). If the app is closed, the recording can be resumed or finished, but the gap is not measured.</p>
            <p>Alternatives: log trips manually, enter odometer readings, or create estimated trips from appointment addresses in Treatments → Route. Each trip shows whether its distance is GPS-recorded, a routing estimate, odometer, or manually entered.</p>
          </div>
        )}
      </Card>

      <Segmented
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'all', label: 'All' },
          { value: 'treatment', label: 'Treatment' },
          { value: 'review', label: `Needs review${suggestions.size ? ` (${suggestions.size})` : ''}` },
        ]}
      />

      {shown.length === 0 ? (
        <Empty title="No trips" text={filter === 'all' ? 'Start a GPS recording, log a trip manually, or create estimated trips from the treatment route planner.' : 'Nothing here right now.'} />
      ) : (
        [...groups.entries()].map(([day, ts]) => (
          <Section key={day} title={fmtKey(day)} action={<span className="text-[13px] text-muted tabular">{fmtKm(ts.reduce((s, t) => s + (effectiveKm(t) ?? 0), 0))}</span>}>
            <List>
              {ts.map((t) => (
                <TripRow key={t.id} trip={t} hasSuggestion={suggestions.has(t.id)} appointments={appointments} onClick={() => setEditId(t.id)} />
              ))}
            </List>
          </Section>
        ))
      )}

      <TripEditor tripId={editId} onClose={() => setEditId(null)} />
    </Page>
  );
}

function RecorderCard({ rec, onStop }: { rec: RecorderState; onStop: () => void }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const stale = rec.lastFixAt != null && now - rec.lastFixAt > 30000;
  return (
    <Card className="overflow-hidden">
      <div className="bg-gradient-to-br from-[#0a84ff] to-[#30b0c7] px-5 py-4 text-white">
        <div className="flex items-center gap-2 text-[13px] font-semibold tracking-wide uppercase opacity-90">
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-400" /> Recording trip
        </div>
        <div className="mt-2 flex items-end justify-between">
          <div>
            <div className="text-[44px] leading-none font-bold tabular">{fmtNum1(rec.km)}</div>
            <div className="text-[14px] opacity-90">km (GPS)</div>
          </div>
          <div className="text-right">
            <div className="text-[24px] font-semibold tabular">{fmtDuration(now - (rec.startedAt ?? now))}</div>
            <div className="text-[13px] opacity-90">
              {rec.points} points{rec.lastAccuracy != null && ` · ±${Math.round(rec.lastAccuracy)} m`}
            </div>
          </div>
        </div>
      </div>
      <div className="space-y-3 p-4">
        {rec.error && <Banner tone="warn">{rec.error}</Banner>}
        {stale && !rec.error && <Banner tone="warn">No GPS update for {Math.round((now - rec.lastFixAt!) / 1000)} s. Keep DriveCare open and the screen on.</Banner>}
        <div className="text-[12px] text-muted">
          Keep this screen open while driving{rec.wakeLock ? ' — screen will stay awake' : ' — set Auto-Lock to “Never” in iPhone Settings → Display if the screen turns off'}. Do not interact
          with your phone while driving.
        </div>
        <Button variant="danger" full onClick={onStop}>
          <IconStop size={16} /> End Trip
        </Button>
      </div>
    </Card>
  );
}

function TripRow({ trip, hasSuggestion, appointments, onClick }: { trip: Trip; hasSuggestion: boolean; appointments: Appointment[]; onClick: () => void }) {
  const km = effectiveKm(trip);
  const linked = trip.toAppointmentId || trip.fromAppointmentId;
  const appt = linked ? appointments.find((a) => a.id === (trip.toAppointmentId ?? trip.fromAppointmentId)) : undefined;
  return (
    <Row
      onClick={onClick}
      title={
        <span className="flex items-center gap-1.5">
          <span className="truncate">
            {trip.start.label || 'Start'} → {trip.end.label || 'Destination'}
          </span>
        </span>
      }
      subtitle={
        <span className="flex flex-wrap items-center gap-1.5">
          <span>
            {fmtTime(trip.startTime)}
            {trip.endTime ? `–${fmtTime(trip.endTime)}` : ''}
          </span>
          {linked ? <Badge tone="blue">{appt ? `Treatment` : 'Linked'}</Badge> : <Badge>{CATEGORY_LABEL[trip.category]}</Badge>}
          {trip.distanceSource && <Badge tone={trip.distanceSource === 'routing' ? 'orange' : 'gray'}>{SOURCE_SHORT[trip.distanceSource]}</Badge>}
          {hasSuggestion && <Badge tone="orange">Possible match</Badge>}
        </span>
      }
      detail={km == null ? <span className="text-warn">No distance</span> : <span className="font-semibold text-ink">{fmtKm(km)}</span>}
    />
  );
}

/* ---------------- Trip editor ---------------- */

export function TripEditor({ tripId, onClose }: { tripId: string | null; onClose: () => void }) {
  const { trips, appointments, locations, settings } = useData();
  const toast = useToast();
  const [t, setT] = useState<Trip | null>(null);
  const [busy, setBusy] = useState<'' | 'route' | 'save'>('');
  const [error, setError] = useState<string | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const locMap = useMemo(() => new Map(locations.map((l) => [l.id, l])), [locations]);
  const apptMap = useMemo(() => new Map(appointments.map((a) => [a.id, a])), [appointments]);
  const isNew = tripId === 'new';

  useEffect(() => {
    setError(null);
    setLinkOpen(false);
    if (!tripId) return setT(null);
    if (tripId === 'new') {
      const now = new Date();
      return setT(newTrip({ origin: 'manual', startTime: new Date(now.getTime() - 30 * 60000).toISOString(), endTime: now.toISOString() }));
    }
    const found = trips.find((x) => x.id === tripId);
    setT(found ? { ...found } : null);
    // only when opening a different trip
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId]);

  const set = (p: Partial<Trip>) => setT((x) => (x ? { ...x, ...p } : x));
  const suggestions = useMemo(() => {
    if (!t) return [];
    const day = dateKey(t.startTime);
    return suggestMatches(t, appointments.filter((a) => dateKey(a.start) === day), locMap);
  }, [t, appointments, locMap]);

  if (!tripId || !t) return <Sheet open={!!tripId} onClose={onClose} title="Trip">{tripId && <div className="py-10 text-center text-muted">Trip not found.</div>}</Sheet>;

  const sources = availableSources(t);

  function setPoint(which: 'start' | 'end', locId: string | null) {
    const l = locId ? locMap.get(locId) : undefined;
    const prev = t![which];
    const p: TripPoint = l
      ? { label: locationTitle(l), locationId: l.id, lat: l.lat, lng: l.lng }
      : { label: prev.locationId ? '' : prev.label, locationId: null, lat: prev.locationId ? null : prev.lat, lng: prev.locationId ? null : prev.lng };
    set({ [which]: p } as Partial<Trip>);
  }

  async function estimate() {
    if (!t || !hasCoords(t.start) || !hasCoords(t.end)) return;
    setBusy('route');
    setError(null);
    try {
      const r = await routeBetween(t.start, t.end, settings);
      setT((x) => (x ? normaliseSource({ ...x, routedKm: Math.round(r.km * 100) / 100, routedProvider: r.provider, routeGeometry: r.geometry }) : x));
    } catch (e) {
      setError(`Distance unavailable: ${errMsg(e)} You can enter the distance manually.`);
    } finally {
      setBusy('');
    }
  }

  function confirmLink(apptId: string, dir: 'to' | 'from') {
    set(dir === 'to' ? { toAppointmentId: apptId, category: 'treatment' } : { fromAppointmentId: apptId, category: 'treatment' });
  }

  async function save() {
    if (!t) return;
    setError(null);
    if (t.endTime && t.endTime < t.startTime) return setError('Arrival must be after departure.');
    if (t.odometerStart != null && t.odometerEnd != null && t.odometerEnd < t.odometerStart) return setError('Odometer end must be greater than start.');
    setBusy('save');
    try {
      const fixed = normaliseSource({ ...t, updatedAt: nowIso() });
      if (fixed.distanceSource !== t.distanceSource && t.distanceSource) {
        toast(`No ${SOURCE_LABEL[t.distanceSource].toLowerCase()} distance — using ${fixed.distanceSource ? SOURCE_LABEL[fixed.distanceSource].toLowerCase() : 'none'}`, 'info');
      }
      await put('trips', fixed);
      toast(isNew ? 'Trip saved' : 'Trip updated');
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy('');
    }
  }

  async function del() {
    if (!t || !confirm('Delete this trip?')) return;
    await remove('trips', t.id);
    toast('Trip deleted');
    onClose();
  }

  const markers: MapMarker[] = [];
  if (hasCoords(t.start)) markers.push({ lat: t.start.lat, lng: t.start.lng, text: 'A', kind: 'home', label: t.start.label });
  if (hasCoords(t.end)) markers.push({ lat: t.end.lat, lng: t.end.lng, text: 'B', kind: 'end', label: t.end.label });
  const lines: MapLine[] = [];
  if (t.track.length > 1) lines.push({ points: t.track.map((p) => [p[0], p[1]] as [number, number]) });
  if (t.routeGeometry && t.routeGeometry.length > 1) lines.push({ points: t.routeGeometry, color: '#ff9500', dashed: true });

  const toAppt = t.toAppointmentId ? apptMap.get(t.toAppointmentId) : undefined;
  const fromAppt = t.fromAppointmentId ? apptMap.get(t.fromAppointmentId) : undefined;

  return (
    <Sheet
      open
      onClose={onClose}
      title={isNew ? 'New trip' : 'Trip'}
      right={
        <button type="button" className="font-semibold text-accent disabled:opacity-40" disabled={!!busy} onClick={() => void save()}>
          {busy === 'save' ? <Spinner /> : 'Save'}
        </button>
      }
    >
      {error && <Banner tone="error">{error}</Banner>}
      {t.origin === 'route-plan' && <Banner tone="info">Created from the route planner. Its distance is an estimate unless you change it to a measured or manual value.</Banner>}

      {(markers.length > 0 || lines.length > 0) && <MapView markers={markers} lines={lines} height={210} />}

      <List>
        <Field label="Departure">
          <input type="datetime-local" className="w-full bg-transparent py-1 text-[17px] outline-none" value={toLocalInput(t.startTime)} onChange={(e) => set({ startTime: fromLocalInput(e.target.value) ?? t.startTime })} />
        </Field>
        <Field label="Arrival">
          <input type="datetime-local" className="w-full bg-transparent py-1 text-[17px] outline-none" value={toLocalInput(t.endTime)} onChange={(e) => set({ endTime: fromLocalInput(e.target.value) })} />
        </Field>
      </List>

      <List>
        <PointField label="Starting location" point={t.start} locations={locations} onSelect={(id) => setPoint('start', id)} onLabel={(v) => set({ start: { ...t.start, label: v } })} />
        <PointField label="Destination" point={t.end} locations={locations} onSelect={(id) => setPoint('end', id)} onLabel={(v) => set({ end: { ...t.end, label: v } })} />
        <Field label="Category" hint="Trips become treatment travel only when you choose so or confirm a link below.">
          <Select
            value={t.category}
            onChange={(v) => set({ category: v as TripCategory })}
            options={(Object.keys(CATEGORY_LABEL) as TripCategory[]).map((k) => ({ value: k, label: CATEGORY_LABEL[k] }))}
          />
        </Field>
      </List>

      <Section title="Distance" footer="Each value is kept separately. Choose which one counts in totals and reports.">
        <List>
          <Row title="GPS recorded" subtitle={t.track.length ? `${t.track.length} points` : 'Only for trips recorded with Start Trip'} detail={fmtKm(t.gpsKm)} />
          <Row
            title="Routing estimate"
            subtitle={t.routedKm != null ? `${t.routedProvider ?? 'Routing service'} · fastest driving route` : hasCoords(t.start) && hasCoords(t.end) ? 'Calculate from start and destination' : 'Needs map positions for both ends'}
            detail={t.routedKm != null ? fmtKm(t.routedKm) : undefined}
            right={
              hasCoords(t.start) && hasCoords(t.end) ? (
                <Button small variant="tinted" onClick={() => void estimate()} disabled={busy === 'route'}>
                  {busy === 'route' ? <Spinner size={14} /> : t.routedKm != null ? 'Redo' : 'Estimate'}
                </Button>
              ) : undefined
            }
          />
          <Field label="Manually entered distance">
            <NumberInput value={numStr(t.manualKm)} onChange={(v) => set({ manualKm: parseNum(v) })} placeholder="e.g. 12.4" suffix="km" />
          </Field>
          <div className="grid grid-cols-2 divide-x divide-line">
            <Field label="Odometer start">
              <NumberInput value={numStr(t.odometerStart)} onChange={(v) => set({ odometerStart: parseNum(v) })} suffix="km" />
            </Field>
            <Field label="Odometer end">
              <NumberInput value={numStr(t.odometerEnd)} onChange={(v) => set({ odometerEnd: parseNum(v) })} suffix="km" />
            </Field>
          </div>
          <div className="px-4 py-3">
            <div className="mb-2 text-[13px] font-medium text-muted">Use for totals</div>
            {sources.length ? (
              <Segmented<DistanceSource>
                value={t.distanceSource && sources.includes(t.distanceSource) ? t.distanceSource : sources[0]}
                onChange={(v) => set({ distanceSource: v })}
                options={sources.map((s) => ({ value: s, label: `${SOURCE_SHORT[s]} ${fmtNum1(kmForSource(t, s))}` }))}
              />
            ) : (
              <div className="text-[14px] text-warn">No distance yet — enter one above.</div>
            )}
          </div>
        </List>
      </Section>

      <Section title="Treatment appointment" footer="Suggestions compare times and locations. Nothing is linked until you confirm it.">
        <List>
          {toAppt && <LinkedRow label="Driving to" appt={toAppt} onUnlink={() => set({ toAppointmentId: null })} />}
          {fromAppt && <LinkedRow label="Driving from" appt={fromAppt} onUnlink={() => set({ fromAppointmentId: null })} />}
          {suggestions.map((s) => {
            const a = apptMap.get(s.appointmentId);
            if (!a) return null;
            return (
              <div key={s.appointmentId + s.direction} className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <Badge tone="orange">{confidenceLabel(s.score)}</Badge>
                  <span className="text-[13px] text-muted">{s.direction === 'to' ? 'Driving to' : 'Driving from'}</span>
                </div>
                <div className="mt-1 text-[15px] font-medium">
                  {fmtTime(a.start)} · {categoryLabel(settings, a.categoryId)} — {a.summary}
                </div>
                <div className="text-[12px] text-muted">{s.reasons.join(' · ')}</div>
                <div className="mt-2 flex gap-2">
                  <Button small onClick={() => confirmLink(a.id, s.direction)}>
                    Confirm
                  </Button>
                  <Button small variant="secondary" onClick={() => set({ rejectedMatches: [...t.rejectedMatches, a.id] })}>
                    Not this trip
                  </Button>
                </div>
              </div>
            );
          })}
          {!toAppt && !fromAppt && suggestions.length === 0 && <Row title={<span className="text-muted">Not linked to an appointment</span>} />}
          <Row title={<span className="text-accent">Link an appointment manually…</span>} onClick={() => setLinkOpen((v) => !v)} chevron={false} />
          {linkOpen && <ManualLink trip={t} appointments={appointments} onPick={(id, dir) => (confirmLink(id, dir), setLinkOpen(false))} />}
        </List>
      </Section>

      <List>
        <Field label="Notes">
          <TextArea value={t.notes} onChange={(v) => set({ notes: v })} rows={2} />
        </Field>
      </List>

      {!isNew && (
        <Button variant="danger" full onClick={() => void del()}>
          Delete trip
        </Button>
      )}
    </Sheet>
  );
}

function PointField({ label, point, locations, onSelect, onLabel }: { label: string; point: TripPoint; locations: SavedLocation[]; onSelect: (id: string | null) => void; onLabel: (v: string) => void }) {
  return (
    <div>
      <Field label={label}>
        <LocationSelect value={point.locationId} onChange={onSelect} locations={locations} noneLabel="Other (not a saved place)" />
      </Field>
      {!point.locationId && (
        <div className="-mt-2 px-4 pb-2.5">
          <TextInput value={point.label} onChange={onLabel} placeholder="Describe the place" />
          {hasCoords(point) && <div className="text-[12px] text-muted">GPS position recorded</div>}
        </div>
      )}
    </div>
  );
}

function LinkedRow({ label, appt, onUnlink }: { label: string; appt: Appointment; onUnlink: () => void }) {
  const { settings } = useData();
  return (
    <Row
      title={`${label}: ${categoryLabel(settings, appt.categoryId)}`}
      subtitle={`${fmtDateShort(appt.start)} ${fmtTime(appt.start)} · ${appt.summary}`}
      left={<Badge tone="green">Confirmed</Badge>}
      right={
        <button type="button" className="text-[14px] text-bad" onClick={onUnlink}>
          Unlink
        </button>
      }
    />
  );
}

function ManualLink({ trip, appointments, onPick }: { trip: Trip; appointments: Appointment[]; onPick: (id: string, dir: 'to' | 'from') => void }) {
  const { settings } = useData();
  const day = dateKey(trip.startTime);
  const sameDay = appointments.filter((a) => dateKey(a.start) === day && !a.excluded).sort((a, b) => a.start.localeCompare(b.start));
  if (!sameDay.length) return <div className="px-4 py-3 text-[14px] text-muted">No treatment appointments on {fmtKey(day)}.</div>;
  return (
    <div className="space-y-2 px-4 py-3">
      {sameDay.map((a) => (
        <div key={a.id} className="rounded-xl bg-fill p-3">
          <div className="text-[14px] font-medium">
            {fmtTime(a.start)} · {categoryLabel(settings, a.categoryId)}
          </div>
          <div className="text-[12px] text-muted">{a.summary}</div>
          <div className="mt-2 flex gap-2">
            <Button small variant="tinted" onClick={() => onPick(a.id, 'to')}>
              Driving to
            </Button>
            <Button small variant="tinted" onClick={() => onPick(a.id, 'from')}>
              Driving from
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
