import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, NumberInput, Section, Spinner, TextInput, useToast } from './ui';
import { useData } from '../lib/data';
import { computeFuelStats } from '../lib/fuel';
import { confirmLeg, otherTrip, pendingLegs, recentDayPlans, skipLeg, type PendingLeg } from '../lib/confirm';
import { pairsOf, useRouteResults } from '../lib/useRoutes';
import { categoryLabel } from '../lib/settings';
import { fmtDateShort, fmtTime } from '../lib/time';
import { fmtCAD, fmtKm } from '../lib/format';
import { errMsg, parseNum } from '../lib/util';

const tried = new Set<string>();

/** "Trips to confirm": one card per past appointment leg you haven't answered yet. */
export default function ConfirmTrips() {
  const { appointments, routePlans, settings, locations, trips, fuel, loaded } = useData();
  const [showAll, setShowAll] = useState(false);
  const cpk = useMemo(() => computeFuelStats(fuel).costPerKm.value, [fuel]);
  const days = useMemo(() => recentDayPlans(appointments, routePlans, settings, locations, trips), [appointments, routePlans, settings, locations, trips]);
  const pairs = useMemo(() => days.flatMap((d) => pairsOf(d.points)), [days]);
  const { results, calculate } = useRouteResults(pairs, settings);
  const legs = useMemo(() => pendingLegs(days, results, trips, settings.workSince), [days, results, trips, settings.workSince]);

  // Estimate missing distances for the legs being asked about (cached, rate-limited)
  const missing = legs.filter((l) => l.seg.kind === 'route' && l.seg.estKm == null && l.seg.pairKey && !tried.has(l.seg.pairKey));
  const missingSig = missing.map((l) => l.seg.pairKey).join('|');
  useEffect(() => {
    const list = pairs.filter((p) => missing.some((l) => l.seg.pairKey === p.key));
    if (!list.length) return;
    list.forEach((p) => tried.add(p.key));
    void calculate(list);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missingSig]);

  if (!loaded || legs.length === 0) return null;
  const shown = showAll ? legs : legs.slice(0, 3);
  return (
    <Section
      title={
        <span className="flex items-center gap-2">
          Trips to confirm <Badge tone="orange">{legs.length}</Badge>
        </span>
      }
      footer="Tap ✓ if you drove the leg as planned. If you took a detour, enter the actual km (from the CarPlay GPS recording, Google Maps Timeline or your trip meter) before confirming."
    >
      <div className="space-y-3">
        {shown.map((l) => (
          <LegCard key={l.day + l.key} leg={l} cpk={cpk} labelOf={(id) => categoryLabel(settings, id)} />
        ))}
        {legs.length > 3 && (
          <Button small variant="plain" onClick={() => setShowAll((v) => !v)}>
            {showAll ? 'Show fewer' : `Show all ${legs.length}`}
          </Button>
        )}
      </div>
    </Section>
  );
}

