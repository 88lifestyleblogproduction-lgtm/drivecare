import { useEffect, useMemo, useState } from 'react';
import { type Tone, Badge, BasisBadge, Button, Card, Empty, Field, IconButton, List, NumberInput, Page, Row, Section, Segmented, Sheet, Spinner, Stat, TextArea, TextInput, Toggle, Banner, useToast } from '../components/ui';
import { IconCamera, IconPlus } from '../components/Icons';
import { BarChart, LineChart } from '../components/Charts';
import { useData } from '../lib/data';
import { completeFuelAmounts, computeFuelStats, type FuelStats, type Metric } from '../lib/fuel';
import { get, put, remove } from '../lib/db';
import { compressImage } from '../lib/files';
import { addMonths, fmtDate, fmtDateShort, fmtMonthShort, fmtTime, fromLocalInput, thisMonthKey, toLocalInput } from '../lib/time';
import { fmtCAD, fmtInt, fmtKm, fmtL100, fmtLitres, fmtNum1, fmtPerKm, fmtPerL } from '../lib/format';
import type { FuelEntry, ReceiptRecord } from '../lib/types';
import { errMsg, nowIso, numStr, parseNum, uid } from '../lib/util';

export default function FuelScreen() {
  const { fuel, loaded } = useData();
  const [view, setView] = useState<'log' | 'stats'>('log');
  const [editing, setEditing] = useState<FuelEntry | 'new' | null>(null);
  const stats = useMemo(() => computeFuelStats(fuel), [fuel]);

  return (
    <Page
      title="Fuel"
      subtitle={stats.count ? `${stats.count} purchases · ${fmtCAD(stats.totalSpent)} total` : 'Track every fill-up'}
      right={
        <IconButton label="Add fuel purchase" onClick={() => setEditing('new')}>
          <IconPlus />
        </IconButton>
      }
    >
      <Segmented
        value={view}
        onChange={setView}
        options={[
          { value: 'log', label: 'Purchases' },
          { value: 'stats', label: 'Statistics' },
        ]}
      />
      {!loaded ? null : view === 'log' ? <FuelLog stats={stats} onEdit={setEditing} onAdd={() => setEditing('new')} /> : <FuelStatsView stats={stats} />}
      <FuelEditor entry={editing} stats={stats} onClose={() => setEditing(null)} />
    </Page>
  );
}

function FuelLog({ stats, onEdit, onAdd }: { stats: FuelStats; onEdit: (e: FuelEntry) => void; onAdd: () => void }) {
  const rows = [...stats.entries].reverse();
  if (!rows.length)
    return (
      <Empty
        title="No fuel purchases yet"
        text="Add each fill-up with litres, total and odometer. Fill the tank completely when you can — two consecutive full tanks give a verified L/100 km and cost per km."
        action={<Button onClick={onAdd}>Add first purchase</Button>}
      />
    );
  return (
    <List>
      {rows.map((e) => {
        const gap = stats.daysSincePrevious.get(e.id);
        return (
          <Row
            key={e.id}
            onClick={() => onEdit(e)}
            title={
              <span className="flex items-center gap-2">
                <span className="truncate">{e.station || 'Fuel purchase'}</span>
                {e.fullTank ? <Badge tone="green">Full</Badge> : <Badge tone="orange">Partial</Badge>}
                {e.hasReceipt && <IconCamera size={14} className="text-muted" />}
              </span>
            }
            subtitle={
              <>
                {fmtDateShort(e.datetime)} · {fmtTime(e.datetime)}
                {gap != null && ` · ${gap} day${gap === 1 ? '' : 's'} after previous`}
                <br />
                {fmtLitres(e.litres)} · {fmtPerL(e.pricePerLitre)}
                {e.odometer != null && ` · ${fmtInt(e.odometer)} km`}
              </>
            }
            detail={<span className="font-semibold text-ink">{fmtCAD(e.total)}</span>}
          />
        );
      })}
    </List>
  );
}

function MetricCard({ label, m, fmt, tone }: { label: string; m: Metric; fmt: (n: number) => string; tone?: Tone }) {
  return <Stat tone={tone} label={label} value={m.value == null ? <span className="text-[17px] text-muted">Unavailable</span> : fmt(m.value)} badge={<BasisBadge basis={m.basis} />} sub={m.detail} />;
}

