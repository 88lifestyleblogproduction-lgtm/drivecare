import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { IconAlert, IconBack, IconChevron, IconClose, IconInfo } from './Icons';
import type { Basis } from '../lib/fuel';

export function cx(...xs: (string | false | null | undefined)[]) {
  return xs.filter(Boolean).join(' ');
}

/* ---------- Layout ---------- */

export function Page({
  title,
  subtitle,
  right,
  children,
  onTitleClick,
}: {
  title: string;
  subtitle?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  onTitleClick?: () => void;
}) {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-32">
      <header className="safe-top flex items-end justify-between gap-3 pt-4 pb-3">
        <div className="min-w-0">
          {onTitleClick ? (
            <button type="button" onClick={onTitleClick} className="group flex items-center gap-2 text-left" aria-label={`Rename ${title}`}>
              <h1 className="truncate text-[34px] leading-tight font-extrabold tracking-tight">{title}</h1>
              <span className="rounded-full bg-fill px-2 py-0.5 text-[12px] font-semibold text-accent">✎ Rename</span>
            </button>
          ) : (
            <h1 className="text-[34px] leading-tight font-extrabold tracking-tight">{title}</h1>
          )}
          {subtitle && <div className="mt-0.5 text-sm text-muted">{subtitle}</div>}
        </div>
        {right && <div className="flex shrink-0 items-center gap-2 pb-1">{right}</div>}
      </header>
      <div className="space-y-5">{children}</div>
    </div>
  );
}

export function Section({ title, action, children, footer }: { title?: ReactNode; action?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <section>
      {(title || action) && (
        <div className="mb-1.5 flex items-end justify-between px-1">
          {title && <h2 className="text-[13px] font-semibold tracking-wide text-muted uppercase">{title}</h2>}
          {action}
        </div>
      )}
      {children}
      {footer && <p className="mt-1.5 px-1 text-xs leading-relaxed text-muted">{footer}</p>}
    </section>
  );
}

export function Card({ children, className = '', onClick }: { children: ReactNode; className?: string; onClick?: () => void }) {
  const cls = cx('rounded-[20px] bg-card surface', onClick && 'cursor-pointer text-left w-full active:opacity-70 transition-opacity', className);
  return onClick ? (
    <button type="button" className={cls} onClick={onClick}>
      {children}
    </button>
  ) : (
    <div className={cls}>{children}</div>
  );
}

/** A grouped list (iOS inset-grouped table) */
export function List({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={cx('overflow-hidden rounded-[20px] bg-card surface divide-y divide-line', className)}>{children}</div>;
}

export function Row({
  title,
  subtitle,
  detail,
  left,
  right,
  onClick,
  chevron = !!onClick,
  className = '',
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  detail?: ReactNode;
  left?: ReactNode;
  right?: ReactNode;
  onClick?: () => void;
  chevron?: boolean;
  className?: string;
}) {
  const inner = (
    <div className={cx('flex min-h-[52px] items-center gap-3 px-4 py-2.5', className)}>
      {left && <div className="shrink-0">{left}</div>}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[16px]">{title}</div>
        {subtitle && <div className="mt-0.5 text-[13px] leading-snug text-muted">{subtitle}</div>}
      </div>
      {detail && <div className="shrink-0 text-right text-[15px] text-muted tabular">{detail}</div>}
      {right}
      {chevron && <IconChevron size={16} className="shrink-0 text-faint" />}
    </div>
  );
  return onClick ? (
    <button type="button" className="block w-full text-left active:bg-fill" onClick={onClick}>
      {inner}
    </button>
  ) : (
    inner
  );
}

/* ---------- Controls ---------- */

type BtnVariant = 'primary' | 'secondary' | 'danger' | 'plain' | 'tinted';

export function Button({
  children,
  onClick,
  variant = 'primary',
  disabled,
  type = 'button',
  className = '',
  small,
  full,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: BtnVariant;
  disabled?: boolean;
  type?: 'button' | 'submit';
  className?: string;
  small?: boolean;
  full?: boolean;
}) {
  const v: Record<BtnVariant, string> = {
    primary: 'bg-gradient-to-b from-[#2b95ff] to-[#0a74ec] text-white shadow-[0_6px_16px_-6px_rgba(10,132,255,0.7)]',
    secondary: 'bg-fill text-ink',
    tinted: 'bg-accent/15 text-accent',
    danger: 'bg-bad/12 text-bad',
    plain: 'bg-transparent text-accent',
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-xl font-semibold transition active:scale-[0.98] active:opacity-80 disabled:opacity-40 disabled:active:scale-100',
        small ? 'px-3 py-1.5 text-[14px]' : 'px-4 py-3 text-[16px]',
        full && 'w-full',
        v[variant],
        className
      )}
    >
      {children}
    </button>
  );
}