function LegCard({ leg, cpk, labelOf }: { leg: PendingLeg; cpk: number | null; labelOf: (id: string) => string }) {
  const toast = useToast();
  const [actual, setActual] = useState('');
  const [mode, setMode] = useState<'ask' | 'other'>('ask');
  const [desc, setDesc] = useState('');
  const [otherKm, setOtherKm] = useState('');
  const [busy, setBusy] = useState(false);
  const s = leg.seg;
  const planned = s.usedKm;
  const actualNum = parseNum(actual);
  const gpsKm = leg.gps?.gpsKm ?? null;
  const effective = actualNum ?? gpsKm ?? planned;
  const detour = effective != null && planned != null ? effective - planned : null;
  const name = (p: typeof s.from) => (p.appointments.length ? labelOf(p.appointments[0].categoryId).split(' /')[0] : p.work ? 'Work' : p.label);
  const commute = !s.fromApptId && !s.toApptId;
  const money = (km: number | null) => (km != null && cpk != null ? fmtCAD(km * cpk) : '—');

  async function run(fn: () => Promise<unknown>, msg: string) {
    setBusy(true);
    try {
      await fn();
      toast(msg);
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="overflow-hidden">
      <div className="px-4 pt-3.5 pb-3">
        <div className="text-[12px] font-semibold text-muted uppercase">
          {fmtDateShort(leg.start)} · {fmtTime(leg.start)}–{fmtTime(leg.end)}
        </div>
        <div className="mt-1 text-[17px] leading-snug font-semibold">
          {commute ? '💼' : '🚗'} {name(s.from)} → {name(s.to)}
          {commute && <span className="ml-2 align-middle"><Badge>Commute</Badge></span>}
        </div>
        <div className="text-[13px] text-muted">
          {s.from.label} → {s.to.label}
        </div>
        <div className="mt-2.5 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-fill px-2 py-2">
            <div className="text-[11px] text-muted">Planned</div>
            <div className="text-[15px] font-bold tabular">{planned != null ? fmtKm(planned) : s.loading ? <Spinner size={12} /> : '—'}</div>
            <div className="text-[11px] text-muted tabular">⛽ {money(planned)}</div>
          </div>
          <div className="rounded-xl bg-fill px-2 py-2">
            <div className="text-[11px] text-muted">Actual</div>
            <div className="text-[15px] font-bold tabular">{effective != null ? fmtKm(effective) : '—'}</div>
            <div className="text-[11px] text-muted tabular">⛽ {money(effective)}</div>
          </div>
          <div className={`rounded-xl px-2 py-2 ${detour != null && detour > 0.05 ? 'bg-warn/15' : 'bg-fill'}`}>
            <div className="text-[11px] text-muted">Detour</div>
            <div className={`text-[15px] font-bold tabular ${detour != null && detour > 0.05 ? 'text-warn' : ''}`}>
              {detour == null ? '—' : `${detour > 0 ? '+' : ''}${detour.toFixed(1)} km`}
            </div>
            <div className="text-[11px] text-muted tabular">{detour != null && cpk != null ? `${detour >= 0 ? '+' : '−'}${fmtCAD(Math.abs(detour * cpk))}` : '—'}</div>
          </div>
        </div>
        {leg.gps && (
          <div className="mt-2 rounded-xl bg-good/12 px-3 py-2 text-[13px]">
            📍 GPS recording found ({fmtTime(leg.gps.startTime)}, {fmtKm(leg.gps.gpsKm)}) — it will be used as the actual distance.
          </div>
        )}
        {mode === 'ask' && (
          <div className="mt-2.5 flex items-center gap-2 rounded-xl bg-fill px-3 py-1">
            <span className="shrink-0 text-[13px] text-muted">Actual km</span>
            <div className="flex-1">
              <NumberInput value={actual} onChange={setActual} placeholder={gpsKm != null ? `${gpsKm.toFixed(1)} (GPS)` : planned != null ? `${planned.toFixed(1)} (as planned)` : 'enter km'} suffix="km" />
            </div>
          </div>
        )}
      </div>

      {mode === 'ask' ? (
        <div className="grid grid-cols-2 gap-2 px-4 pb-4">
          <Button
            disabled={busy || (effective == null)}
            onClick={() => void run(() => confirmLeg(leg, actualNum, cpk), detour != null && detour > 0.05 ? `Saved · detour +${detour.toFixed(1)} km` : 'Trip confirmed')}
          >
            ✓ Yes, I drove it
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => setMode('other')}>
            ✕ No
          </Button>
        </div>
      ) : (
        <div className="space-y-2 px-4 pb-4">
          <div className="rounded-xl bg-fill px-3 py-1">
            <TextInput value={desc} onChange={setDesc} placeholder="What trip was it? e.g. went to Costco instead" />
          </div>
          <div className="rounded-xl bg-fill px-3 py-1">
            <NumberInput value={otherKm} onChange={setOtherKm} placeholder="km driven (optional)" suffix="km" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button
              disabled={busy || !desc.trim()}
              onClick={() => void run(() => otherTrip(leg, desc.trim(), parseNum(otherKm), cpk), 'Saved as another trip')}
            >
              Save
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => void run(() => skipLeg(leg, desc.trim()), "Marked as not driven")}>
              Didn’t drive
            </Button>
          </div>
          <button type="button" className="w-full text-center text-[13px] text-accent" onClick={() => setMode('ask')}>
            Back
          </button>
        </div>
      )}
    </Card>
  );
}