function FuelStatsView({ stats }: { stats: FuelStats }) {
  const months = Array.from({ length: 12 }, (_, i) => addMonths(thisMonthKey(), i - 11));
  const byMonth = new Map(stats.monthly.map((m) => [m.month, m]));
  const thisMonth = byMonth.get(thisMonthKey());
  const spendData = months.map((m) => ({ label: fmtMonthShort(m), value: byMonth.get(m)?.spent ?? 0 }));
  const priceData = stats.entries.filter((e) => e.pricePerLitre != null).slice(-20).map((e) => ({ label: fmtDateShort(e.datetime).replace(/^\w+, /, ''), value: e.pricePerLitre }));
  const consData = stats.intervals.filter((i) => i.included).slice(-20).map((i) => ({ label: fmtDateShort(i.toDate).replace(/^\w+, /, ''), value: i.lPer100 }));

  if (!stats.count) return <Empty title="No statistics yet" text="Statistics appear after you add fuel purchases." />;

  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <Stat label="This month" value={fmtCAD(thisMonth?.spent ?? 0)} sub={`${thisMonth?.count ?? 0} purchases · ${fmtLitres(thisMonth?.litres ?? 0)}`} badge={<BasisBadge basis="verified" />} />
        <MetricCard tone="orange" label="Avg price" m={stats.avgPricePerLitre} fmt={fmtPerL} />
        <MetricCard tone="green" label="Fuel economy" m={stats.avgConsumption} fmt={fmtL100} />
        <MetricCard tone="blue" label="Cost per km" m={stats.costPerKm} fmt={fmtPerKm} />
        <MetricCard tone="purple" label="Days per refuel" m={stats.avgDaysBetween} fmt={(n) => `${fmtNum1(n)} days`} />
        <MetricCard tone="pink" label="Daily fuel cost" m={stats.avgDailyExpense} fmt={fmtCAD} />
        <MetricCard tone="teal" label="Monthly driving" m={stats.avgMonthlyKm} fmt={fmtKm} />
        <Stat label="All-time" value={fmtCAD(stats.totalSpent)} sub={`${fmtLitres(stats.totalLitres)} over ${stats.count} purchases`} badge={<BasisBadge basis="verified" />} />
      </div>
      <p className="px-1 text-[12px] leading-relaxed text-muted">
        <b>Verified</b> figures come directly from your records (consumption only from consecutive full-tank fill-ups with odometer readings). <b>Estimates</b> are approximations
        and are labelled wherever they are used.
      </p>

      <Section title="Monthly fuel spending">
        <Card className="p-3">
          <BarChart data={spendData} fmt={(n) => fmtCAD(n).replace('.00', '')} />
        </Card>
      </Section>
      <Section title="Fuel economy (full-tank intervals)">
        <Card className="p-3">
          <LineChart data={consData} fmt={(n) => n.toFixed(1)} color="#34c759" />
        </Card>
      </Section>
      <Section title="Price per litre">
        <Card className="p-3">
          <LineChart data={priceData} fmt={(n) => `$${n.toFixed(2)}`} color="#ff9500" />
        </Card>
      </Section>

      {stats.intervals.length > 0 && (
        <Section title="Full-tank intervals" footer="Litres include partial fills between the two full tanks. Intervals with problems are excluded from averages.">
          <List>
            {[...stats.intervals].reverse().map((i) => (
              <Row
                key={i.toId}
                title={`${fmtDate(i.toDate)}`}
                subtitle={i.included ? `${fmtNum1(i.km)} km · ${fmtLitres(i.litres)}${i.cost != null ? ` · ${fmtCAD(i.cost)}` : ''}` : i.reason}
                detail={i.included ? fmtL100(i.lPer100) : <Badge tone="orange">Excluded</Badge>}
              />
            ))}
          </List>
        </Section>
      )}

      <Section title="By month">
        <List>
          {[...stats.monthly].reverse().map((m) => (
            <Row key={m.month} title={fmtMonthShort(m.month) + ' ' + m.month.slice(0, 4)} subtitle={`${m.count} purchases · ${fmtLitres(m.litres)}`} detail={fmtCAD(m.spent)} />
          ))}
        </List>
      </Section>
    </>
  );
}

