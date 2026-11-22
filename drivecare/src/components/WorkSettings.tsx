import { useMemo, useState } from 'react';
import { Badge, Button, Card, Field, List, Sheet } from './ui';
import { IconCar } from './Icons';
import LocationEditor, { LocationSelect, type LocationDraft } from './LocationEditor';
import { useData } from '../lib/data';
import { saveSettings } from '../lib/settings';
import { workLocationOf } from '../lib/planner';
import { locationTitle } from '../lib/address';
import { fmtTime, zonedToIso, todayKey } from '../lib/time';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function fmtHHmm(hhmm: string): string {
  return fmtTime(zonedToIso(todayKey(), hhmm));
}

export function daysSummary(days: number[]): string {
  if (!days.length) return 'No workdays set';
  const s = [...days].sort();
  if (s.join() === '1,2,3,4,5') return 'Mon–Fri';
  if (s.join() === '0,1,2,3,4,5,6') return 'Every day';
  return s.map((d) => DAYS[d]).join(', ');
}

function hoursSummary(s: ReturnType<typeof useData>['settings']): string {
  const hs = s.workDays.map((d) => s.workHours[String(d)] ?? { start: s.workStartTime, end: s.workEndTime });
  const same = hs.every((h) => h.start === hs[0]?.start && h.end === hs[0]?.end);
  return same && hs[0] ? `${fmtHHmm(hs[0].start)}–${fmtHHmm(hs[0].end)}` : 'hours vary by day';
}

/** Compact summary of your work schedule with an Edit button. */
export function WorkCard() {
  const { settings, locations } = useData();
  const [open, setOpen] = useState(false);
  const work = workLocationOf(settings, locations);
  const configured = settings.workDays.length > 0 && !!work;
  return (
    <>
      <Card className="flex items-center gap-3 px-4 py-3" onClick={() => setOpen(true)}>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] bg-[#ff9f0a] text-white">
          <IconCar size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[15px] font-semibold">
            Work {configured ? <Badge tone="green">On</Badge> : <Badge tone="orange">Set up</Badge>}
          </div>
          <div className="truncate text-[13px] text-muted">
            {configured
              ? `${daysSummary(settings.workDays)} · ${hoursSummary(settings)} · ${locationTitle(work!)}`
              : 'Add your workdays, hours and work address'}
          </div>
        </div>
        <span className="text-[15px] font-semibold text-accent">Edit</span>
      </Card>
      <WorkSheet open={open} onClose={() => setOpen(false)} />
    </>
  );
}

export function WorkSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { settings, locations } = useData();
  const [editing, setEditing] = useState<LocationDraft | null>(null);
  const work = workLocationOf(settings, locations);
  const workPlaces = locations.filter((l) => l.kind === 'work');
  const toggle = (d: number) =>
    void saveSettings({
      workDays: settings.workDays.includes(d) ? settings.workDays.filter((x) => x !== d) : [...settings.workDays, d].sort(),
      ...(settings.workDays.length === 0 ? { workSince: todayKey() } : {}),
    });
  const hoursFor = (d: number) => settings.workHours[String(d)] ?? { start: settings.workStartTime, end: settings.workEndTime };
  const setDay = (d: number, k: 'start' | 'end', v: string) => void saveSettings({ workHours: { ...settings.workHours, [String(d)]: { ...hoursFor(d), [k]: v } } });
  const applyAll = () => {
    const h = hoursFor([...settings.workDays].sort()[0]);
    void saveSettings({ workStartTime: h.start, workEndTime: h.end, workHours: {} });
  };
  const newDraft = useMemo<LocationDraft>(() => ({ kind: 'work', name: 'Work' }), []);
  const timeCls = 'w-full bg-transparent py-1 text-[17px] outline-none';

  return (
    <Sheet open={open} onClose={onClose} title="Work" closeLabel="Done">
      <p className="px-1 text-[14px] leading-relaxed text-muted">
        On workdays your route becomes Home → Work (arrive at your start time) → … → Work (leave at your end time) → Home. Appointments during work hours are routed from and back to
        Work. A day also counts as a workday when a recorded or logged trip arrives at work before your start time. You can switch any day on or off in the route planner.
      </p>

      <List>
        <div className="px-4 py-3">
          <div className="mb-2 text-[13px] font-medium text-muted">Days I work</div>
          <div className="flex gap-1.5">
            {DAYS.map((label, d) => {
              const on = settings.workDays.includes(d);
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => toggle(d)}
                  aria-pressed={on}
                  className={`h-10 flex-1 rounded-xl text-[13px] font-semibold transition ${on ? 'bg-accent text-white' : 'bg-fill text-muted'}`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      </List>

      <List>
        <div className="px-4 pt-3 text-[13px] font-medium text-muted">Hours (leave home for work / leave work for home)</div>
        {settings.workDays.length === 0 ? (
          <div className="grid grid-cols-2 divide-x divide-line">
            <Field label="Start work">
              <input type="time" className={timeCls} value={settings.workStartTime} onChange={(e) => e.target.value && void saveSettings({ workStartTime: e.target.value })} />
            </Field>
            <Field label="Finish work">
              <input type="time" className={timeCls} value={settings.workEndTime} onChange={(e) => e.target.value && void saveSettings({ workEndTime: e.target.value })} />
            </Field>
          </div>
        ) : (
          [...settings.workDays].sort().map((d) => {
            const h = hoursFor(d);
            return (
              <div key={d} className="flex items-center gap-2 px-4 py-2">
                <span className="w-11 text-[15px] font-semibold">{DAYS[d]}</span>
                <input type="time" aria-label={`${DAYS[d]} start`} className="min-w-0 flex-1 rounded-lg bg-fill px-2 py-1.5 text-[16px] outline-none" value={h.start} onChange={(e) => e.target.value && setDay(d, 'start', e.target.value)} />
                <span className="text-muted">–</span>
                <input type="time" aria-label={`${DAYS[d]} end`} className="min-w-0 flex-1 rounded-lg bg-fill px-2 py-1.5 text-[16px] outline-none" value={h.end} onChange={(e) => e.target.value && setDay(d, 'end', e.target.value)} />
              </div>
            );
          })
        )}
        {settings.workDays.length > 1 && (
          <div className="px-4 py-3">
            <Button small variant="secondary" onClick={applyAll}>
              Use {DAYS[[...settings.workDays].sort()[0]]}’s hours for every day
            </Button>
          </div>
        )}
      </List>

      <List>
        <Field label="Work address" hint={work ? undefined : 'Add your work address so the first trip of the day can be calculated.'}>
          {workPlaces.length ? (
            <LocationSelect value={work?.id ?? null} onChange={(id) => void saveSettings({ workLocationId: id })} locations={workPlaces} allowNone={false} />
          ) : (
            <div className="py-1 text-[15px] text-warn">Not set</div>
          )}
        </Field>
        <div className="flex flex-wrap gap-2 px-4 py-3">
          <Button small onClick={() => setEditing(newDraft)}>
            Add work address
          </Button>
          {work && (
            <Button small variant="secondary" onClick={() => setEditing({ id: work.id })}>
              Edit {locationTitle(work)}
            </Button>
          )}
        </div>
      </List>

      <LocationEditor
        open={!!editing}
        draft={editing}
        onClose={() => setEditing(null)}
        onSaved={(l) => {
          if (l.kind === 'work') void saveSettings({ workLocationId: l.id });
        }}
      />
    </Sheet>
  );
}