export function IconButton({ children, onClick, label, className = '' }: { children: ReactNode; onClick?: () => void; label: string; className?: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cx('inline-flex h-9 w-9 items-center justify-center rounded-full bg-fill text-accent active:opacity-60', className)}
    >
      {children}
    </button>
  );
}

export function Field({ label, hint, error, children }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode }) {
  return (
    <label className="block px-4 py-2.5">
      <span className="block text-[13px] font-medium text-muted">{label}</span>
      <div className="mt-0.5">{children}</div>
      {error && <span className="mt-1 block text-[13px] text-bad">{error}</span>}
      {!error && hint && <span className="mt-1 block text-[12px] leading-snug text-muted">{hint}</span>}
    </label>
  );
}

const inputCls = 'w-full bg-transparent py-1 text-[17px] outline-none placeholder:text-faint';

export function TextInput({
  value,
  onChange,
  placeholder,
  type = 'text',
  inputMode,
  autoComplete = 'off',
  list,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  inputMode?: 'text' | 'decimal' | 'numeric' | 'url' | 'email';
  autoComplete?: string;
  list?: string;
}) {
  return (
    <input
      className={inputCls}
      value={value}
      type={type}
      inputMode={inputMode}
      placeholder={placeholder}
      autoComplete={autoComplete}
      autoCorrect="off"
      spellCheck={false}
      list={list}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function NumberInput({ value, onChange, placeholder, suffix }: { value: string; onChange: (v: string) => void; placeholder?: string; suffix?: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <input
        className={inputCls}
        value={value}
        inputMode="decimal"
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value.replace(/[^0-9.,-]/g, ''))}
      />
      {suffix && <span className="shrink-0 text-[15px] text-muted">{suffix}</span>}
    </div>
  );
}

export function TextArea({ value, onChange, placeholder, rows = 3 }: { value: string; onChange: (v: string) => void; placeholder?: string; rows?: number }) {
  return <textarea className={cx(inputCls, 'resize-none')} rows={rows} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />;
}

export function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <select className={cx(inputCls, 'appearance-none')} value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="text-[16px]">{label}</div>
        {hint && <div className="text-[12px] leading-snug text-muted">{hint}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cx('relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors', checked ? 'bg-good' : 'bg-fill')}
      >
        <span className={cx('absolute top-[2px] left-[2px] h-[27px] w-[27px] rounded-full bg-white shadow transition-transform', checked && 'translate-x-[20px]')} />
      </button>
    </div>
  );
}

export function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div className="flex rounded-[11px] bg-fill p-[3px]">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cx(
            'flex-1 rounded-[9px] px-2 py-2 text-[13px] font-semibold transition-all duration-200',
            value === o.value ? 'bg-card text-ink shadow-[0_2px_8px_rgba(0,0,0,0.12)] dark:bg-elev' : 'text-muted'
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ---------- Display ---------- */

export function Badge({ children, tone = 'gray', color }: { children: ReactNode; tone?: 'gray' | 'blue' | 'green' | 'orange' | 'red'; color?: string }) {
  const tones = {
    gray: 'bg-fill text-muted',
    blue: 'bg-accent/15 text-accent',
    green: 'bg-good/15 text-good',
    orange: 'bg-warn/15 text-warn',
    red: 'bg-bad/15 text-bad',
  };
  if (color)
    return (
      <span className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap" style={{ background: `${color}22`, color }}>
        {children}
      </span>
    );
  return <span className={cx('inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap', tones[tone])}>{children}</span>;
}

export function BasisBadge({ basis }: { basis: Basis }) {
  if (basis === 'verified') return <Badge tone="green">Verified</Badge>;
  if (basis === 'estimate') return <Badge tone="orange">Estimate</Badge>;
  return <Badge>Unavailable</Badge>;
}

export type Tone = 'blue' | 'green' | 'orange' | 'pink' | 'purple' | 'teal';
const TONE_HEX: Record<Tone, string> = { blue: '#0a84ff', green: '#30d158', orange: '#ff9f0a', pink: '#ff375f', purple: '#bf5af2', teal: '#40c8e0' };

export function Stat({
  label,
  value,
  sub,
  badge,
  onClick,
  icon,
  tone = 'blue',
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  badge?: ReactNode;
  onClick?: () => void;
  icon?: ReactNode;
  tone?: Tone;
}) {
  const c = TONE_HEX[tone];
  return (
    <Card className="relative overflow-hidden p-4" onClick={onClick}>
      <div className="pointer-events-none absolute -top-10 -right-10 h-28 w-28 rounded-full opacity-[0.10] blur-2xl" style={{ background: c }} />
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {icon && (
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] text-white" style={{ background: c }}>
              {icon}
            </span>
          )}
          <div className="text-[13px] leading-tight font-semibold text-muted">{label}</div>
        </div>
        {badge}
      </div>
      <div className="mt-2.5 text-[24px] leading-none font-bold tracking-tight tabular">{value}</div>
      {sub && <div className="mt-1.5 text-[12px] leading-snug text-muted">{sub}</div>}
    </Card>
  );
}

