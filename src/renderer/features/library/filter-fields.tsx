import { localDate } from '@shared/agenda'
import { zonedToUtc } from '@shared/schedule'
import { ChipGroup, DatePicker, Input, OptionList, type FacetOption, type FilterChip } from '../../components/ui'

/** Pieces shared by the Library and Profiles filter panels. */

export type Metric = 'views' | 'likes' | 'comments'
export type Thresholds = Record<Metric, string>
export const NO_THRESHOLDS: Thresholds = { views: '', likes: '', comments: '' }
const METRIC_LABELS: Record<Metric, string> = { views: 'Views', likes: 'Curtidas', comments: 'Comentários' }
const QUICK_THRESHOLDS = [{ value: 'any', label: 'Qualquer' }, { value: '1000', label: '1 mil+' }, { value: '10000', label: '10 mil+' }, { value: '100000', label: '100 mil+' }, { value: '1000000', label: '1 mi+' }]

export const thresholdQuery = (t: Thresholds) => ({
  minViews: t.views ? Number(t.views) : undefined, minLikes: t.likes ? Number(t.likes) : undefined, minComments: t.comments ? Number(t.comments) : undefined
})
export const thresholdChips = (t: Thresholds, set: (t: Thresholds) => void): FilterChip[] =>
  (Object.keys(METRIC_LABELS) as Metric[]).filter(m => t[m]).map(m => ({ key: m, label: `${METRIC_LABELS[m]} ≥ ${Number(t[m]).toLocaleString('pt-BR')}`, remove: () => set({ ...t, [m]: '' }) }))

/** One minimum per metric (quick steps or a typed value); metrics combine with AND. Missing metrics never pass. */
export function ThresholdFields({ value, onChange }: { value: Thresholds; onChange(t: Thresholds): void }) {
  return <div className="grid gap-3">
    {(Object.keys(METRIC_LABELS) as Metric[]).map(m => <div key={m} className="grid gap-1.5">
      <ChipGroup label={`${METRIC_LABELS[m]} mínimas rápidas`} value={QUICK_THRESHOLDS.some(q => q.value === value[m]) ? value[m] : value[m] ? 'custom' : 'any'}
        onChange={v => onChange({ ...value, [m]: v === 'any' ? '' : v })} options={QUICK_THRESHOLDS} className="[&_.ds-chip]:h-6 [&_.ds-chip]:px-2 [&_.ds-chip]:text-[11px]" />
      <Input label={`Mínimo de ${METRIC_LABELS[m].toLowerCase()}`} placeholder="Sem mínimo" type="number" min={0} value={value[m]}
        onChange={e => onChange({ ...value, [m]: e.target.value.replace(/\D/g, '') })} className="w-full" />
    </div>)}
  </div>
}

export type Period = { preset: string; from: string; to: string }
export const NO_PERIOD: Period = { preset: '', from: '', to: '' }
type Preset = { value: string; label: string; days?: number }
export const PERIOD_PRESETS = {
  library: [{ value: '', label: 'Qualquer data' }, { value: 'today', label: 'Hoje', days: 1 }, { value: '7', label: '7 dias', days: 7 }, { value: '30', label: '30 dias', days: 30 }, { value: 'custom', label: 'Personalizado' }],
  posts: [{ value: '', label: 'Qualquer data' }, { value: '7', label: '7 dias', days: 7 }, { value: '30', label: '30 dias', days: 30 }, { value: '90', label: '90 dias', days: 90 }, { value: 'custom', label: 'Personalizado' }]
} satisfies Record<string, Preset[]>

const br = (date: string) => date.split('-').reverse().slice(0, 2).join('/')
export function periodQuery(p: Period, presets: Preset[], timeZone: string, now = Date.now()) {
  const preset = presets.find(x => x.value === p.preset)
  if (preset?.days) return { from: zonedToUtc(localDate(now - (preset.days - 1) * 86_400_000, timeZone), '00:00', timeZone).toISOString(), to: undefined }
  if (p.preset !== 'custom') return { from: undefined, to: undefined }
  return {
    from: p.from ? zonedToUtc(p.from, '00:00', timeZone).toISOString() : undefined,
    to: p.to ? new Date(zonedToUtc(p.to, '23:59', timeZone).getTime() + 59_999).toISOString() : undefined
  }
}
export function periodChips(p: Period, presets: Preset[], set: (p: Period) => void): FilterChip[] {
  if (!p.preset || (p.preset === 'custom' && !p.from && !p.to)) return []
  const label = p.preset !== 'custom' ? presets.find(x => x.value === p.preset)?.label ?? p.preset
    : p.from && p.to ? `${br(p.from)} – ${br(p.to)}` : p.from ? `Desde ${br(p.from)}` : `Até ${br(p.to)}`
  return [{ key: 'period', label, remove: () => set(NO_PERIOD) }]
}
export function PeriodFields({ label, presets, value, onChange }: { label: string; presets: Preset[]; value: Period; onChange(p: Period): void }) {
  return <div className="grid gap-2">
    <OptionList label={label} options={presets} value={value.preset ? [value.preset] : []} onChange={v => onChange({ ...NO_PERIOD, preset: v[0] ?? '' })} />
    {value.preset === 'custom' && <div className="grid gap-2 px-1">
      <DatePicker label="De" value={value.from} onChange={from => onChange({ ...value, from })} clearable />
      <DatePicker label="Até" value={value.to} onChange={to => onChange({ ...value, to })} clearable />
    </div>}
  </div>
}

export const DURATION_OPTIONS: (FacetOption & { min?: number; max?: number })[] = [
  { value: '', label: 'Qualquer' }, { value: '15', label: 'Até 15 s', max: 15_000 }, { value: '30', label: 'Até 30 s', max: 30_000 },
  { value: '60', label: 'Até 60 s', max: 60_000 }, { value: '90', label: 'Até 90 s', max: 90_000 }, { value: '90+', label: 'Mais de 90 s', min: 90_001 }
]
export const durationQuery = (v: string) => { const o = DURATION_OPTIONS.find(x => x.value === v); return { minDurationMs: o?.min, maxDurationMs: o?.max } }

/** Chips of an option-based group, built from the chosen values. */
export const optionChips = (options: FacetOption[], value: string[], set: (v: string[]) => void): FilterChip[] =>
  value.map(v => ({ key: v, label: options.find(o => o.value === v)?.label ?? v, remove: () => set(value.filter(x => x !== v)) }))

export const hashtagChips = (tag: string, set: (v: string) => void): FilterChip[] => tag.replace(/^#/, '') ? [{ key: 'tag', label: `#${tag.replace(/^#/, '')}`, remove: () => set('') }] : []
