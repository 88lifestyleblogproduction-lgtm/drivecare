import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Badge, Banner, Button, Card, Empty, Field, IconButton, List, NumberInput, Page, Row, Section, Segmented, Select, Sheet, Spinner, TextInput, Toggle, useToast } from '../components/ui';
import { IconBack, IconChevron, IconGear, IconDown, IconMap, IconPlus, IconRefresh, IconTrash, IconUp } from '../components/Icons';
import MapView, { type MapLine, type MapMarker } from '../components/MapView';
import LocationEditor, { LocationSelect, type LocationDraft } from '../components/LocationEditor';
import { useData } from '../lib/data';
import { useNav, type TreatmentView } from '../lib/nav';
import { useCalendarSync } from '../lib/useSync';
import { getToken } from '../lib/google';
import { formatAddress, googleMapsUrl, locationTitle, normalizeKey, parseAddress, titleKey } from '../lib/address';
import { categoryById, categoryLabel, saveSettings } from '../lib/settings';
import { clinicInfo, isActiveAppt } from '../lib/report';
import { buildPoints, buildSegments, dayAppointments, reconcilePlan, workdayStatus, workLocationOf, saveSegmentsAsTrips, type PlanPoint, type PlanSegment, type SegmentState } from '../lib/planner';
import { pairsOf, useRouteResults } from '../lib/useRoutes';
import { WorkCard } from '../components/WorkSettings';
import { autoLocateAppointments } from '../lib/autoLocate';

// Legs already tried automatically this session (avoids repeat requests after a failure)
const autoTried = new Set<string>();
const plannerTried = new Set<string>();
const AUTO_LIMIT = 40;
import { peekRoute, providerName, routeBetween } from '../lib/routing';
import { computeFuelStats } from '../lib/fuel';
import { hasCoords } from '../lib/geo';
import { put, remove } from '../lib/db';
import { addDays, dateKey, fmtDateShort, fmtDateTime, fmtKey, fmtTime, fmtWeekday, fromLocalInput, todayKey, toLocalInput } from '../lib/time';
import { fmtCADLong, fmtKm, fmtNum1, fmtPerKm } from '../lib/format';
import { effectiveKm, SOURCE_LABEL } from '../lib/trips';
import type { Appointment, PlanStop, RoutePlan, SavedLocation } from '../lib/types';
import { errMsg, groupBy, nowIso, parseNum, uid } from '../lib/util';

export default function TreatmentsScreen() {
  const nav = useNav();
  const { settings } = useData();
  const { syncing, sync } = useCalendarSync();
  return (
    <Page
      title={settings.tabLabel}
      onTitleClick={() => {
        const name = prompt('Name for this tab (e.g. Schedule, Visits, Clients, Treatments)', settings.tabLabel);
        if (name && name.trim()) void saveSettings({ tabLabel: name.trim().slice(0, 24), tabLabelCustom: true });
      }}
      subtitle="Appointments, routes and places"
      right={
        <>
          <IconButton label="Sync Google Calendar" onClick={() => void sync()}>
            {syncing ? <Spinner /> : <IconRefresh />}
          </IconButton>
          <IconButton label="Settings" onClick={nav.openSettings}>
            <IconGear />
          </IconButton>
        </>
      }
    >
      <Segmented<TreatmentView>
        value={nav.treatmentView}
        onChange={nav.setTreatmentView}
        options={[
          { value: 'appointments', label: 'Appointments' },
          { value: 'route', label: 'Route' },
          { value: 'clinics', label: 'Places' },
        ]}
      />
      {nav.treatmentView === 'appointments' && <Appointments />}
      {nav.treatmentView === 'route' && <RoutePlanner />}
      {nav.treatmentView === 'clinics' && <Clinics />}
    </Page>
  );
}

/* ---------------- Sync status ---------------- */

