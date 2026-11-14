import { useState } from 'react'
import type { GridQuery, LibraryDestinationFilter, LibraryOriginFilter, LibraryStateFilter } from '@shared/types'
import type { LibraryFilterOptions } from '@shared/ipc-contract'
import { FacetField, Input, OptionList, type FacetOption, type FilterGroupDef } from '../../components/ui'
import {
  DURATION_OPTIONS, NO_PERIOD, NO_THRESHOLDS, PERIOD_PRESETS, PeriodFields, ThresholdFields,
  durationQuery, hashtagChips, optionChips, periodChips, periodQuery, thresholdChips, thresholdQuery, type Period, type Thresholds
} from './filter-fields'

export const STATE_OPTIONS: FacetOption[] = [
  { value: 'ready', label: 'Prontos', tone: 'green' }, { value: 'processing', label: 'Processando', tone: 'orange' },
  { value: 'scheduled', label: 'Agendados', tone: 'purple' }, { value: 'unscheduled', label: 'Não agendados', tone: 'neutral' },
  { value: 'published', label: 'Publicados', tone: 'blue' }, { value: 'unpublished', label: 'Não publicados', tone: 'neutral' },
  { value: 'failed', label: 'Com erro', tone: 'red' }
]
const ORIGIN_OPTIONS: FacetOption[] = [{ value: 'pc', label: 'Computador' }, { value: 'instagram', label: 'Instagram' }, { value: 'tiktok', label: 'TikTok' }]
const DESTINATION_OPTIONS: FacetOption[] = [{ value: 'instagram', label: 'Instagram' }, { value: 'tiktok', label: 'TikTok' }]
const labels = (options: FacetOption[]) => options.map(o => o.label)

/**
 * Library filter groups. Perfil de origem is the quick filter when downloaded videos are available.
 */
