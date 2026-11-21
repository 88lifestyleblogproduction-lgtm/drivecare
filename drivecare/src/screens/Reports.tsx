import { useMemo, useState } from 'react';
import { Badge, BasisBadge, Banner, Button, Card, Field, List, Page, Row, Section, Segmented, Select, Spinner, Stat, useToast } from '../components/ui';
import { IconCalendar, IconFuel, IconRoute, IconShare, IconTreatment } from '../components/Icons';
import { BarChart } from '../components/Charts';
import { useData } from '../lib/data';
import { computeFuelStats } from '../lib/fuel';
import { buildTreatmentReport, LEG_LABEL, type ReportFilter } from '../lib/report';
import { fuelCsv, reportCsv, reportPdf, tripsCsv } from '../lib/exports';
import { saveFile } from '../lib/files';
import { addMonths, fmtKey, fmtMonthShort, monthEndKey, monthStartKey, thisMonthKey, todayKey } from '../lib/time';
import { fmtCAD, fmtKm, fmtPerKm } from '../lib/format';
import { locationTitle } from '../lib/address';
import { errMsg } from '../lib/util';

export default function ReportsScreen() {
  const [view, setView] = useState<'treatment' | 'exports'>('treatment');
  return (
    <Page title="Reports" subtitle="Treatment travel records and exports">
      <Segmented
        value={view}
        onChange={setView}
        options={[
          { value: 'treatment', label: 'Treatment travel' },
          { value: 'exports', label: 'Other exports' },
        ]}
      />
      {view === 'treatment' ? <TreatmentReportView /> : <OtherExports />}
    </Page>
  );
}