function SyncStatus() {
  const { settings } = useData();
  const { syncing, sync } = useCalendarSync();
  const nav = useNav();
  const token = !!getToken();
  if (!settings.googleConnected && !settings.selectedCalendars.length) {
    return (
      <Card className="p-4">
        <div className="text-[17px] font-semibold">Connect Google Calendar</div>
        <p className="mt-1 text-[14px] leading-relaxed text-muted">
          DriveCare reads (never changes) your calendar and keeps only appointments that match treatment keywords. You can also add appointments manually.
        </p>
        <div className="mt-3 flex gap-2">
          <Button onClick={() => void sync()}>Connect Google Calendar</Button>
          <Button variant="secondary" onClick={nav.openSettings}>
            Setup
          </Button>
        </div>
      </Card>
    );
  }
  return (
    <Card className="flex items-center gap-3 px-4 py-3">
      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${settings.lastSyncError ? 'bg-bad' : token ? 'bg-good' : 'bg-faint'}`} />
      <div className="min-w-0 flex-1 text-[13px] leading-snug">
        <div className="font-medium">
          {settings.lastSyncError ? 'Last sync failed' : settings.lastSync ? `Synced ${fmtDateShort(settings.lastSync)} at ${fmtTime(settings.lastSync)}` : 'Not synced yet'}
        </div>
        <div className="truncate text-muted">
          {settings.lastSyncError ?? (settings.lastSyncSummary || `${settings.selectedCalendars.length} calendar(s) selected`)}
          {!token && ' · sign-in needed to sync'}
        </div>
      </div>
      <Button small variant="tinted" onClick={() => void sync()} disabled={syncing}>
        {syncing ? <Spinner size={14} /> : 'Sync'}
      </Button>
    </Card>
  );
}

/* ---------------- Appointments ---------------- */

function Appointments() {
  const { appointments, locations, settings, loaded, routePlans, trips } = useData();
  const nav = useNav();
  const toast = useToast();
  const [editLeg, setEditLeg] = useState<{ day: string; key: string } | null>(null);
  const [legText, setLegText] = useState('');
  const [filter, setFilter] = useState<'upcoming' | 'past' | 'address'>('upcoming');
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const locMap = useMemo(() => new Map(locations.map((l) => [l.id, l])), [locations]);
  const nowIsoStr = new Date().toISOString();
  const today = todayKey();

  const [showInactive, setShowInactive] = useState(false);
  const inactiveCount = appointments.filter((a) => !isActiveAppt(a) && (filter === 'past' ? dateKey(a.start) < today : dateKey(a.start) >= today)).length;
  const list = appointments
    .filter((a) => showInactive || isActiveAppt(a))
    .filter((a) => {
      if (filter === 'address') return isActiveAppt(a) && !a.locationId;
      if (filter === 'upcoming') return dateKey(a.start) >= today;
      return dateKey(a.start) < today;
    })
    .sort((a, b) => (filter === 'past' ? b.start.localeCompare(a.start) : a.start.localeCompare(b.start)));
  const groups = groupBy(list, (a) => dateKey(a.start));
  const needAddress = appointments.filter((a) => isActiveAppt(a) && !a.locationId).length;

  // Driving distance between consecutive appointments, using the same plan (order, skips, manual
  // adjustments) as the route planner.
  const apptMap = useMemo(() => new Map(appointments.map((a) => [a.id, a])), [appointments]);
  const dayKeys = [...groups.keys()].join(',');
  const dayData = useMemo(() => {
    const m = new Map<string, { plan: RoutePlan; points: PlanPoint[] }>();
    if (filter === 'address') return m;
    for (const day of dayKeys ? dayKeys.split(',') : []) {
      const dAppts = dayAppointments(appointments, day);
      if (dAppts.length < 1) continue;
      const plan = reconcilePlan(routePlans.find((p) => p.id === day), day, dAppts, settings, locations, trips);
      m.set(day, { plan, points: buildPoints(plan, apptMap, locMap, settings) });
    }
    return m;
  }, [dayKeys, filter, appointments, routePlans, settings, locations, apptMap, locMap, trips]);
  const allPairs = useMemo(() => [...dayData.values()].flatMap((d) => pairsOf(d.points)), [dayData]);
  const { results, calculate } = useRouteResults(allPairs, settings);

  // 1) Find map positions for calendar addresses automatically.
  const unlocatedSig =
    appointments
      .filter((a) => isActiveAppt(a) && !a.locationId && a.locationRaw)
      .map((a) => a.id)
      .join(',') +
    '|' +
    locations
      .filter((l) => !hasCoords(l) && (l.street || l.postalCode))
      .map((l) => l.id)
      .join(',');
  useEffect(() => {
    if (unlocatedSig === '|') return;
    void autoLocateAppointments().then((n) => {
      if (n) toast(`Located ${n} address${n > 1 ? 'es' : ''} from your calendar automatically`);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlocatedSig]);

  // 2) Calculate driving km between appointments automatically (rate-limited, cached).
  const autoPending = allPairs.filter((p) => !results.has(p.key) && !autoTried.has(p.key));
  const autoSig = autoPending.map((p) => p.key).join('|');
  useEffect(() => {
    const room = AUTO_LIMIT - autoTried.size;
    if (!autoPending.length || room <= 0) return;
    const batch = autoPending.slice(0, room);
    batch.forEach((p) => autoTried.add(p.key));
    void calculate(batch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSig]);

  async function saveLeg(plan: RoutePlan, key: string) {
    const v = parseNum(legText);
    const manualKm = { ...plan.manualKm };
    if (v == null) delete manualKm[key];
    else if (v < 0 || v > 2000) return toast('Enter a distance between 0 and 2000 km', 'error');
    else manualKm[key] = v;
    await put('routePlans', { ...plan, manualKm, updatedAt: nowIso() });
    setEditLeg(null);
    toast(v == null ? 'Adjustment removed' : 'Distance adjusted');
  }

  const legProps = (day: string, plan: RoutePlan, seg: PlanSegment) => ({
    seg,
    editing: editLeg?.day === day && editLeg.key === seg.manualKey,
    text: legText,
    onText: setLegText,
    onEdit: () => {
      if (seg.kind === 'same') return;
      setEditLeg({ day, key: seg.manualKey });
      setLegText(seg.manualKm != null ? String(seg.manualKm) : seg.estKm != null ? seg.estKm.toFixed(1) : '');
    },
    onSave: () => void saveLeg(plan, seg.manualKey),
    onCancel: () => setEditLeg(null),
  });

  return (
    <>
      <SyncStatus />
      <WorkCard />
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <Segmented
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'upcoming', label: 'Upcoming' },
              { value: 'past', label: 'Past' },
              { value: 'address', label: `No address${needAddress ? ` (${needAddress})` : ''}` },
            ]}
          />
        </div>
        <IconButton label="Add appointment manually" onClick={() => setAdding(true)}>
          <IconPlus size={18} />
        </IconButton>
      </div>
      {filter !== 'address' && inactiveCount > 0 && (
        <button type="button" className="px-1 text-left text-[13px] font-semibold text-accent" onClick={() => setShowInactive((v) => !v)}>
          {showInactive ? 'Hide' : 'Show'} {inactiveCount} cancelled, deleted or untracked appointment{inactiveCount > 1 ? 's' : ''}
        </button>
      )}
      {loaded && list.length === 0 && (
        <Empty
          title={filter === 'address' ? 'All addresses confirmed' : 'No appointments'}
          text={filter === 'upcoming' ? 'Sync Google Calendar or add an appointment manually.' : undefined}
        />
      )}
      {[...groups.entries()].map(([day, appts]) => {
        const d = dayData.get(day);
        const ordered = filter === 'past' ? [...appts].reverse() : appts;
        if (!d) {
          return (
            <Section key={day} title={fmtKey(day)}>
              <List>
                {ordered.map((a) => (
                  <ApptRow key={a.id} appt={a} loc={a.locationId ? locMap.get(a.locationId) : undefined} past={a.end < nowIsoStr} onClick={() => setOpenId(a.id)} />
                ))}
              </List>
            </Section>
          );
        }
        const segs = buildSegments(d.points, d.plan, results);
        const pending = pairsOf(d.points).filter((p) => !results.get(p.key)?.result && !results.get(p.key)?.loading && d.plan.manualKm[p.key] == null);
        const total = segs.reduce((sum, x) => sum + (x.usedKm ?? 0), 0);
        const incomplete = segs.some((x) => x.usedKm == null);
        const inPlan = new Set(d.points.flatMap((p) => p.appointments.map((a) => a.id)));
        const others = ordered.filter((a) => !inPlan.has(a.id));
        const ws = workdayStatus(day, d.plan, settings, trips, locations);
        return (
          <Section
            key={day}
            title={
              <span className="flex items-center gap-2">
                {fmtKey(day)}
                {ws.on && <Badge tone="orange">Workday</Badge>}
              </span>
            }
            action={
              <div className="flex items-center gap-1">
                {pending.length > 0 && (
                  <Button
                    small
                    variant="plain"
                    onClick={() => void calculate(pending).then((f) => f && toast(`${f} distance${f > 1 ? 's' : ''} unavailable — tap to enter manually`, 'error'))}
                  >
                    Calculate km
                  </Button>
                )}
                <Button small variant="plain" onClick={() => nav.openRouteFor(day)}>
                  Route ›
                </Button>
              </div>
            }
            footer={`Day total: ${incomplete ? `${fmtNum1(total)}+ km (some legs missing)` : fmtKm(total)}. Tap any distance to adjust it.`}
          >
            <List>
              {d.points.map((p, i) => (
                <div key={p.key + i}>
                  {p.appointments.length ? (
                    p.appointments.map((a, j) => (
                      <div key={a.id}>
                        {j > 0 && <SameRow />}
                        <ApptRow appt={a} loc={a.locationId ? locMap.get(a.locationId) : undefined} past={a.end < nowIsoStr} onClick={() => setOpenId(a.id)} />
                      </div>
                    ))
                  ) : (
                    <PlaceRow point={p} />
                  )}
                  {segs[i] && <LegRow {...legProps(day, d.plan, segs[i])} />}
                </div>
              ))}
              {others.map((a) => (
                <ApptRow key={a.id} appt={a} loc={a.locationId ? locMap.get(a.locationId) : undefined} past={a.end < nowIsoStr} onClick={() => setOpenId(a.id)} />
              ))}
            </List>
          </Section>
        );
      })}
      <AppointmentDetail apptId={openId} onClose={() => setOpenId(null)} />
      <ManualAppointment open={adding} onClose={() => setAdding(false)} settingsCats={settings.categories} />
    </>
  );
}

function SameRow() {
  return (
    <div className="flex items-center gap-2 bg-fill/50 px-4 py-1.5 text-[12px] text-muted">
      <IconDown size={14} /> Same place · 0 km
    </div>
  );
}

function PlaceRow({ point }: { point: PlanPoint }) {
  const icon = point.work ? '💼' : point.role === 'start' ? '🏠' : point.role === 'end' ? '🏁' : '📍';
  const time = point.work
    ? [point.arrive && `arrive ${fmtTime(point.arrive)}`, point.leave && `leave ${fmtTime(point.leave)}`].filter(Boolean).join(' · ')
    : point.role === 'start'
      ? 'Start of day'
      : point.role === 'end'
        ? 'End of day'
        : 'Extra stop';
  return (
    <div className="flex min-h-[44px] items-center gap-3 px-4 py-2">
      <span className="w-[74px] text-[18px]">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-medium">{point.work ? `Work · ${point.label}` : point.label}</div>
        <div className="text-[12px] text-muted">{time}</div>
      </div>
    </div>
  );
}

function LegRow({
  seg: s,
  editing,
  text,
  onText,
  onEdit,
  onSave,
  onCancel,
}: {
  seg: PlanSegment;
  editing: boolean;
  text: string;
  onText: (v: string) => void;
  onEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  if (s.kind === 'same') return <SameRow />;
  const source =
    s.manualKm != null
      ? `Adjusted${s.estKm != null ? ` (estimate ${fmtKm(s.estKm)})` : ''}`
      : s.estKm != null
        ? `${s.provider} estimate${s.durationMin ? ` · ~${Math.round(s.durationMin)} min` : ''}`
        : s.kind === 'missing'
          ? s.missingReason
          : s.error
            ? 'Routing unavailable'
            : 'Calculating…';
  if (editing) {
    return (
      <div className="flex items-center gap-2 bg-accent/8 px-4 py-2">
        <IconDown size={14} className="text-accent" />
        <div className="flex-1">
          <NumberInput value={text} onChange={onText} placeholder="km (blank = no adjustment)" suffix="km" />
        </div>
        <Button small onClick={onSave}>
          Save
        </Button>
        <Button small variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    );
  }
  return (
    <button type="button" onClick={onEdit} className="flex w-full items-center gap-2 bg-fill/50 px-4 py-1.5 text-left text-[12px] active:bg-fill">
      <IconDown size={14} className="text-accent" />
      <span className="min-w-0 flex-1 truncate text-muted">{source}</span>
      {s.loading ? (
        <Spinner size={12} />
      ) : s.usedKm != null ? (
        <span className={`font-semibold tabular ${s.manualKm != null ? 'text-warn' : 'text-ink'}`}>{fmtKm(s.usedKm)} ✎</span>
      ) : (
        <span className="font-semibold text-warn">Enter km ✎</span>
      )}
    </button>
  );
}

/** Pick the nature of an appointment; you can also create a new type on the spot. */
export function TypePicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const { settings } = useData();
  async function addType() {
    const name = prompt('New type (e.g. Sales visit, Site inspection, Chiropractic)');
    if (!name?.trim()) return;
    const id = `custom-${uid().slice(0, 8)}`;
    const palette = ['#5e5ce6', '#ff9f0a', '#30b0c7', '#ff375f', '#34c759', '#af52de'];
    await saveSettings({
      categories: [{ id, label: name.trim(), keywords: [], builtIn: false, color: palette[settings.categories.length % palette.length] }, ...settings.categories],
    });
    onChange(id);
  }
  return (
    <div className="flex flex-wrap gap-2">
      {settings.categories.map((c) => {
        const on = c.id === value;
        return (
          <button
            key={c.id}
            type="button"
            onClick={() => onChange(c.id)}
            className={`rounded-full px-3 py-1.5 text-[13px] font-semibold transition ${on ? 'text-white shadow-sm' : 'bg-card text-ink surface'}`}
            style={on ? { background: c.color } : undefined}
          >
            {c.label}
          </button>
        );
      })}
      <button type="button" onClick={() => void addType()} className="rounded-full border border-dashed border-accent px-3 py-1.5 text-[13px] font-semibold text-accent">
        + New type
      </button>
    </div>
  );
}

export function StatusBadge({ a }: { a: Appointment }) {
  if (a.excluded) return <Badge>Not tracked</Badge>;
  if (a.status === 'cancelled') return <Badge tone="red">Cancelled</Badge>;
  if (a.status === 'removed') return <Badge tone="red">Removed</Badge>;
  if (a.status === 'tentative') return <Badge tone="orange">Tentative</Badge>;
  return null;
}

/** Removes an appointment from your schedule (kept as "not tracked" so sync won't add it back). */
export async function removeFromSchedule(a: Appointment, toast: (t: string, tone?: 'ok' | 'error' | 'info') => void) {
  if (a.source === 'manual') {
    if (!confirm(`Delete “${a.summary}”?`)) return;
    await remove('appointments', a.id);
    toast('Appointment deleted');
    return;
  }
  await put('appointments', { ...a, excluded: true, updatedAt: nowIso() });
  toast('Removed from your schedule — use “Show … untracked” to bring it back');
}

function ApptRow({ appt, loc, past, onClick }: { appt: Appointment; loc?: SavedLocation; past: boolean; onClick: () => void }) {
  const { settings } = useData();
  const toast = useToast();
  const cat = categoryById(settings, appt.categoryId);
  const inactive = !isActiveAppt(appt);
  return (
    <div className="flex items-center">
      <div className="min-w-0 flex-1">
        <ApptRowInner appt={appt} loc={loc} past={past} onClick={onClick} cat={cat} inactive={inactive} />
      </div>
      {appt.excluded ? (
        <button
          type="button"
          className="mr-3 shrink-0 rounded-full bg-accent/12 px-2.5 py-1 text-[12px] font-semibold text-accent"
          onClick={() => void put('appointments', { ...appt, excluded: false, updatedAt: nowIso() }).then(() => toast('Added back to your schedule'))}
        >
          Restore
        </button>
      ) : (
        <button
          type="button"
          aria-label={`Remove ${appt.summary} from schedule`}
          title="Remove from schedule"
          className="mr-3 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-fill text-[15px] font-bold text-muted active:bg-bad/20 active:text-bad"
          onClick={() => void removeFromSchedule(appt, toast)}
        >
          ✕
        </button>
      )}
    </div>
  );
}

function ApptRowInner({
  appt,
  loc,
  past,
  onClick,
  cat,
  inactive,
}: {
  appt: Appointment;
  loc?: SavedLocation;
  past: boolean;
  onClick: () => void;
  cat: ReturnType<typeof categoryById>;
  inactive: boolean;
}) {
  return (
    <Row
      onClick={onClick}
      left={
        <div className={`w-[74px] text-[14px] font-semibold whitespace-nowrap tabular ${inactive || past ? 'text-muted' : ''}`}>
          {appt.allDay ? 'All day' : fmtTime(appt.start)}
        </div>
      }
      title={<span className={inactive ? 'text-muted line-through' : ''}>{appt.summary || '(no title)'}</span>}
      subtitle={
        <span className="flex flex-wrap items-center gap-1.5">
          <Badge color={cat?.color}>{cat?.label ?? 'Treatment'}</Badge>
          <StatusBadge a={appt} />
          {loc ? (
            <>
              <span className="truncate">{locationTitle(loc)}</span>
              {loc.autoLocated && <Badge tone={loc.geocodeLabel.startsWith('Approximate') ? 'orange' : 'gray'}>{loc.geocodeLabel.startsWith('Approximate') ? 'Approx. location' : 'Auto-located'}</Badge>}
            </>
          ) : (
            <Badge tone="orange">{appt.locationRaw ? 'Address not found' : 'No location'}</Badge>
          )}
        </span>
      }
    />
  );
}

function Detail({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex gap-3 px-4 py-2.5 text-[15px]">
      <div className="w-28 shrink-0 text-muted">{label}</div>
      <div className="min-w-0 flex-1 break-words">{value || <span className="text-faint">—</span>}</div>
    </div>
  );
}

function AppointmentDetail({ apptId, onClose }: { apptId: string | null; onClose: () => void }) {
  const { appointments, locations, settings, trips } = useData();
  const nav = useNav();
  const toast = useToast();
  const [editLoc, setEditLoc] = useState<{ draft: LocationDraft; source?: string; key?: string; title?: { key: string; summary: string } } | null>(null);
  const a = apptId ? appointments.find((x) => x.id === apptId) : undefined;
  const locMap = useMemo(() => new Map(locations.map((l) => [l.id, l])), [locations]);
  if (!apptId) return null;
  if (!a)
    return (
      <Sheet open onClose={onClose} title="Appointment" closeLabel="Back">
        <div className="py-10 text-center text-muted">This appointment no longer exists.</div>
      </Sheet>
    );
  const loc = a.locationId ? locMap.get(a.locationId) : undefined;
  const parsed = parseAddress(a.locationRaw);
  const ci = clinicInfo(a, locMap);
  const linkedTrips = trips.filter((t) => t.toAppointmentId === a.id || t.fromAppointmentId === a.id);

  const update = (patch: Partial<Appointment>) => put('appointments', { ...a, ...patch, updatedAt: nowIso() });

  function confirmAddress() {
    setEditLoc({
      draft: { kind: 'clinic', name: parsed.name, street: parsed.street, city: parsed.city, province: parsed.province || 'BC', postalCode: parsed.postalCode },
      source: a!.locationRaw || undefined,
      key: a!.locationRaw ? normalizeKey(a!.locationRaw) : undefined,
      title: a!.summary ? { key: titleKey(a!.summary), summary: a!.summary } : undefined,
    });
  }

  async function del() {
    if (!a) return;
    await removeFromSchedule(a, toast);
    onClose();
  }

  const mapsQuery = loc ? [loc.name, formatAddress(loc)].filter(Boolean).join(', ') : a.locationRaw;

  return (
    <Sheet open onClose={onClose} title="Appointment" closeLabel="Back">
      <div>
        <div className="text-[22px] leading-tight font-bold">{a.summary || '(no title)'}</div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[14px] text-muted">
          <Badge color={categoryById(settings, a.categoryId)?.color}>{categoryLabel(settings, a.categoryId)}</Badge>
          <StatusBadge a={a} />
          {a.statusNote && <span>{a.statusNote}</span>}
        </div>
      </div>

      <Section title="What is this appointment?" footer={a.categoryOverride ? 'Chosen by you — sync will keep it.' : 'Chosen automatically from the title. Tap another type to change it.'}>
        <TypePicker value={a.categoryId} onChange={(id) => void update({ categoryId: id, categoryOverride: true })} />
      </Section>

      <List>
        <Detail label="Date" value={fmtKey(dateKey(a.start))} />
        <Detail label="Time" value={a.allDay ? 'All day' : `${fmtTime(a.start)} – ${fmtTime(a.end)}`} />
        <Detail label="Place / provider" value={ci.name} />
        <Detail label="Full address" value={ci.address} />
        <Detail label="Street" value={loc ? loc.street : parsed.street} />
        <Detail label="City" value={loc ? loc.city : parsed.city} />
        <Detail label="Province" value={loc ? loc.province : parsed.province} />
        <Detail label="Postal code" value={loc ? loc.postalCode : parsed.postalCode} />
        <Detail label="Status" value={a.excluded ? 'Not tracked' : a.status[0].toUpperCase() + a.status.slice(1)} />
        <Detail label="Source" value={a.source === 'google' ? `Google Calendar · ${a.calendarName}` : 'Added manually'} />
        {a.source === 'google' && <Detail label="Calendar location" value={a.locationRaw || 'None'} />}
        {a.source === 'google' && (
          <Detail
            label="Last checked with Google"
            value={a.lastSynced ? `${fmtDateTime(a.lastSynced)} — still in Google Calendar at that time` : 'Never'}
          />
        )}
        {a.matchedKeyword && <Detail label="Matched keyword" value={`“${a.matchedKeyword}”`} />}
      </List>

      <Section title="Address">
        {loc?.autoLocated ? (
          <Banner tone="info" title="Located automatically from the calendar address">
            Check that the pin is at the right building. The address text comes from your calendar; only the map position was looked up.
            <div className="mt-2">
              <Button small onClick={() => void put('locations', { ...loc, autoLocated: false, updatedAt: nowIso() }).then(() => toast('Location confirmed'))}>
                Looks right
              </Button>
            </div>
          </Banner>
        ) : loc ? (
          <Banner tone="ok" title={`Confirmed: ${locationTitle(loc)}`}>
            {formatAddress(loc) || 'No street address'}
            {!hasCoords(loc) && <div className="text-warn">No map position — distances cannot be calculated yet.</div>}
          </Banner>
        ) : (
          <Banner tone="warn" title={a.locationRaw ? 'Address not yet confirmed' : 'No location in the calendar event'}>
            {a.locationRaw ? 'Check and confirm the address so it can be used for routing. It will be saved to your clinic address book.' : 'Link a saved clinic or enter the address.'}
          </Banner>
        )}
        <div className="mt-2 flex flex-wrap gap-2">
          <Button small variant="tinted" onClick={confirmAddress}>
            {loc ? 'Use a new address' : a.locationRaw ? 'Confirm / correct address' : 'Enter address'}
          </Button>
          {loc && (
            <Button small variant="secondary" onClick={() => setEditLoc({ draft: { id: loc.id } })}>
              Edit clinic
            </Button>
          )}
          {mapsQuery && (
            <a className="inline-flex items-center gap-1 rounded-xl bg-fill px-3 py-1.5 text-[14px] font-semibold text-accent" href={googleMapsUrl(mapsQuery)} target="_blank" rel="noopener">
              <IconMap size={16} /> Google Maps
            </a>
          )}
        </div>
        <List className="mt-2">
          <Field label="Or link to a saved place">
            <LocationSelect
              value={a.locationId}
              onChange={(id) => void update({ locationId: id, locationManual: !!id })}
              locations={locations}
              noneLabel="Not linked"
            />
          </Field>
        </List>
      </Section>

      <Section title="Tracking">
        <List>
          <Toggle checked={a.excluded} onChange={(v) => void update({ excluded: v })} label="Don't track this appointment" hint="Excluded from routes, statistics and reports. Sync will not re-add it." />
        </List>
      </Section>

      <Section title={`Linked trips (${linkedTrips.length})`}>
        {linkedTrips.length ? (
          <List>
            {linkedTrips.map((t) => (
              <Row
                key={t.id}
                title={`${t.start.label || 'Start'} → ${t.end.label || 'Destination'}`}
                subtitle={`${fmtDateTime(t.startTime)} · ${t.distanceSource ? SOURCE_LABEL[t.distanceSource] : 'No distance'}`}
                detail={fmtKm(effectiveKm(t))}
              />
            ))}
          </List>
        ) : (
          <Card className="px-4 py-3 text-[14px] text-muted">No trips linked yet. Use the route planner, or link a recorded trip from the Trips tab.</Card>
        )}
      </Section>

      <Button
        full
        onClick={() => {
          nav.openRouteFor(dateKey(a.start));
          onClose();
        }}
      >
        Plan route for {fmtWeekday(dateKey(a.start))}
      </Button>
      <Button full variant="danger" onClick={() => void del()}>
        {a.source === 'google' ? (a.excluded ? 'Already removed from schedule' : 'Remove from schedule') : 'Delete appointment'}
      </Button>

      <LocationEditor
        open={!!editLoc}
        draft={editLoc?.draft ?? null}
        sourceText={editLoc?.source}
        matchKey={editLoc?.key}
        titleMatch={editLoc?.title}
        onClose={() => setEditLoc(null)}
        onSaved={(l) => {
          if (a.locationId !== l.id) void update({ locationId: l.id, locationManual: !editLoc?.key });
        }}
      />
    </Sheet>
  );
}

function ManualAppointment({ open, onClose, settingsCats }: { open: boolean; onClose: () => void; settingsCats: { id: string; label: string }[] }) {
  const { locations } = useData();
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [cat, setCat] = useState(settingsCats[0]?.id ?? 'physio');
  const [locId, setLocId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const s = toLocalInput(new Date(Math.ceil(Date.now() / 36e5) * 36e5).toISOString());
    setTitle('');
    setStart(s);
    setEnd(toLocalInput(new Date(new Date(fromLocalInput(s)!).getTime() + 36e5).toISOString()));
    setLocId(null);
    setError(null);
  }, [open]);

  async function save() {
    const s = fromLocalInput(start);
    const e = fromLocalInput(end);
    if (!title.trim()) return setError('Enter a title.');
    if (!s || !e || e < s) return setError('Check the start and end times.');
    const stamp = nowIso();
    const appt: Appointment = {
      id: uid(),
      source: 'manual',
      calendarId: '',
      calendarName: '',
      eventId: '',
      summary: title.trim(),
      locationRaw: '',
      start: s,
      end: e,
      allDay: false,
      status: 'confirmed',
      statusNote: '',
      googleUpdated: '',
      categoryId: cat,
      categoryOverride: true,
      matchedKeyword: '',
      locationId: locId,
      locationManual: !!locId,
      excluded: false,
      lastSynced: '',
      createdAt: stamp,
      updatedAt: stamp,
    };
    await put('appointments', appt);
    toast('Appointment added');
    onClose();
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="New appointment"
      right={
        <button type="button" className="font-semibold text-accent" onClick={() => void save()}>
          Save
        </button>
      }
    >
      {error && <Banner tone="error">{error}</Banner>}
      <List>
        <Field label="Title">
          <TextInput value={title} onChange={setTitle} placeholder="e.g. Physio with Dr. Lee" />
        </Field>
        <Field label="Type">
          <Select value={cat} onChange={setCat} options={settingsCats.map((c) => ({ value: c.id, label: c.label }))} />
        </Field>
        <Field label="Starts">
          <input type="datetime-local" className="w-full bg-transparent py-1 text-[17px] outline-none" value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label="Ends">
          <input type="datetime-local" className="w-full bg-transparent py-1 text-[17px] outline-none" value={end} onChange={(e) => setEnd(e.target.value)} />
        </Field>
        <Field label="Place" hint="Add places in Treatments → Places.">
          <LocationSelect value={locId} onChange={setLocId} locations={locations} noneLabel="Not set" />
        </Field>
      </List>
    </Sheet>
  );
}

/* ---------------- Route planner ---------------- */

function RoutePlanner() {
  const { appointments, locations, routePlans, settings, trips, fuel } = useData();
  const nav = useNav();
  const toast = useToast();
  const day = nav.routeDate;
  const [results, setResults] = useState<Map<string, SegmentState>>(new Map());
  const [calculating, setCalculating] = useState(false);
  const [addingStop, setAddingStop] = useState(false);
  const [editKm, setEditKm] = useState<string | null>(null);
  const [kmText, setKmText] = useState('');
  const [openAppt, setOpenAppt] = useState<string | null>(null);

  const apptMap = useMemo(() => new Map(appointments.map((a) => [a.id, a])), [appointments]);
  const locMap = useMemo(() => new Map(locations.map((l) => [l.id, l])), [locations]);
  const dayAppts = useMemo(() => dayAppointments(appointments, day), [appointments, day]);
  const stored = routePlans.find((p) => p.id === day);
  const plan = useMemo(() => reconcilePlan(stored, day, dayAppts, settings, locations, trips), [stored, day, dayAppts, settings, locations, trips]);
  const ws = workdayStatus(day, stored, settings, trips, locations);
  const workLoc = workLocationOf(settings, locations);
  const points = useMemo(() => buildPoints(plan, apptMap, locMap, settings), [plan, apptMap, locMap, settings]);
  const segments = useMemo(() => buildSegments(points, plan, results), [points, plan, results]);
  const costPerKm = useMemo(() => computeFuelStats(fuel).costPerKm, [fuel]);

  // Show previously calculated routes without new network requests.
  const pairSig = segments.map((s) => `${s.pairKey}:${s.kind}`).join('|') + settings.routingProvider;
  useEffect(() => {
    let alive = true;
    setResults(new Map());
    (async () => {
      for (const s of segments) {
        if (s.kind !== 'route' || !s.pairKey || !s.from.location || !s.to.location) continue;
        const r = await peekRoute(s.from.location as { lat: number; lng: number }, s.to.location as { lat: number; lng: number }, settings);
        if (r && alive) setResults((m) => new Map(m).set(s.pairKey!, { result: r }));
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairSig]);

  // Calculate missing legs automatically when the day opens (once per leg per session).
  const plannerPending = segments.filter((s) => s.kind === 'route' && s.pairKey && s.estKm == null && !s.loading && !s.error && !plannerTried.has(s.pairKey));
  const plannerSig = plannerPending.map((s) => s.pairKey).join('|');
  useEffect(() => {
    if (!plannerPending.length || plannerTried.size >= AUTO_LIMIT) return;
    plannerPending.forEach((s) => plannerTried.add(s.pairKey!));
    const t = setTimeout(() => void calculate(), 600); // let cached results load first
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plannerSig]);

  async function savePlan(p: RoutePlan) {
    await put('routePlans', { ...p, updatedAt: nowIso() });
  }

  async function calculate() {
    setCalculating(true);
    let failures = 0;
    for (const s of segments) {
      if (s.kind !== 'route' || !s.pairKey || s.estKm != null) continue;
      const key = s.pairKey;
      setResults((m) => new Map(m).set(key, { loading: true }));
      try {
        const r = await routeBetween(s.from.location as { lat: number; lng: number }, s.to.location as { lat: number; lng: number }, settings);
        setResults((m) => new Map(m).set(key, { result: r }));
      } catch (e) {
        failures++;
        setResults((m) => new Map(m).set(key, { error: errMsg(e) }));
      }
    }
    setCalculating(false);
    if (failures) toast(`${failures} segment${failures > 1 ? 's' : ''}: distance unavailable. You can enter them manually.`, 'error');
  }

  function moveStop(idx: number, dir: -1 | 1) {
    const stops = [...plan.stops];
    const j = idx + dir;
    if (j < 0 || j >= stops.length) return;
    [stops[idx], stops[j]] = [stops[j], stops[idx]];
    void savePlan({ ...plan, stops });
  }

  function toggleStop(idx: number) {
    const stops = plan.stops.map((s, i) => (i === idx ? { ...s, excluded: !s.excluded } : s));
    void savePlan({ ...plan, stops });
  }

  function removeStop(idx: number) {
    void savePlan({ ...plan, stops: plan.stops.filter((_, i) => i !== idx) });
  }

  function addStop(locId: string | null) {
    if (!locId) return;
    const stop: PlanStop = { key: uid(), type: 'location', appointmentId: null, locationId: locId, excluded: false };
    void savePlan({ ...plan, stops: [...plan.stops, stop] });
    setAddingStop(false);
  }

  function saveManualKm(seg: PlanSegment) {
    const v = parseNum(kmText);
    const manualKm = { ...plan.manualKm };
    if (v == null) delete manualKm[seg.manualKey];
    else if (v < 0 || v > 2000) return toast('Enter a distance between 0 and 2000 km', 'error');
    else manualKm[seg.manualKey] = v;
    void savePlan({ ...plan, manualKm });
    setEditKm(null);
  }

  async function saveTrips() {
    const existing = trips.filter((t) => t.origin === 'route-plan' && t.routePlanId === plan.id).length;
    if (existing && !confirm(`Replace the ${existing} estimated trip${existing > 1 ? 's' : ''} previously created for this day?`)) return;
    const r = await saveSegmentsAsTrips(plan, segments);
    toast(`${r.created} estimated trip${r.created === 1 ? '' : 's'} saved${r.skipped ? ` · ${r.skipped} skipped (no distance)` : ''}`);
  }

  const routeSegs = segments.filter((s) => s.kind !== 'same');
  const missing = segments.filter((s) => s.usedKm == null);
  const totalKm = segments.reduce((s, x) => s + (x.usedKm ?? 0), 0);
  const fuelEst = costPerKm.value != null && missing.length === 0 ? totalKm * costPerKm.value : null;
  const pending = segments.filter((s) => s.kind === 'route' && s.estKm == null && !s.loading).length;

  const markers: MapMarker[] = [];
  let n = 0;
  points.forEach((p) => {
    if (!p.location || !hasCoords(p.location)) return;
    const isStop = p.role === 'stop';
    if (isStop) n++;
    markers.push({ lat: p.location.lat!, lng: p.location.lng!, text: isStop ? String(n) : p.role === 'start' ? 'S' : 'E', kind: isStop ? 'stop' : p.role === 'start' ? 'home' : 'end', label: p.label });
  });
  const lines: MapLine[] = segments.filter((s) => s.geometry).map((s) => ({ points: s.geometry!, color: '#007aff' }));

  const segName = (p: (typeof points)[number]) =>
    p.appointments.length ? p.appointments.map((a) => categoryLabel(settings, a.categoryId).split(' /')[0]).join(' + ') : p.label;

  const actualFor = (s: PlanSegment) =>
    s.fromApptId || s.toApptId
      ? trips.filter((t) => t.origin !== 'route-plan' && !t.recording && t.fromAppointmentId === s.fromApptId && t.toAppointmentId === s.toApptId)
      : [];

  return (
    <>
      <Card className="flex items-center gap-2 px-2 py-2">
        <IconButton label="Previous day" onClick={() => nav.setRouteDate(addDays(day, -1))}>
          <IconBack size={18} />
        </IconButton>
        <div className="flex-1 text-center">
          <div className="text-[17px] font-semibold">{fmtWeekday(day)} — Route</div>
          <input type="date" value={day} onChange={(e) => e.target.value && nav.setRouteDate(e.target.value)} className="bg-transparent text-center text-[14px] text-accent outline-none" />
        </div>
        <IconButton label="Next day" onClick={() => nav.setRouteDate(addDays(day, 1))}>
          <IconChevron size={18} />
        </IconButton>
      </Card>

      {dayAppts.length === 0 && (
        <Banner tone="info">
          No treatment appointments on {fmtKey(day)}.
          <NextApptDay day={day} appointments={appointments} onGo={nav.setRouteDate} />
        </Banner>
      )}

      <List>
        <div className="space-y-2 px-4 py-3">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-medium text-muted">Work today</span>
            <span className="text-[12px] text-muted">
              {ws.reason === 'schedule'
                ? 'On your work schedule'
                : ws.reason === 'detected'
                  ? `Detected: arrived at work ${ws.trip?.endTime ? fmtTime(ws.trip.endTime) : ''}`
                  : ws.reason === 'set-on' || ws.reason === 'set-off'
                    ? 'Set by you'
                    : 'Not a workday'}
            </span>
          </div>
          <Segmented<'auto' | 'on' | 'off'>
            value={stored?.workday === true ? 'on' : stored?.workday === false ? 'off' : 'auto'}
            onChange={(v) => void savePlan({ ...plan, workday: v === 'auto' ? null : v === 'on' })}
            options={[
              { value: 'auto', label: `Auto (${ws.reason === 'set-on' || ws.reason === 'set-off' ? '—' : ws.on ? 'working' : 'off'})` },
              { value: 'on', label: 'Working' },
              { value: 'off', label: 'Not working' },
            ]}
          />
          {!workLoc && ws.on && <div className="text-[12px] text-warn">Add a work address (Work card on the Appointments page) so work can be added to the route.</div>}
        </div>
        <Field label="Start from" hint={!plan.startLocationId ? 'Set your Home in Places → add a place of type Home.' : undefined}>
          <LocationSelect value={plan.startLocationId} onChange={(id) => void savePlan({ ...plan, startLocationId: id })} locations={locations} noneLabel="Choose…" />
        </Field>
        <Field label="End at">
          <LocationSelect value={plan.endLocationId} onChange={(id) => void savePlan({ ...plan, endLocationId: id })} locations={locations} noneLabel="Choose…" />
        </Field>
      </List>

      <Section title="Stops" action={<Button small variant="plain" onClick={() => setAddingStop((v) => !v)}>{addingStop ? 'Cancel' : '+ Add stop'}</Button>}>
        {addingStop && (
          <List className="mb-2">
            <Field label="Add an intermediate stop">
              <LocationSelect value={null} onChange={addStop} locations={locations} noneLabel="Choose a saved place…" />
            </Field>
          </List>
        )}
        {plan.stops.length === 0 ? (
          <Card className="px-4 py-3 text-[14px] text-muted">No stops for this day.</Card>
        ) : (
          <List>
            {plan.stops.map((s, i) => {
              const a = s.appointmentId ? apptMap.get(s.appointmentId) : undefined;
              const l = a ? (a.locationId ? locMap.get(a.locationId) : undefined) : s.locationId ? locMap.get(s.locationId) : undefined;
              return (
                <div key={s.key} className={`flex items-center gap-2 px-3 py-2.5 ${s.excluded ? 'opacity-45' : ''}`}>
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => a && setOpenAppt(a.id)}>
                    <div className="text-[15px] font-medium">
                      {a ? (
                        <>
                          {fmtTime(a.start)} — {categoryLabel(settings, a.categoryId)}
                        </>
                      ) : s.workRole ? (
                        <>
                          {s.time ? fmtTime(s.time) : ''} — {s.workRole === 'work-start' ? 'Arrive at work' : 'Leave work'}
                        </>
                      ) : (
                        <>Stop — {l ? locationTitle(l) : 'Removed place'}</>
                      )}
                    </div>
                    <div className="truncate text-[13px] text-muted">
                      {l ? `${locationTitle(l)} · ${formatAddress(l)}` : a ? <span className="text-warn">Address not confirmed — tap to fix</span> : ''}
                    </div>
                  </button>
                  <div className="flex shrink-0 items-center gap-1">
                    <IconButton label="Move up" onClick={() => moveStop(i, -1)} className="h-8 w-8">
                      <IconUp size={16} />
                    </IconButton>
                    <IconButton label="Move down" onClick={() => moveStop(i, 1)} className="h-8 w-8">
                      <IconDown size={16} />
                    </IconButton>
                    {s.type === 'appointment' || s.workRole ? (
                      <button type="button" className="w-16 text-[13px] font-semibold text-accent" onClick={() => toggleStop(i)}>
                        {s.excluded ? 'Include' : 'Skip'}
                      </button>
                    ) : (
                      <IconButton label="Remove stop" onClick={() => removeStop(i)} className="h-8 w-8 text-bad">
                        <IconTrash size={16} />
                      </IconButton>
                    )}
                  </div>
                </div>
              );
            })}
          </List>
        )}
      </Section>

      {markers.length > 0 && <MapView markers={markers} lines={lines} height={260} />}

      <Section
        title="Route breakdown"
        action={
          pending > 0 ? (
            <Button small variant="tinted" onClick={() => void calculate()} disabled={calculating}>
              {calculating ? <Spinner size={14} /> : null} Calculate distances
            </Button>
          ) : undefined
        }
        footer={`Estimated driving distances from ${providerName(settings)} using OpenStreetMap data. Consecutive appointments at the same address count as 0 km.`}
      >
        <List>
          {segments.map((s) => {
            const actual = actualFor(s);
            return (
              <div key={s.index} className="px-4 py-3">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-[15px] font-medium">
                      {segName(s.from)} → {segName(s.to)}
                    </div>
                    <div className="text-[12px] text-muted">
                      {s.kind === 'same'
                        ? 'Same address'
                        : s.manualKm != null
                            ? `Manually entered${s.estKm != null ? ` · estimate ${fmtKm(s.estKm)}` : ''}`
                            : s.estKm != null
                              ? `${s.provider} estimate${s.durationMin ? ` · ~${Math.round(s.durationMin)} min` : ''}`
                              : s.kind === 'missing'
                                ? s.missingReason
                                : s.error
                                  ? `Distance unavailable: ${s.error}`
                                  : 'Not calculated yet'}
                    </div>
                    {actual.length > 0 && (
                      <div className="mt-0.5 text-[12px] text-good">
                        Actual: {actual.map((t) => `${fmtKm(effectiveKm(t))} (${t.distanceSource ? SOURCE_LABEL[t.distanceSource] : 'no distance'})`).join(', ')}
                      </div>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    {s.loading ? (
                      <Spinner />
                    ) : s.usedKm != null ? (
                      <span className="text-[16px] font-semibold tabular">{fmtKm(s.usedKm)}</span>
                    ) : (
                      <span className="text-[13px] font-medium text-warn">Distance unavailable</span>
                    )}
                    {s.kind !== 'same' && (
                      <button
                        type="button"
                        className="block w-full text-right text-[12px] text-accent"
                        onClick={() => {
                          setEditKm(s.manualKey);
                          setKmText(s.manualKm != null ? String(s.manualKm) : '');
                        }}
                      >
                        {s.manualKm != null ? 'Edit manual km' : 'Enter manually'}
                      </button>
                    )}
                  </div>
                </div>
                {editKm === s.manualKey && (
                  <div className="mt-2 flex items-center gap-2 rounded-xl bg-fill px-3 py-1">
                    <div className="flex-1">
                      <NumberInput value={kmText} onChange={setKmText} placeholder="km (blank to clear)" suffix="km" />
                    </div>
                    <Button small onClick={() => saveManualKm(s)}>
                      Save
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </List>
      </Section>

      <Card className="p-4">
        <div className="flex items-baseline justify-between">
          <span className="text-[15px] text-muted">Total estimated driving distance</span>
          <span className="text-[22px] font-bold tabular">{missing.length ? `${fmtNum1(totalKm)}+ km` : fmtKm(totalKm)}</span>
        </div>
        {missing.length > 0 && <div className="mt-0.5 text-[12px] text-warn">{missing.length} segment{missing.length > 1 ? 's' : ''} without a distance — total is incomplete.</div>}
        <div className="mt-2 flex items-baseline justify-between">
          <span className="text-[15px] text-muted">Estimated fuel expense</span>
          <span className="text-[18px] font-semibold tabular">{fuelEst != null ? fmtCADLong(fuelEst) : 'Unavailable'}</span>
        </div>
        <div className="mt-0.5 text-[12px] text-muted">
          {costPerKm.value != null ? `At ${fmtPerKm(costPerKm.value)} (${costPerKm.basis === 'verified' ? 'from full-tank records' : 'estimate'})` : `Fuel cost per km unavailable: ${costPerKm.detail}`}
        </div>
        <div className="mt-4 grid grid-cols-1 gap-2">
          <Button full onClick={() => void saveTrips()} disabled={routeSegs.length === 0}>
            Save as treatment trips
          </Button>
          <p className="text-center text-[12px] text-muted">Creates one estimated trip per segment, linked to its appointments. Recorded GPS or manual trips for the same legs take priority in reports.</p>
        </div>
      </Card>

      <AppointmentDetail apptId={openAppt} onClose={() => setOpenAppt(null)} />
    </>
  );
}

function NextApptDay({ day, appointments, onGo }: { day: string; appointments: Appointment[]; onGo: (d: string) => void }) {
  const next = appointments
    .filter((a) => isActiveAppt(a) && dateKey(a.start) > day)
    .sort((a, b) => a.start.localeCompare(b.start))[0];
  if (!next) return null;
  const k = dateKey(next.start);
  return (
    <button type="button" className="ml-1 font-semibold text-accent" onClick={() => onGo(k)}>
      Next: {fmtKey(k)} →
    </button>
  );
}

/* ---------------- Clinics & places ---------------- */

function Clinics() {
  const { locations, appointments, settings } = useData();
  const [edit, setEdit] = useState<{ draft: LocationDraft; source?: string; key?: string } | null>(null);
  const byKind = groupBy(locations, (l) => l.kind);
  const usage = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of appointments) if (a.locationId) m.set(a.locationId, (m.get(a.locationId) ?? 0) + 1);
    return m;
  }, [appointments]);

  // Unique calendar location texts that still need confirming
  const pending = useMemo(() => {
    const m = new Map<string, { raw: string; count: number; next: string }>();
    for (const a of appointments) {
      if (!isActiveAppt(a) || a.locationId || !a.locationRaw) continue;
      const k = normalizeKey(a.locationRaw);
      const cur = m.get(k);
      if (cur) {
        cur.count++;
        if (a.start < cur.next) cur.next = a.start;
      } else m.set(k, { raw: a.locationRaw, count: 1, next: a.start });
    }
    return [...m.entries()].sort((a, b) => b[1].count - a[1].count);
  }, [appointments]);

  const kinds: { kind: SavedLocation['kind']; title: string }[] = [
    { kind: 'home', title: 'Home' },
    { kind: 'work', title: 'Work' },
    { kind: 'clinic', title: 'Clinics & providers' },
    { kind: 'hospital', title: 'Hospitals' },
    { kind: 'lab', title: 'Labs & imaging' },
    { kind: 'pharmacy', title: 'Pharmacies' },
    { kind: 'office', title: 'Offices (ICBC, legal, assessments)' },
    { kind: 'other', title: 'Other places' },
  ];

  return (
    <>
      {(!locations.some((l) => l.kind === 'home') || !locations.some((l) => l.kind === 'work')) && (
        <Banner tone="info" title="Home and work">
          Routes start and end at Home by default; on your workdays they can start or end at Work (Settings → Work schedule).
          <div className="mt-2 flex flex-wrap gap-2">
            {!locations.some((l) => l.kind === 'home') && (
              <Button small onClick={() => setEdit({ draft: { kind: 'home', name: 'Home' } })}>
                Add home address
              </Button>
            )}
            {!locations.some((l) => l.kind === 'work') && (
              <Button small variant="tinted" onClick={() => setEdit({ draft: { kind: 'work', name: 'Work' } })}>
                Add work address
              </Button>
            )}
          </div>
        </Banner>
      )}

      {pending.length > 0 && (
        <Section title="Calendar locations to confirm" footer="Confirm once and every appointment with the same location text uses it.">
          <List>
            {pending.map(([key, p]) => (
              <Row
                key={key}
                title={<span className="whitespace-normal">{p.raw}</span>}
                subtitle={`${p.count} appointment${p.count > 1 ? 's' : ''}`}
                onClick={() => {
                  const parsed = parseAddress(p.raw);
                  setEdit({
                    draft: { kind: 'clinic', name: parsed.name, street: parsed.street, city: parsed.city, province: parsed.province || 'BC', postalCode: parsed.postalCode },
                    source: p.raw,
                    key,
                  });
                }}
              />
            ))}
          </List>
        </Section>
      )}

      {kinds.map(({ kind, title }) => {
        const list = (byKind.get(kind) ?? []).sort((a, b) => locationTitle(a).localeCompare(locationTitle(b)));
        if (!list.length && kind !== 'clinic') return null;
        return (
          <Section key={kind} title={title}>
            {list.length ? (
              <List>
                {list.map((l) => (
                  <Row
                    key={l.id}
                    title={
                      <span className="flex items-center gap-2">
                        <span className="truncate">{locationTitle(l)}</span>
                        {settings.homeLocationId === l.id && <Badge tone="green">Default home</Badge>}
                        {!hasCoords(l) && <Badge tone="orange">No map position</Badge>}
                      </span>
                    }
                    subtitle={`${formatAddress(l) || 'No street address'}${usage.get(l.id) ? ` · ${usage.get(l.id)} appointments` : ''}`}
                    onClick={() => setEdit({ draft: { id: l.id } })}
                  />
                ))}
              </List>
            ) : (
              <Card className="px-4 py-3 text-[14px] text-muted">No places saved yet. Confirm an appointment address or add one.</Card>
            )}
          </Section>
        );
      })}

      <Button full variant="secondary" onClick={() => setEdit({ draft: { kind: 'clinic' } })}>
        <IconPlus size={18} /> Add place
      </Button>

      <LocationEditor open={!!edit} draft={edit?.draft ?? null} sourceText={edit?.source} matchKey={edit?.key} onClose={() => setEdit(null)} />
    </>
  );
}
