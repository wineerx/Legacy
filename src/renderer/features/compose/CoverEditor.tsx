import { CollapsibleCard } from '../../components/ui'
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { CoverDto } from '@shared/ipc-contract'
import type { CoverTextSpec } from '@shared/types'
import { call, ApiError } from '../../lib/api'
import { Button, Input, Pills, useToast } from '../../components/ui'

export const DEFAULT_TEXT: CoverTextSpec = { text: '', position: 'bottom', fontSizePct: 8, color: '#FFFFFF', background: '#000000B3' }

export function CoverEditor({ workspaceId, covers, selectedId, onSelect }: { workspaceId: string; covers: CoverDto[]; selectedId: string | null; onSelect(id: string | null): void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [name, setName] = useState('Capa padrão')
  const [frameS, setFrameS] = useState(1)
  const [text, setText] = useState<CoverTextSpec>(DEFAULT_TEXT)
  const fail = (e: unknown) => toast.show({ title: 'Não foi possível criar a capa', body: e instanceof ApiError ? e.message : undefined, tone: 'error' })
  const done = (c: CoverDto | null) => { if (c) { onSelect(c.id); void qc.invalidateQueries({ queryKey: ['covers'] }) } }
  const createImage = useMutation({ mutationFn: () => call('covers.createImage', { workspaceId, name }), onSuccess: done, onError: fail })
  const createFrame = useMutation({ mutationFn: () => call('covers.createFrameText', { workspaceId, name, frameMs: Math.round(frameS * 1000), text }), onSuccess: done, onError: fail })

  return (
    <section aria-labelledby="cover-h" className="flex flex-col gap-3 rounded-card border border-line bg-panel p-4">
      <h2 id="cover-h" className="text-sm font-semibold">Capa uniforme</h2>
      <p className="text-xs text-dim">A mesma capa em todos os vídeos do lote. Na exportação manual, entra como primeiro frame e também segue como <code>capa.png</code>.</p>
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" variant={selectedId === null ? 'primary' : 'secondary'} onClick={() => onSelect(null)}>Sem capa</Button>
        {covers.map((c) => <Button key={c.id} size="sm" variant={selectedId === c.id ? 'primary' : 'secondary'} onClick={() => onSelect(c.id)}>{c.name}</Button>)}
      </div>
      <CollapsibleCard title={<>Nova capa</>}>
        <div className="flex flex-col gap-3">
          <Input label="Nome" value={name} onChange={(e) => setName(e.target.value)} />
          <Button onClick={() => createImage.mutate()}>Usar uma imagem (PNG/JPG)</Button>
          <p className="text-xs text-dim">ou um frame de cada vídeo com texto por cima:</p>
          <Input label="Segundo do frame" type="number" min={0} step={0.5} value={frameS} onChange={(e) => setFrameS((e.target.value === '' ? NaN : Number(e.target.value)))} />
          <Input label="Texto da capa" value={text.text} onChange={(e) => setText({ ...text, text: e.target.value })} placeholder="EP 1 — Treino de perna" />
          <Pills label="Posição do texto" value={text.position} onChange={(position) => setText({ ...text, position })} options={[{ value: 'top', label: 'Topo' }, { value: 'center', label: 'Centro' }, { value: 'bottom', label: 'Base' }]} />
          <Button variant="primary" disabledReason={!Number.isFinite(frameS) || frameS < 0 ? 'Escolha um segundo válido para o frame.' : undefined} onClick={() => createFrame.mutate()}>Criar capa com frame e texto</Button>
        </div>
      </CollapsibleCard>
    </section>
  )
}
