import { useState } from 'react'
import type { ContainerVisualSnapshot } from '@shared/container-visual'
import { defaultWatermark, defaultBanner, defaultCover, MAX_VISUAL_IMAGE_BYTES, visualImage } from '@shared/container-visual'
import { Input, Select, Toggle, Button } from '../../components/ui'
import { Field, FieldGroup, FieldDescription, FieldError } from '../../components/ui/Field'

export function ContainerVisualFields({ value, onChange, disabled, portalContainer, onLoading }: { value: ContainerVisualSnapshot; onChange(value: ContainerVisualSnapshot): void; disabled: boolean; portalContainer: HTMLElement | null; onLoading(value: boolean): void }) {
  const [error, setError] = useState('')
  const watermark = value.watermark ?? defaultWatermark(), banner = value.banner ?? defaultBanner(), cover = value.cover ?? defaultCover()
  const updateWatermark = (changes: Partial<typeof watermark>) => onChange({ ...value, watermark: { ...watermark, ...changes } })
  const updateBanner = (changes: Partial<typeof banner>) => onChange({ ...value, banner: { ...banner, ...changes } })
  const updateCover = (changes: Partial<typeof cover>) => onChange({ ...value, cover: { ...cover, ...changes } })
  async function pick(file: File | undefined, update: (value: { imageData: string }) => void) {
    if (!file) return
    setError(''); onLoading(true)
    try {
      if (file.size > MAX_VISUAL_IMAGE_BYTES) throw new Error('Use uma imagem PNG de até 1 MB.')
      const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('Não foi possível ler a imagem.')); reader.readAsDataURL(file) })
      const checked = visualImage.safeParse(data)
      if (!checked.success) throw new Error('Use uma imagem PNG válida de até 1 MB e 4.096 pixels por lado.')
      update({ imageData: checked.data })
    } catch (e) { setError(e instanceof Error ? e.message : 'Imagem inválida.') } finally { onLoading(false) }
  }
  return <FieldGroup>
    <Field><div className="flex items-center justify-between gap-2"><span className="text-sm">Marca d’água</span><Toggle label="Ativar marca d’água" checked={watermark.enabled} disabled={disabled} onChange={enabled => updateWatermark({ enabled })} /></div>
      {watermark.enabled && <FieldGroup>
        <Field><Input label="Imagem da marca d’água" type="file" accept="image/png" disabled={disabled} onChange={e => void pick(e.target.files?.[0], updateWatermark)} /><FieldDescription>{watermark.imageData ? 'Imagem salva na configuração do Container.' : 'PNG transparente, até 1 MB.'}</FieldDescription></Field>
        <Field><Select label="Posição da marca d’água" value={watermark.position} disabled={disabled} portalContainer={portalContainer} onChange={e => updateWatermark({ position: e.target.value as typeof watermark.position })}><option value="top-left">Superior esquerdo</option><option value="top-right">Superior direito</option><option value="bottom-left">Inferior esquerdo</option><option value="bottom-right">Inferior direito</option><option value="center">Centro</option></Select></Field>
        <Field><Input label="Tamanho da marca d’água (%)" type="number" min={1} max={50} step={1} value={watermark.scalePct} disabled={disabled} onChange={e => updateWatermark({ scalePct: Number(e.target.value) })} /><FieldDescription>Percentual da largura do vídeo; altura limitada a 45% para preservar a proporção.</FieldDescription></Field>
        <Field><Input label="Opacidade da marca d’água (%)" type="number" min={0} max={100} step={1} value={watermark.opacityPct} disabled={disabled} onChange={e => updateWatermark({ opacityPct: Number(e.target.value) })} /></Field>
      </FieldGroup>}
    </Field>
    <Field><div className="flex items-center justify-between gap-2"><span className="text-sm">Banner</span><Toggle label="Ativar banner" checked={banner.enabled} disabled={disabled} onChange={enabled => updateBanner({ enabled })} /></div>
      {banner.enabled && <FieldGroup><Field><Input label="Imagem do banner" type="file" accept="image/png" disabled={disabled} onChange={e => void pick(e.target.files?.[0], updateBanner)} /><FieldDescription>PNG com transparência; aplicado no quadro inteiro durante o intervalo.</FieldDescription></Field>
        <Field><Input label="Início do banner (s)" type="number" min={0} max={86400} step={0.1} value={banner.startMs / 1000} disabled={disabled} onChange={e => updateBanner({ startMs: Math.round(Number(e.target.value) * 1000) })} /></Field>
        <Field><Input label="Fim do banner (s)" type="number" min={0.1} max={86400} step={0.1} value={banner.endMs / 1000} disabled={disabled} onChange={e => updateBanner({ endMs: Math.round(Number(e.target.value) * 1000) })} /></Field></FieldGroup>}
    </Field>
    <Field><div className="flex items-center justify-between gap-2"><span className="text-sm">Capa</span><Toggle label="Ativar capa" checked={cover.enabled} disabled={disabled} onChange={enabled => updateCover({ enabled })} /></div>
      {cover.enabled && <Field><Input label="Imagem da capa" type="file" accept="image/png" disabled={disabled} onChange={e => void pick(e.target.files?.[0], updateCover)} /><FieldDescription>Inserida como primeiro quadro, com ajuste e recorte central para o vídeo.</FieldDescription></Field>}
    </Field>
    {error && <FieldError>{error}</FieldError>}
    <Button size="sm" disabled={disabled} onClick={() => onChange({ version: 1 })}>Desativar configurações visuais</Button>
  </FieldGroup>
}
