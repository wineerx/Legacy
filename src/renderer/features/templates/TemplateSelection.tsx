import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ContainerVisualSnapshot } from '@shared/container-visual'
import { call } from '../../lib/api'
import { Button,Select } from '../../components/ui'
import { FieldError } from '../../components/ui/Field'
/** Destination data replaces the Template's test values; caption always comes from each item. */
function draftContext(context:Extract<ContainerVisualSnapshot,{version:2}>['context'],username?:string){
  const {caption:_caption,...local}=context
  return username?{...local,username}:local
}
export function TemplateSelection({workspaceId,value,onChange,disabled,portalContainer,destinationUsername}:{workspaceId:string;value:ContainerVisualSnapshot;onChange(v:ContainerVisualSnapshot):void;disabled:boolean;portalContainer:HTMLElement|null;destinationUsername?:string}){
  const [id,setId]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('')
  const templates=useQuery({queryKey:['visual-templates-selector',workspaceId],queryFn:()=>call('templates.query',{workspaceId,status:'active',text:'',page:1,pageSize:100}),staleTime:0})
  return <div className="flex flex-col gap-2"><Select label="Template visual" value={id} disabled={disabled || busy || templates.isError} portalContainer={portalContainer} onChange={e=>setId(e.target.value)}><option value="">Configuração deste Container</option>{templates.data?.items.map(t=><option key={t.id} value={t.id}>{t.name} v{t.version}</option>)}</Select>
    {value.version===2 && value.source && <p className="text-xs text-dim">Origem: {value.source.templateName} v{value.source.templateVersion}. Cópia independente.</p>}
    <p className="text-xs text-dim">Aplicar substitui a configuração visual; as configurações individuais dos vídeos permanecem. Ajuste e salve o rascunho em seguida.</p>
    <Button disabled={disabled || busy || !id} onClick={()=>{if(busy)return;setBusy(true);setError('');void call('templates.get',{workspaceId,templateId:id}).then(({template:t})=>{if(t.status!=='active')throw new Error('Template foi arquivado. Atualize a lista.');onChange(t.visual.version===2?{...t.visual,context:draftContext(t.visual.context,destinationUsername),source:{templateId:t.id,templateVersion:t.version,templateName:t.name}}:t.visual)}).catch(e=>setError(String(e))).finally(()=>setBusy(false))}}>Aplicar Template ao rascunho</Button>
    {templates.isError && <FieldError>Não foi possível consultar Templates. <Button onClick={()=>void templates.refetch()}>Atualizar Templates</Button></FieldError>}{error && <FieldError>{error}</FieldError>}
  </div>
}