/** Large gradient summary card */
export function Hero({ children, from = '#0a84ff', to = '#5e5ce6', className = '' }: { children: ReactNode; from?: string; to?: string; className?: string }) {
  return (
    <div className={cx('relative overflow-hidden rounded-[24px] p-5 text-white shadow-[0_10px_30px_-12px_rgba(10,132,255,0.55)]', className)} style={{ background: `linear-gradient(135deg, ${from}, ${to})` }}>
      <div className="pointer-events-none absolute -top-16 -right-12 h-48 w-48 rounded-full bg-white/15 blur-2xl" />
      <div className="pointer-events-none absolute -bottom-20 -left-10 h-40 w-40 rounded-full bg-black/10 blur-2xl" />
      <div className="relative">{children}</div>
    </div>
  );
}

export function Empty({ title, text, action }: { title: string; text?: ReactNode; action?: ReactNode }) {
  return (
    <Card className="px-6 py-8 text-center">
      <div className="text-[17px] font-semibold">{title}</div>
      {text && <div className="mx-auto mt-1 max-w-sm text-[14px] leading-relaxed text-muted">{text}</div>}
      {action && <div className="mt-4">{action}</div>}
    </Card>
  );
}

export function Banner({ tone = 'info', children, title }: { tone?: 'info' | 'warn' | 'error' | 'ok'; children: ReactNode; title?: ReactNode }) {
  const t = {
    info: 'bg-accent/10 text-ink',
    warn: 'bg-warn/12 text-ink',
    error: 'bg-bad/12 text-ink',
    ok: 'bg-good/12 text-ink',
  }[tone];
  const ic = { info: 'text-accent', warn: 'text-warn', error: 'text-bad', ok: 'text-good' }[tone];
  return (
    <div className={cx('flex gap-3 rounded-2xl px-4 py-3 text-[14px] leading-relaxed', t)}>
      <div className={cx('pt-0.5', ic)}>{tone === 'info' || tone === 'ok' ? <IconInfo size={18} /> : <IconAlert size={18} />}</div>
      <div className="min-w-0 flex-1">
        {title && <div className="font-semibold">{title}</div>}
        {children}
      </div>
    </div>
  );
}

export function Spinner({ size = 18 }: { size?: number }) {
  return (
    <span
      className="inline-block animate-spin rounded-full border-2 border-current border-t-transparent align-[-3px]"
      style={{ width: size, height: size }}
      aria-label="Loading"
    />
  );
}

export function Loading({ text = 'Loading…' }: { text?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-muted">
      <Spinner /> {text}
    </div>
  );
}

/* ---------- Sheet (full-screen modal) ---------- */

export function Sheet({
  open,
  onClose,
  title,
  children,
  right,
  closeLabel = 'Cancel',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  right?: ReactNode;
  closeLabel?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-bg sheet-enter" role="dialog" aria-modal="true" aria-label={title}>
      <div className="safe-top border-b border-line bg-bar backdrop-blur-xl">
        <div className="mx-auto flex h-12 max-w-2xl items-center justify-between gap-2 px-2">
          <button type="button" onClick={onClose} className="flex min-w-[72px] items-center px-2 text-[17px] text-accent">
            {closeLabel === 'Back' ? <IconBack size={20} /> : null}
            {closeLabel}
          </button>
          <div className="truncate text-[17px] font-semibold">{title}</div>
          <div className="flex min-w-[72px] justify-end px-2">{right}</div>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto max-w-2xl space-y-5 px-4 pt-4 pb-16 safe-bottom">{children}</div>
      </div>
    </div>
  );
}

export function SheetClose({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label="Close" className="text-muted">
      <IconClose />
    </button>
  );
}

/* ---------- Toasts ---------- */

interface ToastItem {
  id: number;
  text: string;
  tone: 'ok' | 'error' | 'info';
}
const ToastCtx = createContext<(text: string, tone?: ToastItem['tone']) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((text: string, tone: ToastItem['tone'] = 'ok') => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs, { id, text, tone }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), tone === 'error' ? 6000 : 2800);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex flex-col items-center gap-2 px-4 pt-[calc(env(safe-area-inset-top)+10px)]">
        {items.map((t) => (
          <div
            key={t.id}
            className={cx(
              'sheet-enter max-w-md rounded-2xl px-4 py-2.5 text-[14px] font-medium shadow-lg backdrop-blur-xl',
              t.tone === 'error' ? 'bg-bad text-white' : 'bg-elev/95 text-ink'
            )}
          >
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  return useContext(ToastCtx);
}
