/** All dates are interpreted and displayed in Vancouver time. */
export const TZ = 'America/Vancouver';

const partsFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

function parts(d: Date): Record<string, string> {
  const p: Record<string, string> = {};
  for (const x of partsFmt.formatToParts(d)) p[x.type] = x.value;
  if (p.hour === '24') p.hour = '00';
  return p;
}

/** YYYY-MM-DD in Vancouver */
export function dateKey(input: string | number | Date): string {
  const p = parts(new Date(input));
  return `${p.year}-${p.month}-${p.day}`;
}

export const monthKey = (input: string | number | Date) => dateKey(input).slice(0, 7);
export const todayKey = () => dateKey(Date.now());
export const thisMonthKey = () => todayKey().slice(0, 7);

function offsetMs(utcMs: number): number {
  const p = parts(new Date(utcMs));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** Converts a Vancouver wall-clock date/time to an ISO (UTC) string. */
export function zonedToIso(key: string, hhmm = '00:00'): string {
  const [y, m, d] = key.split('-').map(Number);
  const [h, mi] = hhmm.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, h || 0, mi || 0);
  const off1 = offsetMs(guess);
  let ms = guess - off1;
  const off2 = offsetMs(ms);
  if (off2 !== off1) ms = guess - off2;
  return new Date(ms).toISOString();
}

/** Value for <input type="datetime-local"> in Vancouver time */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const p = parts(new Date(iso));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

export function fromLocalInput(v: string): string | null {
  if (!v) return null;
  const [d, t] = v.split('T');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  return zonedToIso(d, (t || '00:00').slice(0, 5));
}

export function timeOfDay(iso: string): string {
  const p = parts(new Date(iso));
  return `${p.hour}:${p.minute}`;
}

export function dayNumber(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 864e5);
}

export function addDays(key: string, n: number): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function addMonths(mKey: string, n: number): string {
  const [y, m] = mKey.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}

export function monthStartKey(mKey: string): string {
  return `${mKey}-01`;
}

export function monthEndKey(mKey: string): string {
  const [y, m] = mKey.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/** Elapsed days between two instants */
export function daysBetween(a: string, b: string): number {
  return (new Date(b).getTime() - new Date(a).getTime()) / 864e5;
}

const fDate = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
const fDateShort = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric' });
const fTime = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: true });
const fWeekday = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'long' });
const fLong = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
const fMonth = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', year: 'numeric' });
const fMonthShort = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short' });

export const fmtDate = (iso: string) => fDate.format(new Date(iso));
export const fmtDateShort = (iso: string) => fDateShort.format(new Date(iso));
export const fmtTime = (iso: string) => fTime.format(new Date(iso));
export const fmtDateTime = (iso: string) => `${fmtDate(iso)}, ${fmtTime(iso)}`;
export const keyToIsoNoon = (key: string) => zonedToIso(key, '12:00');
export const fmtKey = (key: string) => fDate.format(new Date(keyToIsoNoon(key)));
export const fmtKeyLong = (key: string) => fLong.format(new Date(keyToIsoNoon(key)));
export const fmtWeekday = (key: string) => fWeekday.format(new Date(keyToIsoNoon(key)));
export function fmtMonth(mKey: string): string {
  const [y, m] = mKey.split('-').map(Number);
  return fMonth.format(new Date(Date.UTC(y, m - 1, 15)));
}
export function fmtMonthShort(mKey: string): string {
  const [y, m] = mKey.split('-').map(Number);
  return fMonthShort.format(new Date(Date.UTC(y, m - 1, 15)));
}

export function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}