function TreatmentReportView() {
  const { appointments, trips, locations, settings, fuel } = useData();
  const toast = useToast();
  const m = thisMonthKey();
  const [filter, setFilter] = useState<ReportFilter>({ startKey: monthStartKey(m), endKey: monthEndKey(m), categoryId: 'all', locationId: 'all' });
  const [busy, setBusy] = useState<'' | 'pdf' | 'csv'>('');
  const costPerKm = useMemo(() => computeFuelStats(fuel).costPerKm, [fuel]);
  const report = useMemo(() => buildTreatmentReport(filter, appointments, trips, locations, settings, costPerKm), [filter, appointments, trips, locations, settings, costPerKm]);
  const clinics = locations.filter((l) => (l.kind !== 'home' && l.kind !== 'work') || appointments.some((a) => a.locationId === l.id));
  const set = (p: Partial<ReportFilter>) => setFilter((f) => ({ ...f, ...p }));

  const monthly = useMemo(() => {
    return Array.from({ length: 6 }, (_, i) => addMonths(m, i - 5)).map((mk) => {
      const r = buildTreatmentReport({ startKey: monthStartKey(mk), endKey: monthEndKey(mk), categoryId: filter.categoryId, locationId: filter.locationId }, appointments, trips, locations, settings, costPerKm);
      return { label: fmtMonthShort(mk), value: r.totals.totalKm };
    });
  }, [m, filter.categoryId, filter.locationId, appointments, trips, locations, settings, costPerKm]);

  function preset(p: 'this' | 'last' | 'ytd' | '90') {
    const t = todayKey();
    if (p === 'this') set({ startKey: monthStartKey(m), endKey: monthEndKey(m) });
    if (p === 'last') {
      const lm = addMonths(m, -1);
      set({ startKey: monthStartKey(lm), endKey: monthEndKey(lm) });
    }
    if (p === 'ytd') set({ startKey: `${t.slice(0, 4)}-01-01`, endKey: t });
    if (p === '90') {
      const d = new Date(Date.UTC(+t.slice(0, 4), +t.slice(5, 7) - 1, +t.slice(8, 10) - 89)).toISOString().slice(0, 10);
      set({ startKey: d, endKey: t });
    }
  }

  async function exportPdf() {
    setBusy('pdf');
    try {
      const blob = await reportPdf(report, settings, locations);
      await saveFile(blob, `DriveCare-treatment-travel-${filter.startKey}-to-${filter.endKey}.pdf`);
    } catch (e) {
      toast(`PDF export failed: ${errMsg(e)}`, 'error');
    } finally {
      setBusy('');
    }
  }
  async function exportCsv() {
    setBusy('csv');
    try {
      await saveFile(reportCsv(report), `DriveCare-treatment-travel-${filter.startKey}-to-${filter.endKey}.csv`);
    } catch (e) {
      toast(`CSV export failed: ${errMsg(e)}`, 'error');
    } finally {
      setBusy('');
    }
  }

  const t = report.totals;
  return (
    <>
      <List>
        <div className="grid grid-cols-2 divide-x divide-line">
          <Field label="Start date">
            <input type="date" className="w-full bg-transparent py-1 text-[17px] outline-none" value={filter.startKey} onChange={(e) => e.target.value && set({ startKey: e.target.value })} />
          </Field>
          <Field label="End date">
            <input type="date" className="w-full bg-transparent py-1 text-[17px] outline-none" value={filter.endKey} onChange={(e) => e.target.value && set({ endKey: e.target.value })} />
          </Field>
        </div>
        <div className="flex flex-wrap gap-2 px-4 py-2.5">
          {(
            [
              ['this', 'This month'],
              ['last', 'Last month'],
              ['90', 'Last 90 days'],
              ['ytd', 'Year to date'],
            ] as const
          ).map(([k, label]) => (
            <Button key={k} small variant="secondary" onClick={() => preset(k)}>
              {label}
            </Button>
          ))}
        </div>
        <Field label="Treatment type">
          <Select value={filter.categoryId} onChange={(v) => set({ categoryId: v })} options={[{ value: 'all', label: 'All treatment appointments' }, ...settings.categories.map((c) => ({ value: c.id, label: c.label }))]} />
        </Field>
        <Field label="Clinic / place">
          <Select value={filter.locationId} onChange={(v) => set({ locationId: v })} options={[{ value: 'all', label: 'All places' }, ...clinics.map((l) => ({ value: l.id, label: locationTitle(l) }))]} />
        </Field>
      </List>

      {filter.startKey > filter.endKey && <Banner tone="error">The start date is after the end date.</Banner>}

      <div className="grid grid-cols-2 gap-3">
        <Stat icon={<IconTreatment size={16} />} tone="teal" label="Treatment km" value={fmtKm(t.totalKm)} sub={`Out ${fmtKm(t.outboundKm)} · Between ${fmtKm(t.betweenKm)} · Return ${fmtKm(t.returnKm)}`} />
        <Stat icon={<IconFuel size={16} />} tone="orange" label="Est. fuel cost" value={t.estCost != null ? fmtCAD(t.estCost) : <span className="text-[17px] text-muted">Unavailable</span>} badge={<BasisBadge basis={costPerKm.basis === 'unavailable' ? 'unavailable' : 'estimate'} />} sub={costPerKm.value != null ? `At ${fmtPerKm(costPerKm.value)}` : costPerKm.detail} />
        <Stat icon={<IconCalendar size={16} />} tone="purple" label="Appointments" value={String(t.appointments)} sub={`${report.apptsWithoutTravel.length} without recorded travel`} />
        <Stat icon={<IconRoute size={16} />} tone="blue" label="Associated trips" value={String(t.trips)} sub={t.costPerTrip != null ? `≈ ${fmtCAD(t.costPerTrip)} per trip` : t.tripsMissingDistance ? `${t.tripsMissingDistance} without distance` : 'Cost per trip unavailable'} />
      </div>

      <Section title="Treatment km by month">
        <Card className="p-3">
          <BarChart data={monthly} fmt={(n) => `${Math.round(n)} km`} color="#30b0c7" />
        </Card>
      </Section>

      <div className="grid grid-cols-2 gap-3">
        <Button onClick={() => void exportPdf()} disabled={!!busy || filter.startKey > filter.endKey}>
          {busy === 'pdf' ? <Spinner size={16} /> : <IconShare size={18} />} PDF
        </Button>
        <Button variant="secondary" onClick={() => void exportCsv()} disabled={!!busy || filter.startKey > filter.endKey}>
          {busy === 'csv' ? <Spinner size={16} /> : <IconShare size={18} />} CSV
        </Button>
      </div>

      {report.byCategory.length > 0 && (
        <Section title="By treatment type">
          <List>
            {report.byCategory.map((b) => (
              <Row key={b.key} title={b.label} subtitle={`${b.appts} appointments · ${b.trips} trips${b.cost != null ? ` · ${fmtCAD(b.cost)}` : ''}`} detail={fmtKm(b.km)} />
            ))}
          </List>
        </Section>
      )}
      {report.byClinic.length > 0 && (
        <Section title="By clinic / provider">
          <List>
            {report.byClinic.map((b) => (
              <Row key={b.key} title={b.label} subtitle={`${b.appts} appointments · ${b.trips} trips`} detail={fmtKm(b.km)} />
            ))}
          </List>
        </Section>
      )}

      <Section title={`Travel log (${report.rows.length})`} footer="Each trip appears once: trips to an appointment are attributed to it; return trips to the appointment they leave. Where you recorded an actual trip for a leg, the route-planner estimate for that leg is not counted.">
        {report.rows.length ? (
          <List>
            {report.rows.map((r) => (
              <Row
                key={r.tripId}
                title={`${r.fromLabel} → ${r.toLabel}`}
                subtitle={
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span>
                      {fmtKey(r.date)} · {r.treatment}
                    </span>
                    <Badge>{LEG_LABEL[r.leg]}</Badge>
                    <Badge tone={r.source === 'Routing estimate' ? 'orange' : 'gray'}>{r.source}</Badge>
                  </span>
                }
                detail={
                  <div>
                    <div className="font-semibold text-ink">{fmtKm(r.km)}</div>
                    {r.estCost != null && <div className="text-[12px]">{fmtCAD(r.estCost)}</div>}
                  </div>
                }
              />
            ))}
          </List>
        ) : (
          <Card className="px-4 py-3 text-[14px] text-muted">No treatment trips in this period. Create them from Treatments → Route, or link recorded trips to appointments.</Card>
        )}
      </Section>

      <Banner tone="info">
        This report organises your own records for submission or review. It does not determine whether any travel or expense is eligible for reimbursement by ICBC.
        Fuel costs are estimates based on your own fuel records.
      </Banner>
    </>
  );
}

function OtherExports() {
  const { fuel, trips } = useData();
  const toast = useToast();
  async function go(blob: Blob, name: string) {
    try {
      await saveFile(blob, name);
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  }
  const stamp = todayKey();
  return (
    <>
      <List>
        <Row title="Fuel purchases (CSV)" subtitle={`${fuel.length} records`} onClick={() => void go(fuelCsv(fuel), `DriveCare-fuel-${stamp}.csv`)} />
        <Row title="All trips (CSV)" subtitle={`${trips.filter((t) => !t.recording).length} records, with distance source for each`} onClick={() => void go(tripsCsv(trips), `DriveCare-trips-${stamp}.csv`)} />
      </List>
      <p className="px-1 text-[12px] leading-relaxed text-muted">For a full backup you can restore later (including receipt photos), use Settings → Back up data. On iPhone, exported files open the share sheet — choose “Save to Files”.</p>
      <p className="px-1 text-[12px] text-muted">Covers records up to {fmtKey(stamp)}.</p>
    </>
  );
}