interface Form {
  datetime: string;
  station: string;
  price: string;
  litres: string;
  total: string;
  odometer: string;
  fullTank: boolean;
  missedPrevious: boolean;
  notes: string;
}

function FuelEditor({ entry, stats, onClose }: { entry: FuelEntry | 'new' | null; stats: FuelStats; onClose: () => void }) {
  const toast = useToast();
  const open = entry !== null;
  const existing = entry && entry !== 'new' ? entry : null;
  const [f, setF] = useState<Form>(emptyForm());
  const [receipt, setReceipt] = useState<{ type: string; data: ArrayBuffer } | null>(null);
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null);
  const [receiptChanged, setReceiptChanged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setReceiptChanged(false);
    setReceipt(null);
    if (existing) {
      setF({
        datetime: toLocalInput(existing.datetime),
        station: existing.station,
        price: numStr(existing.pricePerLitre),
        litres: numStr(existing.litres),
        total: numStr(existing.total),
        odometer: numStr(existing.odometer),
        fullTank: existing.fullTank,
        missedPrevious: existing.missedPrevious,
        notes: existing.notes,
      });
      if (existing.hasReceipt) void get<ReceiptRecord>('receipts', existing.id).then((r) => r && setReceipt({ type: r.type, data: r.data }));
    } else {
      setF(emptyForm());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry]);

  useEffect(() => {
    if (!receipt) {
      setReceiptUrl(null);
      return;
    }
    const url = URL.createObjectURL(new Blob([receipt.data], { type: receipt.type }));
    setReceiptUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [receipt]);

  const set = (p: Partial<Form>) => setF((x) => ({ ...x, ...p }));
  const stations = useMemo(() => [...new Set(stats.entries.map((e) => e.station).filter(Boolean))], [stats.entries]);
  const prevOdo = useMemo(() => {
    const t = fromLocalInput(f.datetime);
    if (!t) return null;
    return [...stats.entries].reverse().find((e) => e.id !== existing?.id && e.datetime < t && e.odometer != null)?.odometer ?? null;
  }, [f.datetime, stats.entries, existing]);

  const price = parseNum(f.price);
  const litres = parseNum(f.litres);
  const total = parseNum(f.total);
  const computed = completeFuelAmounts(price, litres, total);
  const mismatch = price != null && litres != null && total != null && Math.abs(price * litres - total) > Math.max(0.05, total * 0.02);

  async function onPhoto(file: File | undefined) {
    if (!file) return;
    try {
      setReceipt(await compressImage(file));
      setReceiptChanged(true);
    } catch (e) {
      setError(errMsg(e));
    }
  }

  async function save() {
    setError(null);
    const dt = fromLocalInput(f.datetime);
    if (!dt) return setError('Enter the date and time.');
    if (computed.litres == null || computed.litres <= 0) return setError('Enter the litres purchased (or price and total).');
    if (computed.total == null || computed.total <= 0) return setError('Enter the total amount (or price and litres).');
    const odo = parseNum(f.odometer);
    if (odo != null && odo < 0) return setError('Odometer cannot be negative.');
    if (odo != null && prevOdo != null && odo < prevOdo && !confirm(`Odometer ${odo} is lower than the previous reading (${prevOdo}). Save anyway?`)) return;
    setBusy(true);
    try {
      const stamp = nowIso();
      const id = existing?.id ?? uid();
      const hasReceipt = receipt != null;
      const rec: FuelEntry = {
        id,
        datetime: dt,
        station: f.station.trim(),
        pricePerLitre: computed.price,
        litres: computed.litres,
        total: computed.total,
        odometer: odo,
        fullTank: f.fullTank,
        missedPrevious: f.missedPrevious,
        hasReceipt,
        notes: f.notes.trim(),
        createdAt: existing?.createdAt ?? stamp,
        updatedAt: stamp,
      };
      if (receiptChanged && receipt) await put<ReceiptRecord>('receipts', { id, type: receipt.type, data: receipt.data });
      if (!hasReceipt && existing?.hasReceipt) await remove('receipts', id);
      await put('fuel', rec);
      toast(existing ? 'Purchase updated' : 'Purchase saved');
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function del() {
    if (!existing || !confirm('Delete this fuel purchase?')) return;
    await remove('fuel', existing.id);
    if (existing.hasReceipt) await remove('receipts', existing.id);
    toast('Purchase deleted');
    onClose();
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={existing ? 'Fuel purchase' : 'New fuel purchase'}
      right={
        <button type="button" disabled={busy} className="font-semibold text-accent disabled:opacity-40" onClick={() => void save()}>
          {busy ? <Spinner /> : 'Save'}
        </button>
      }
    >
      {error && <Banner tone="error">{error}</Banner>}
      <List>
        <Field label="Date and time">
          <input type="datetime-local" className="w-full bg-transparent py-1 text-[17px] outline-none" value={f.datetime} onChange={(e) => set({ datetime: e.target.value })} />
        </Field>
        <Field label="Gas station">
          <TextInput value={f.station} onChange={(v) => set({ station: v })} placeholder="e.g. Chevron, W 4th Ave" list="dc-stations" />
          <datalist id="dc-stations">
            {stations.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </Field>
      </List>
      <List>
        <Field label="Price per litre" hint={price == null && computed.price != null ? `Calculated: ${fmtPerL(computed.price)}` : 'e.g. 1.879 (dollars per litre)'}>
          <NumberInput value={f.price} onChange={(v) => set({ price: v })} placeholder="1.879" suffix="$/L" />
        </Field>
        <Field label="Litres" hint={litres == null && computed.litres != null ? `Calculated: ${fmtLitres(computed.litres)}` : undefined}>
          <NumberInput value={f.litres} onChange={(v) => set({ litres: v })} placeholder="42.15" suffix="L" />
        </Field>
        <Field
          label="Total (CAD)"
          hint={total == null && computed.total != null ? `Calculated: ${fmtCAD(computed.total)}` : 'Enter any two of price, litres and total — the third is calculated.'}
          error={mismatch ? 'Price × litres does not match the total. Check the receipt.' : null}
        >
          <NumberInput value={f.total} onChange={(v) => set({ total: v })} placeholder="79.20" suffix="$" />
        </Field>
        <Field label="Odometer" hint={prevOdo != null ? `Previous reading: ${fmtInt(prevOdo)} km` : 'Needed for fuel economy and cost per km'}>
          <NumberInput value={f.odometer} onChange={(v) => set({ odometer: v })} placeholder="e.g. 48210" suffix="km" />
        </Field>
      </List>
      <List>
        <Toggle checked={f.fullTank} onChange={(v) => set({ fullTank: v })} label="Filled the tank completely" hint="Full-to-full fill-ups give accurate consumption." />
        <Toggle checked={f.missedPrevious} onChange={(v) => set({ missedPrevious: v })} label="I missed recording a previous fill-up" hint="Prevents an incorrect consumption calculation across the gap." />
      </List>
      <List>
        <div className="px-4 py-3">
          <div className="mb-2 text-[13px] font-medium text-muted">Receipt photo (optional, stored only on this device)</div>
          {receiptUrl ? (
            <div className="space-y-2">
              <img src={receiptUrl} alt="Receipt" className="max-h-72 rounded-xl object-contain" />
              <Button
                small
                variant="danger"
                onClick={() => {
                  setReceipt(null);
                  setReceiptChanged(true);
                }}
              >
                Remove photo
              </Button>
            </div>
          ) : (
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-accent/15 px-3 py-2 text-[14px] font-semibold text-accent">
              <IconCamera size={18} /> Add photo
              <input type="file" accept="image/*" className="hidden" onChange={(e) => void onPhoto(e.target.files?.[0])} />
            </label>
          )}
        </div>
        <Field label="Notes">
          <TextArea value={f.notes} onChange={(v) => set({ notes: v })} rows={2} />
        </Field>
      </List>
      {existing && (
        <Button variant="danger" full onClick={() => void del()}>
          Delete purchase
        </Button>
      )}
    </Sheet>
  );
}

function emptyForm(): Form {
  return { datetime: toLocalInput(new Date().toISOString()), station: '', price: '', litres: '', total: '', odometer: '', fullTank: true, missedPrevious: false, notes: '' };
}
