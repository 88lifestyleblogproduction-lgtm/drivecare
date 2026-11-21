import { useEffect, useRef, useState } from 'react';

export interface Datum {
  label: string;
  value: number | null;
}

const H = 170;
const PAD = { l: 44, r: 10, t: 12, b: 24 };

/** Measures the container so the chart is drawn at real pixel size (no stretching on wide screens). */
function useWidth() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [w, setW] = useState(340);
  useEffect(() => {
    if (!ref.current) return;
    const el = ref.current;
    const update = () => setW(Math.max(220, Math.round(el.clientWidth)));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, w };
}

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

function Header({ label, value }: { label?: string; value: string }) {
  return (
    <div className="mb-2 flex items-baseline justify-between px-1">
      <span className="text-[13px] text-muted">{label}</span>
      <span className="text-[20px] font-bold tracking-tight tabular">{value}</span>
    </div>
  );
}

function EmptyChart({ text = 'No data yet' }: { text?: string }) {
  return (
    <div className="flex h-[150px] flex-col items-center justify-center gap-1 rounded-2xl bg-fill/60 text-center">
      <div className="text-[15px] font-semibold text-muted">{text}</div>
      <div className="text-[12px] text-faint">The chart appears once you have records</div>
    </div>
  );
}

/** Bar chart; tap a bar to read its value. */
export function BarChart({ data, fmt, color = '#0a84ff' }: { data: Datum[]; fmt: (n: number) => string; color?: string }) {
  const { ref, w } = useWidth();
  const [sel, setSel] = useState<number | null>(null);
  const hasData = data.some((d) => (d.value ?? 0) > 0);
  const max = niceMax(Math.max(0, ...data.map((d) => d.value ?? 0)));
  const iw = w - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const bw = iw / Math.max(1, data.length);
  const shown = sel ?? data.length - 1;
  const gid = `bar-${color.replace(/[^a-z0-9]/gi, '')}`;
  return (
    <div ref={ref}>
      <Header label={data[shown]?.label} value={data[shown]?.value != null ? fmt(data[shown].value!) : '—'} />
      {!hasData ? (
        <EmptyChart />
      ) : (
        <svg width={w} height={H} viewBox={`0 0 ${w} ${H}`} className="block" role="img" aria-label="Bar chart">
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={1} />
              <stop offset="100%" stopColor={color} stopOpacity={0.55} />
            </linearGradient>
          </defs>
          {[0, 0.5, 1].map((f) => {
            const y = PAD.t + ih - f * ih;
            return (
              <g key={f}>
                <line x1={PAD.l} x2={PAD.l + iw} y1={y} y2={y} stroke="var(--app-line)" strokeDasharray={f === 0 ? undefined : '3 4'} />
                <text x={PAD.l - 8} y={y + 4} textAnchor="end" fontSize={11} fill="var(--app-muted)">
                  {fmt(max * f)}
                </text>
              </g>
            );
          })}
          {data.map((d, i) => {
            const v = d.value ?? 0;
            const h = Math.max(v > 0 ? 3 : 0, (v / max) * ih);
            const barW = Math.min(34, bw * 0.62);
            const x = PAD.l + i * bw + (bw - barW) / 2;
            const step = Math.ceil(data.length / 8);
            return (
              <g key={d.label + i} onClick={() => setSel(i)} style={{ cursor: 'pointer' }}>
                <rect x={PAD.l + i * bw} y={PAD.t} width={bw} height={ih} fill="transparent" />
                <rect x={x} y={PAD.t + ih - h} width={barW} height={h} rx={Math.min(7, barW / 2)} fill={`url(#${gid})`} opacity={shown === i ? 1 : 0.4} />
                {(data.length <= 8 || i % step === 0 || i === data.length - 1) && (
                  <text x={PAD.l + i * bw + bw / 2} y={H - 6} textAnchor="middle" fontSize={11} fill={shown === i ? 'var(--app-ink)' : 'var(--app-muted)'} fontWeight={shown === i ? 600 : 400}>
                    {d.label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

export function LineChart({ data, fmt, color = '#0a84ff', minZero = false }: { data: Datum[]; fmt: (n: number) => string; color?: string; minZero?: boolean }) {
  const { ref, w } = useWidth();
  const [sel, setSel] = useState<number | null>(null);
  const vals = data.map((d) => d.value).filter((v): v is number => v != null);
  const shown = sel ?? data.length - 1;
  if (vals.length === 0)
    return (
      <div ref={ref}>
        <Header value="—" />
        <EmptyChart />
      </div>
    );
  const hi = Math.max(...vals);
  const lo = minZero ? 0 : Math.min(...vals);
  const span = hi - lo || Math.abs(hi) * 0.1 || 1;
  const max = hi + span * 0.2;
  const min = minZero ? 0 : Math.max(0, lo - span * 0.2);
  const iw = w - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const x = (i: number) => PAD.l + (data.length === 1 ? iw / 2 : (i / (data.length - 1)) * iw);
  const y = (v: number) => PAD.t + ih - ((v - min) / (max - min)) * ih;
  const pts = data.map((d, i) => (d.value == null ? null : ([x(i), y(d.value)] as const)));
  const valid = pts.filter((p): p is readonly [number, number] => !!p);
  const path = valid.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
  const area = valid.length > 1 ? `${path}L${valid[valid.length - 1][0].toFixed(1)},${PAD.t + ih}L${valid[0][0].toFixed(1)},${PAD.t + ih}Z` : '';
  const gid = `area-${color.replace(/[^a-z0-9]/gi, '')}`;
  const step = Math.ceil(data.length / 6);
  return (
    <div ref={ref}>
      <Header label={data[shown]?.label} value={data[shown]?.value != null ? fmt(data[shown].value!) : '—'} />
      <svg width={w} height={H} viewBox={`0 0 ${w} ${H}`} className="block" role="img" aria-label="Line chart">
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.28} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        {[0, 0.5, 1].map((f) => {
          const t = min + (max - min) * f;
          return (
            <g key={f}>
              <line x1={PAD.l} x2={PAD.l + iw} y1={y(t)} y2={y(t)} stroke="var(--app-line)" strokeDasharray={f === 0 ? undefined : '3 4'} />
              <text x={PAD.l - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill="var(--app-muted)">
                {fmt(t)}
              </text>
            </g>
          );
        })}
        {area && <path d={area} fill={`url(#${gid})`} />}
        <path d={path} fill="none" stroke={color} strokeWidth={2.75} strokeLinejoin="round" strokeLinecap="round" />
        {pts.map((p, i) =>
          p ? (
            <g key={i} onClick={() => setSel(i)} style={{ cursor: 'pointer' }}>
              <circle cx={p[0]} cy={p[1]} r={14} fill="transparent" />
              {shown === i && <line x1={p[0]} x2={p[0]} y1={PAD.t} y2={PAD.t + ih} stroke={color} strokeOpacity={0.25} />}
              <circle cx={p[0]} cy={p[1]} r={shown === i ? 5.5 : 3} fill={shown === i ? color : 'var(--app-card)'} stroke={color} strokeWidth={2} />
            </g>
          ) : null
        )}
        {data.map((d, i) =>
          data.length <= 6 || i % step === 0 || i === data.length - 1 ? (
            <text key={`l${i}`} x={x(i)} y={H - 6} textAnchor="middle" fontSize={11} fill="var(--app-muted)">
              {d.label}
            </text>
          ) : null
        )}
      </svg>
    </div>
  );
}
