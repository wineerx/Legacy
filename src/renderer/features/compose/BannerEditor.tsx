import type { CoverTextSpec } from '@shared/types'
import { Input, Pills, Toggle } from '../../components/ui'

export type BannerState = { enabled: boolean; spec: CoverTextSpec; startS: number; endS: number }

export function BannerEditor({ value, onChange }: { value: BannerState; onChange(v: BannerState): void }) {
  const set = (patch: Partial<BannerState>) => onChange({ ...value, ...patch })
  return (
    <section aria-labelledby="banner-h" className="flex flex-col gap-3 rounded-card border border-line bg-panel p-4">
      <div className="flex items-center justify-between">
        <h2 id="banner-h" className="text-sm font-semibold">Banner no vídeo</h2>
        <Toggle label="Aplicar banner" checked={value.enabled} onChange={(enabled) => set({ enabled })} />
      </div>
      <p className="text-xs text-dim">Texto gravado no próprio vídeo durante o intervalo escolhido. Nenhuma marca do Legacy é adicionada.</p>
      {value.enabled && (
        <>
          <Input label="Texto do banner" value={value.spec.text} onChange={(e) => set({ spec: { ...value.spec, text: e.target.value } })} />
          <Pills label="Posição do banner" value={value.spec.position} onChange={(position) => set({ spec: { ...value.spec, position } })} options={[{ value: 'top', label: 'Topo' }, { value: 'center', label: 'Centro' }, { value: 'bottom', label: 'Base' }]} />
          <div className="flex gap-2">
            <Input label="Início (s)" type="number" min={0} step={0.5} value={value.startS} onChange={(e) => set({ startS: Number(e.target.value) })} />
            <Input label="Fim (s)" type="number" min={0.5} step={0.5} value={value.endS} onChange={(e) => set({ endS: Number(e.target.value) })} />
          </div>
        </>
      )}
    </section>
  )
}