export function useLibraryFilters(timeZone: string, options: LibraryFilterOptions | undefined) {
  const [text, setText] = useState('')
  const [statuses, setStatuses] = useState<string[]>([])
  const [profiles, setProfiles] = useState<string[]>([])
  const [period, setPeriod] = useState<Period>(NO_PERIOD)
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const [origins, setOrigins] = useState<string[]>([])
  const [destinations, setDestinations] = useState<string[]>([])
  const [accounts, setAccounts] = useState<string[]>([])
  const [duration, setDuration] = useState('')
  const [metrics, setMetrics] = useState<Thresholds>(NO_THRESHOLDS)
  const [hashtag, setHashtag] = useState('')

  const profileOptions: FacetOption[] = (options?.profiles ?? []).map(p => ({ value: p.id, label: `@${p.username}`, count: p.count }))
  const accountOptions: FacetOption[] = (options?.accounts ?? []).map(a => ({ value: a.username, label: `@${a.username}`, count: a.count }))
  const presets = PERIOD_PRESETS.library
  const dates = periodQuery(period, presets, timeZone)
  const query: Partial<GridQuery> = {
    text: text || undefined,
    statuses: statuses.length ? statuses as LibraryStateFilter[] : undefined,
    sourceProfileIds: profiles.length ? profiles : undefined,
    from: dates.from, to: dates.to,
    favoritesOnly: favoritesOnly || undefined,
    origins: origins.length ? origins as LibraryOriginFilter[] : undefined,
    destinations: destinations.length ? destinations as LibraryDestinationFilter[] : undefined,
    publicationAccounts: accounts.length ? accounts : undefined,
    ...durationQuery(duration), ...thresholdQuery(metrics),
    hashtag: hashtag.replace(/^#/, '') || undefined
  }

  const durationValue = duration ? [duration] : []
  const groups: FilterGroupDef[] = [
    { id: 'state', title: 'Estado', chips: optionChips(STATE_OPTIONS, statuses, setStatuses), keywords: labels(STATE_OPTIONS),
      body: <OptionList searchable={false} label="Estado" multiple options={STATE_OPTIONS} value={statuses} onChange={setStatuses} /> },
    ...(profileOptions.length ? [{ id: 'profile', title: 'Perfil de origem', quick: true, chips: optionChips(profileOptions, profiles, setProfiles), keywords: labels(profileOptions),
      field: <FacetField label="Perfil de origem" multiple options={profileOptions} value={profiles} onChange={setProfiles} />,
      body: <OptionList searchable={false} label="Perfil de origem" multiple options={profileOptions} value={profiles} onChange={setProfiles} /> }] : []),
    { id: 'period', title: 'Período de importação', chips: periodChips(period, presets, setPeriod), keywords: labels(presets),
      body: <PeriodFields label="Período de importação" presets={presets} value={period} onChange={setPeriod} /> },
    { id: 'favorites', title: 'Favoritos', chips: favoritesOnly ? [{ key: 'fav', label: 'Somente favoritos', remove: () => setFavoritesOnly(false) }] : [], keywords: ['Somente favoritos'],
      body: <label className="ds-option-row"><input type="checkbox" checked={favoritesOnly} onChange={e => setFavoritesOnly(e.target.checked)} />Somente favoritos</label> },
    { id: 'origin', title: 'Origem', chips: optionChips(ORIGIN_OPTIONS, origins, setOrigins), keywords: labels(ORIGIN_OPTIONS),
      body: <OptionList searchable={false} label="Origem" multiple options={ORIGIN_OPTIONS} value={origins} onChange={setOrigins} /> },
    { id: 'destination', title: 'Destino', chips: optionChips(DESTINATION_OPTIONS, destinations, setDestinations), keywords: labels(DESTINATION_OPTIONS),
      body: <><OptionList searchable={false} label="Destino" multiple options={DESTINATION_OPTIONS} value={destinations} onChange={setDestinations} /><p className="px-2 text-[11px] text-dim">Instagram inclui publicações pendentes. TikTok, exportações concluídas.</p></> },
    ...(accountOptions.length ? [{ id: 'account', title: 'Conta que publicou', chips: optionChips(accountOptions, accounts, setAccounts), keywords: labels(accountOptions),
      body: <OptionList searchable={false} label="Conta que publicou" multiple options={accountOptions} value={accounts} onChange={setAccounts} /> }] : []),
    { id: 'duration', title: 'Duração', chips: optionChips(DURATION_OPTIONS, durationValue, v => setDuration(v[0] ?? '')), keywords: labels(DURATION_OPTIONS),
      body: <OptionList searchable={false} label="Duração" options={DURATION_OPTIONS} value={durationValue} onChange={v => setDuration(v[0] ?? '')} /> },
    { id: 'metrics', title: 'Desempenho na origem', chips: thresholdChips(metrics, setMetrics), keywords: ['Views', 'Curtidas', 'Comentários'], defaultOpen: false,
      body: <><p className="px-1 text-[11px] text-dim">Métricas do post de origem. Vídeos sem a métrica ficam de fora.</p><ThresholdFields value={metrics} onChange={setMetrics} /></> },
    { id: 'hashtag', title: 'Hashtag', chips: hashtagChips(hashtag, setHashtag), keywords: ['Legenda'], defaultOpen: false,
      body: <Input label="Hashtag na legenda de origem" placeholder="#viagem" value={hashtag} onChange={e => setHashtag(e.target.value)} className="w-full" /> }
  ]
  const count = groups.reduce((n, g) => n + g.chips.length, 0)
  const clear = () => {
    setText(''); setStatuses([]); setProfiles([]); setPeriod(NO_PERIOD); setFavoritesOnly(false); setOrigins([]); setDestinations([])
    setAccounts([]); setDuration(''); setMetrics(NO_THRESHOLDS); setHashtag('')
  }
  return { query, groups, count, clear, text, setText, active: count > 0 || Boolean(text) }
}
