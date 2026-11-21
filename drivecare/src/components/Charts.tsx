import { useState } from 'react';

export interface Datum {
  label: string;
  value: number | null;
}

const W = 340;
const H = 170;
const PAD = { l: 40, r: 8, t: 14, b: 26 };

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

function ticks(max: number) {
  return [0, max / 2, max];
}

function Axis({ max, fmt }: { max: number; fmt: (n: number) => string }) {
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  return (
    <g>
      {ticks(max).map((t) => {
        const y = PAD.t + ih - (t / max) * ih;
        return (
          <g key={t}>
            <line x1={PAD.l} x2={PAD.l + iw} y1={y} y2={y} stroke="var(--app-line)" strokeWidth={1} />
            <text x={PAD.l - 6} y={y + 3.5} textAnchor="end" fontSize={10} fill="var(--app-muted)">
              {fmt(t)}
            </text>
          </g>
        );
      })}
    </g>
  );
}

/** Simple, dependency-free bar chart; tap a bar to read its value. */
export function BarChart({ data, fmt, color = 'var(--app-accent)' }: { data: Datum[]; fmt: (n: number) => string; color?: string }) {
  const [sel, setSel] = useState<number | null>(null);
  const max = niceMax(Math.max(0, ...data.map((d) => d.value ?? 0)));
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const bw = iw / Math.max(1, data.length);
  const shown = sel ?? data.length - 1;
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between px-1 text-[13px]">
        <span className="text-muted">{data[shown]?.label}</span>
        <span className="font-semibold tabular">{data[shown]?.value != null ? fmt(data[shown].value!) : '—'}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Bar chart">
        <Axis max={max} fmt={fmt} />
        {data.map((d, i) => {
          const v = d.value ?? 0;
          const h = (v / max) * ih;
          const x = PAD.l + i * bw + bw * 0.18;
          return (
            <g key={d.label + i} onClick={() => setSel(i)} style={{ cursor: 'pointer' }}>
              <rect x={PAD.l + i * bw} y={PAD.t} width={bw} height={ih} fill="transparent" />
              <rect x={x} y={PAD.t + ih - h} width={bw * 0.64} height={Math.max(0, h)} rx={3} fill={color} opacity={shown === i ? 1 : 0.55} />
              {(data.length <= 8 || i % Math.ceil(data.length / 8) === 0) && (
                <text x={PAD.l + i * bw + bw / 2} y={H - 8} textAnchor="middle" fontSize={10} fill="var(--app-muted)">
                  {d.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function LineChart({ data, fmt, color = 'var(--app-accent)', minZero = false }: { data: Datum[]; fmt: (n: number) => string; color?: string; minZero?: boolean }) {
  const [sel, setSel] = useState<number | null>(null);
  const vals = data.map((d) => d.value).filter((v): v is number => v != null);
  if (vals.length === 0) return <div className="py-8 text-center text-sm text-muted">Not enough data yet</div>;
  const hi = Math.max(...vals);
  const lo = minZero ? 0 : Math.min(...vals);
  const span = hi - lo || Math.abs(hi) * 0.1 || 1;
  const max = hi + span * 0.15;
  const min = minZero ? 0 : Math.max(0, lo - span * 0.15);
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const x = (i: number) => PAD.l + (data.length === 1 ? iw / 2 : (i / (data.length - 1)) * iw);
  const y = (v: number) => PAD.t + ih - ((v - min) / (max - min)) * ih;
  const pts = data.map((d, i) => (d.value == null ? null : ([x(i), y(d.value)] as const)));
  const path = pts.reduce((acc, p, i) => (p ? `${acc}${acc && pts[i - 1] ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}` : acc), '');
  const shown = sel ?? data.length - 1;
  const tickVals = [min, (min + max) / 2, max];
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between px-1 text-[13px]">
        <span className="text-muted">{data[shown]?.label}</span>
        <span className="font-semibold tabular">{data[shown]?.value != null ? fmt(data[shown].value!) : '—'}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Line chart">
        {tickVals.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={PAD.l + iw} y1={y(t)} y2={y(t)} stroke="var(--app-line)" />
            <text x={PAD.l - 6} y={y(t) + 3.5} textAnchor="end" fontSize={10} fill="var(--app-muted)">
              {fmt(t)}
            </text>
          </g>
        ))}
        <path d={path} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
        {pts.map((p, i) =>
          p ? (
            <g key={i} onClick={() => setSel(i)} style={{ cursor: 'pointer' }}>
              <circle cx={p[0]} cy={p[1]} r={12} fill="transparent" />
              <circle cx={p[0]} cy={p[1]} r={shown === i ? 5 : 3} fill={color} stroke="var(--app-card)" strokeWidth={1.5} />
            </g>
          ) : null
        )}
        {data.map((d, i) =>
          data.length <= 6 || i % Math.ceil(data.length / 6) === 0 || i === data.length - 1 ? (
            <text key={`l${i}`} x={x(i)} y={H - 8} textAnchor="middle" fontSize={10} fill="var(--app-muted)">
              {d.label}
            </text>
          ) : null
        )}
      </svg>
    </div>
  );
}
