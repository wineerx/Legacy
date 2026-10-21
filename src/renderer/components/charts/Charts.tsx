import { useId, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowRight, ArrowUp } from 'lucide-react'
import { cx } from '../ui/cx'

/** Charts are plain SVG/CSS (no chart dependency), monochrome like the references, and every chart has a text summary for screen readers. */
const fmt = (v: number | null | undefined) => v === null || v === undefined ? '—' : v.toLocaleString('pt-BR')
export const compact = (v: number | null | undefined) => v === null || v === undefined ? '—' : new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }).format(v)
export const CHART = ['var(--color-chart-1)', 'var(--color-chart-2)', 'var(--color-chart-3)', 'var(--color-chart-4)', 'var(--color-chart-5)']

/** Percent change; null when there is no base to compare with, so it shows "—" instead of an invented +100%. */
export function delta(current: number, previous: number): number | null {
  if (!previous) return null
  return (current - previous) / previous * 100
}

/** "+10,3%" pill. `inverse` for metrics where growth is bad (failures). */
export function DeltaBadge({ value, inverse = false, className }: { value: number | null; inverse?: boolean; className?: string }) {
  if (value === null) return <span className={cx('ds-status', className)} data-tone="neutral" title="Sem período anterior para comparar">—</span>
  const good = inverse ? value <= 0 : value >= 0
  const Icon = value > 0 ? ArrowUp : value < 0 ? ArrowDown : ArrowRight
  return <span className={cx('ds-status', className)} data-tone={value === 0 ? 'neutral' : good ? 'green' : 'red'}><Icon size={10} aria-hidden />{`${value > 0 ? '+' : ''}${value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`}</span>
}

export function StatCard({ title, value, icon, badge, note, footer, onClick, children, label }: { title: string; value: ReactNode; icon?: ReactNode; badge?: ReactNode; note?: ReactNode; footer?: ReactNode; onClick?(): void; children?: ReactNode; label?: string }) {
  const body = <>
    <div className="ds-card-header"><h3 className="ds-card-title">{title}</h3>{badge ?? (icon && <span aria-hidden className="ds-card-icon">{icon}</span>)}</div>
    <div className="ds-stat-body">
      <p className="ds-stat-value">{value}</p>
      {note && <p className="mt-1 text-xs text-dim">{note}</p>}
      {children}
    </div>
    {footer && <div className="ds-stat-footer">{footer}<ArrowRight size={13} aria-hidden /></div>}
  </>
  return onClick ? <button type="button" aria-label={label} onClick={onClick} className="ds-card ds-stat ds-stat-button">{body}</button> : <section aria-label={label ?? title} className="ds-card ds-stat">{body}</section>
}

export type Series = { key: string; label: string; color?: string }

/** Grouped vertical bars. Values are counts; a missing value is drawn as nothing and read as "—". */
export function BarChart({ data, series, height = 220, label }: { data: { label: string; values: Record<string, number | null> }[]; series: Series[]; height?: number; label: string }) {
  const max = Math.max(1, ...data.flatMap(d => series.map(s => d.values[s.key] ?? 0)))
  const [hover, setHover] = useState<number | null>(null)
  const summary = data.map(d => `${d.label}: ${series.map(s => `${s.label} ${fmt(d.values[s.key])}`).join(', ')}`).join('; ')
  return <figure className="ds-chart" aria-label={label}>
    <div role="img" aria-label={`${label}. ${summary}`} className="ds-bars" style={{ height }} onMouseLeave={() => setHover(null)}>
      {[0.25, 0.5, 0.75].map(r => <span key={r} aria-hidden className="ds-chart-gridline" style={{ bottom: `${r * 100}%` }} />)}
      {data.map((d, i) => <div key={d.label + i} className="ds-bar-group" data-hover={hover === i || undefined} onMouseEnter={() => setHover(i)}>
        {series.map((s, n) => { const v = d.values[s.key]
          return <span key={s.key} className="ds-bar" style={{ height: `${v ? Math.max(2, v / max * 100) : 0}%`, background: s.color ?? CHART[n] }} /> })}
        {hover === i && <div role="presentation" className="ds-chart-tip"><strong>{d.label}</strong>{series.map((s, n) => <span key={s.key}><i style={{ background: s.color ?? CHART[n] }} />{s.label}<b>{fmt(d.values[s.key])}</b></span>)}</div>}
      </div>)}
    </div>
    <div aria-hidden className="ds-chart-axis">{data.map((d, i) => <span key={d.label + i}>{d.label}</span>)}</div>
  </figure>
}

