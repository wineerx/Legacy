import { useState } from 'react'
import type { GridQuery } from '@shared/types'
import { FacetField, Input, OptionList, type FacetOption, type FilterGroupDef } from '../../components/ui'
import {
  DURATION_OPTIONS, NO_PERIOD, NO_THRESHOLDS, PERIOD_PRESETS, PeriodFields, ThresholdFields,
  durationQuery, hashtagChips, optionChips, periodChips, periodQuery, thresholdChips, thresholdQuery, type Period, type Thresholds
} from '../library/filter-fields'

const KIND_OPTIONS: FacetOption[] = [{ value: '', label: 'Todos' }, { value: 'videos', label: 'Vídeos e reels' }, { value: 'images', label: 'Fotos e carrosséis' }]
const DOWNLOAD_OPTIONS: FacetOption[] = [{ value: '', label: 'Todos' }, { value: 'yes', label: 'Baixados' }, { value: 'no', label: 'Não baixados' }]
const PUBLISHED_OPTIONS: FacetOption[] = [{ value: '', label: 'Todos' }, { value: 'yes', label: 'Já publicados' }, { value: 'no', label: 'Nunca publicados' }]
const labels = (options: FacetOption[]) => options.map(o => o.label)
const bool = (v: string) => v === 'yes' ? true : v === 'no' ? false : undefined

/** One-choice group: the bar field and the panel list share the value; '' means any. */
function single(id: string, title: string, options: FacetOption[], value: string, set: (v: string) => void, quick = false): FilterGroupDef {
  const values = value ? [value] : []
  const change = (v: string[]) => set(v[0] ?? '')
  return { id, title, quick, chips: optionChips(options, values, change), keywords: labels(options),
    field: quick ? <FacetField label={title} options={options} value={values} onChange={change} /> : undefined,
    body: <OptionList searchable={false} label={title} options={options} value={values} onChange={change} /> }
}

/**
 * Filters of the posts of the active profile. Quick: Tipo de mídia, Download. Advanced: Período de
 * publicação, Desempenho, Duração, Publicação, Hashtag. The caption search lives in the bar.
 */
export function useProfileFilters(timeZone: string) {
  const [text, setText] = useState('')
  const [kind, setKind] = useState('')
  const [downloaded, setDownloaded] = useState('')
  const [period, setPeriod] = useState<Period>(NO_PERIOD)
  const [metrics, setMetrics] = useState<Thresholds>(NO_THRESHOLDS)
  const [duration, setDuration] = useState('')
  const [published, setPublished] = useState('')
  const [hashtag, setHashtag] = useState('')
  const presets = PERIOD_PRESETS.posts
  const dates = periodQuery(period, presets, timeZone)
  const query: Partial<GridQuery> = {
    text: text || undefined, mediaKind: (kind || 'all') as GridQuery['mediaKind'], downloaded: bool(downloaded), published: bool(published),
    from: dates.from, to: dates.to, ...thresholdQuery(metrics), ...durationQuery(duration), hashtag: hashtag.replace(/^#/, '') || undefined
  }
  const groups: FilterGroupDef[] = [
    single('kind', 'Tipo de mídia', KIND_OPTIONS, kind, setKind, true),
    single('download', 'Download', DOWNLOAD_OPTIONS, downloaded, setDownloaded, true),
    { id: 'period', title: 'Período de publicação', chips: periodChips(period, presets, setPeriod), keywords: labels(presets),
      body: <PeriodFields label="Período de publicação" presets={presets} value={period} onChange={setPeriod} /> },
    { id: 'metrics', title: 'Desempenho', chips: thresholdChips(metrics, setMetrics), keywords: ['Views', 'Curtidas', 'Comentários', 'Virais'],
      body: <><p className="px-1 text-[11px] text-dim">Posts sem a métrica ficam de fora.</p><ThresholdFields value={metrics} onChange={setMetrics} /></> },
    single('duration', 'Duração', DURATION_OPTIONS, duration, setDuration),
    single('published', 'Publicação', PUBLISHED_OPTIONS, published, setPublished),
    { id: 'hashtag', title: 'Hashtag', chips: hashtagChips(hashtag, setHashtag), keywords: ['Legenda'],
      body: <Input label="Hashtag" placeholder="#viagem" value={hashtag} onChange={e => setHashtag(e.target.value)} className="w-full" /> }
  ]
  const count = groups.reduce((n, g) => n + g.chips.length, 0)
  const clear = () => { setText(''); setKind(''); setDownloaded(''); setPeriod(NO_PERIOD); setMetrics(NO_THRESHOLDS); setDuration(''); setPublished(''); setHashtag('') }
  return { query, groups, count, clear, text, setText, active: count > 0 || Boolean(text) }
}