/** Smooth-free polyline chart with optional area fill; hovering a column shows every series value for that point. */
export function LineChart({ labels, series, height = 220, label, area = true }: { labels: string[]; series: (Series & { values: (number | null)[] })[]; height?: number; label: string; area?: boolean }) {
  const id = useId()
  const [hover, setHover] = useState<number | null>(null)
  const max = Math.max(1, ...series.flatMap(s => s.values.map(v => v ?? 0)))
  const W = 100, H = 100, step = labels.length > 1 ? W / (labels.length - 1) : W
  const point = (v: number, i: number) => `${(i * step).toFixed(2)},${(H - v / max * H * 0.92).toFixed(2)}`
  const path = (values: (number | null)[]) => values.map((v, i) => v === null ? null : point(v, i)).filter(Boolean).join(' ')
  const summary = series.map(s => `${s.label}: ${s.values.map(fmt).join(', ')}`).join('; ')
  return <figure className="ds-chart" aria-label={label}>
    <div role="img" aria-label={`${label}. ${summary}`} className="relative" style={{ height }} onMouseLeave={() => setHover(null)}>
      {[0.25, 0.5, 0.75].map(r => <span key={r} aria-hidden className="ds-chart-gridline" style={{ bottom: `${r * 100}%` }} />)}
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible" aria-hidden>
        <defs>{series.map((s, n) => <linearGradient key={s.key} id={`${id}-${n}`} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={s.color ?? CHART[n]} stopOpacity=".22" /><stop offset="1" stopColor={s.color ?? CHART[n]} stopOpacity="0" /></linearGradient>)}</defs>
        {[...series].reverse().map((s, r) => { const n = series.length - 1 - r, pts = path(s.values)
          return <g key={s.key}>
            {area && n === 0 && pts && <polygon points={`0,${H} ${pts} ${W},${H}`} fill={`url(#${id}-${n})`} />}
            {pts && <polyline points={pts} fill="none" stroke={s.color ?? CHART[n]} strokeWidth={n === 0 ? 2 : 1.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />}
          </g> })}
        {hover !== null && <line x1={hover * step} x2={hover * step} y1={0} y2={H} stroke="var(--color-line-strong)" strokeWidth={1} vectorEffect="non-scaling-stroke" strokeDasharray="3 3" />}
      </svg>
      <div className="absolute inset-0 flex">{labels.map((l, i) => <div key={l + i} className="relative flex-1" onMouseEnter={() => setHover(i)}>
        {hover === i && <div role="presentation" className={cx('ds-chart-tip', i > labels.length / 2 && 'ds-chart-tip-left')}><strong>{l}</strong>{series.map((s, n) => <span key={s.key}><i style={{ background: s.color ?? CHART[n] }} />{s.label}<b>{fmt(s.values[i])}</b></span>)}</div>}
      </div>)}</div>
    </div>
    <div aria-hidden className="ds-chart-axis">{labels.map((l, i) => <span key={l + i}>{i % Math.ceil(labels.length / 7) === 0 ? l : ''}</span>)}</div>
  </figure>
}

export function ChartLegend({ series, values }: { series: Series[]; values?: Record<string, ReactNode> }) {
  return <ul className="flex flex-wrap items-center gap-x-5 gap-y-1">
    {series.map((s, n) => <li key={s.key} className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-dim"><i aria-hidden className="size-2 rounded-full" style={{ background: s.color ?? CHART[n] }} />{s.label}{values && <strong className="text-sm font-semibold normal-case tracking-normal text-fg tabular-nums">{values[s.key]}</strong>}</li>)}
  </ul>
}

/** Ring with the total in the middle and a legend grid below (Leads by source reference). */
export function DonutChart({ segments, centerValue, centerLabel, label, size = 160 }: { segments: { key: string; label: string; value: number; color?: string }[]; centerValue: ReactNode; centerLabel: string; label: string; size?: number }) {
  const total = segments.reduce((s, x) => s + x.value, 0)
  const r = 40, c = 2 * Math.PI * r
  let offset = 0
  return <figure className="grid justify-items-center gap-5" aria-label={label}>
    <div className="relative" style={{ width: size, height: size }} role="img" aria-label={`${label}. ${segments.map(s => `${s.label}: ${fmt(s.value)}`).join(', ')}`}>
      <svg viewBox="0 0 100 100" className="size-full -rotate-90" aria-hidden>
        <circle cx="50" cy="50" r={r} fill="none" stroke="var(--color-raised)" strokeWidth="14" />
        {total > 0 && segments.map((s, n) => { const len = s.value / total * c, el = <circle key={s.key} cx="50" cy="50" r={r} fill="none" stroke={s.color ?? CHART[n]} strokeWidth="14" strokeDasharray={`${Math.max(0, len - 0.8)} ${c}`} strokeDashoffset={-offset} />; offset += len; return el })}
      </svg>
      <div className="absolute inset-0 grid place-content-center text-center"><span className="text-2xl font-semibold tabular-nums">{centerValue}</span><span className="text-[11px] text-dim">{centerLabel}</span></div>
    </div>
    <ul className="grid w-full grid-cols-2 gap-3 sm:grid-cols-4">
      {segments.map((s, n) => <li key={s.key} className="grid justify-items-center gap-1 text-center"><span className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-dim"><i aria-hidden className="size-1.5 rounded-full" style={{ background: s.color ?? CHART[n] }} />{s.label}</span><strong className="text-base font-semibold tabular-nums">{fmt(s.value)}</strong></li>)}
    </ul>
  </figure>
}

/** Segmented horizontal bar plus one row per segment with a small meter (Sales pipeline reference). */
export function PipelineList({ rows, label }: { rows: { key: string; label: string; detail?: string; value: number; color?: string }[]; label: string }) {
  const total = rows.reduce((s, r) => s + r.value, 0)
  const pct = (v: number) => total ? Math.round(v / total * 100) : 0
  return <div className="grid gap-4" aria-label={label} role="group">
    <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-raised" aria-hidden>
      {total > 0 && rows.map((r, n) => r.value > 0 && <span key={r.key} style={{ width: `${r.value / total * 100}%`, background: r.color ?? CHART[n] }} />)}
    </div>
    <ul className="grid gap-3">{rows.map((r, n) => <li key={r.key} className="flex items-center gap-3">
      <i aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: r.color ?? CHART[n] }} />
      <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{r.label}</p>{r.detail && <p className="truncate text-[11px] text-dim">{r.detail}</p>}</div>
      <Meter value={pct(r.value)} label={`${r.label}: ${pct(r.value)}%`} />
      <span className="w-9 text-right text-[11px] tabular-nums text-dim">{pct(r.value)}%</span>
    </li>)}</ul>
  </div>
}

export function Meter({ value, label, className }: { value: number | null; label: string; className?: string }) {
  return <span role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value ?? undefined} className={cx('ds-meter', className)}><span style={{ width: `${Math.max(0, Math.min(100, value ?? 0))}%` }} /></span>
}

/** Tiny trend line for table cells and stat cards. */
export function Sparkline({ values, label, width = 96, height = 28 }: { values: number[]; label: string; width?: number; height?: number }) {
  const max = Math.max(1, ...values), step = values.length > 1 ? width / (values.length - 1) : width
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(height - 2 - v / max * (height - 4)).toFixed(1)}`).join(' ')
  return <svg role="img" aria-label={`${label}: ${values.join(', ')}`} width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible"><polyline points={pts} fill="none" stroke="var(--color-chart-1)" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" /></svg>
}
