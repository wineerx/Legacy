import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { GridItem } from '@shared/types'
import { newElement,blankLayout,type VisualElement,type VisualLayout } from '@shared/visual-layout'
import { containerVisualSnapshot,visualImage,type ContainerVisualSnapshot } from '@shared/container-visual'
import { call,mediaUrl } from '../../lib/api'
import { Button,Input,Select,Pills,Toggle,CollapsibleCard,Pagination } from '../../components/ui'
import { FieldGroup,FieldError } from '../../components/ui/Field'
import { Slider } from '../../components/ui/Slider'
import { ColorField } from '../../components/ui/ColorField'
import { Textarea } from '../../components/ui/Textarea'
import { VisualPreview } from './VisualPreview'
import { ContainerVisualFields } from '../library/ContainerVisualFields'
import { compositionPreset } from './presets'
import { layoutWarnings,elementLabels as labels } from './layout-warnings'
type Scene=Extract<ContainerVisualSnapshot,{version:2}>
export function VisualLayoutEditor({value,onChange,workspaceId,media,disabled=false,portalContainer=null,onLoading}:{value:Scene;onChange(value:Scene):void;workspaceId:string;media?:GridItem[];disabled?:boolean;portalContainer?:HTMLElement|null;onLoading?(loading:boolean):void}){
  const [selected,setSelected]=useState(''),[mode,setMode]=useState<'individual'|'grid'>('individual'),[picking,setPicking]=useState(false),[text,setText]=useState(''),[page,setPage]=useState(0),[samples,setSamples]=useState<GridItem[]>(media ?? []),[error,setError]=useState(''),[loading,setLoadingState]=useState(false)
  const setLoading=(v:boolean)=>{setLoadingState(v);onLoading?.(v)}
  const library=useQuery({queryKey:['template-preview-library',workspaceId,text,page],enabled:picking,queryFn:()=>call('grid.query',{workspaceId,source:'library',sortBy:'importedAt',sortDir:'desc',text,limit:18,offset:page*18})})
  const layout=value.layout,element=layout.elements.find(e=>e.id===selected),locked=disabled || loading
  const update=(patch:Partial<VisualLayout>)=>onChange({...value,layout:{...layout,...patch}})
  const patch=(id:string,changes:Partial<VisualElement>)=>update({elements:layout.elements.map(e=>e.id===id?{...e,...changes} as VisualElement:e)})
  const num=(label:string,key:'x'|'y'|'width'|'height'|'radius'|'borderWidth'|'opacity',min:number,max:number)=>element && <Input label={label} type="number" min={min} max={max} value={element[key]} disabled={locked} onChange={e=>patch(element.id,{[key]:Number(e.target.value)})} />
  const select=(label:string,current:string,values:string[],change:(v:string)=>void)=><Select label={label} value={current} portalContainer={portalContainer} disabled={locked} onChange={e=>change(e.target.value)}>{values.map(v=><option key={v} value={v}>{v}</option>)}</Select>
  async function upload(file?:File){if(!file || !element || element.type==='text')return;setLoading(true);setError('');try{if(file.size>1024*1024)throw new Error('Use PNG até 1 MB.');const data=await new Promise<string>((res,rej)=>{const reader=new FileReader();reader.onload=()=>res(String(reader.result));reader.onerror=rej;reader.readAsDataURL(file)});patch(element.id,{imageData:visualImage.parse(data)})}catch{setError('Use PNG válido até 1 MB e 4.096 pixels por lado.')}finally{setLoading(false)}}
  const checked=containerVisualSnapshot.safeParse(value),warnings=layoutWarnings(value)
  return <div className="grid gap-5 lg:grid-cols-[minmax(260px,340px)_minmax(0,1fr)]">
    <div className="flex min-w-0 flex-col gap-4">
      <CollapsibleCard title="Layout e formato" defaultOpen><FieldGroup>
        {select('Composição inicial','Personalizada',['Personalizada','Meme branco','Meme dark','Full screen','Centralizado'],v=>{if(v!=='Personalizada'){update(compositionPreset(v==='Meme dark'?'dark':v==='Full screen'?'full':v==='Centralizado'?'center':'white'));setSelected('')}})}
        {select('Formato',`${layout.width}:${layout.height}`,['1080:1920','1080:1350','1080:1080','1920:1080',`${layout.width}:${layout.height}`].filter((v,i,a)=>a.indexOf(v)===i),v=>{const [width,height]=v.split(':').map(Number);const sx=width/layout.width,sy=height/layout.height;update({width,height,elements:layout.elements.map(e=>({...e,x:Math.round(e.x*sx),y:Math.round(e.y*sy),width:Math.round(e.width*sx),height:Math.round(e.height*sy)}))})})}
        <div className="grid grid-cols-2 gap-2"><Input label="Largura do canvas" type="number" min={320} max={2160} step={2} value={layout.width} disabled={locked} onChange={e=>update({width:Number(e.target.value)})} /><Input label="Altura do canvas" type="number" min={320} max={2160} step={2} value={layout.height} disabled={locked} onChange={e=>update({height:Number(e.target.value)})} /></div>
        <ColorField label="Cor de fundo" value={layout.background} disabled={locked} portalContainer={portalContainer} onChange={background=>update({background})} />
        <Input label="Margem / área de respiro (px)" type="number" min={0} max={500} value={layout.margin} disabled={locked} onChange={e=>update({margin:Number(e.target.value)})} />
        <Button disabled={locked} onClick={()=>update({elements:layout.elements.map(e=>e.type==='media'?{...e,x:layout.margin,width:Math.max(1,layout.width-2*layout.margin)}:e)})}>Aplicar margens à mídia</Button>
      </FieldGroup></CollapsibleCard>
      <CollapsibleCard title="Elementos" defaultOpen><FieldGroup>
        <div className="flex flex-wrap gap-2">{(['image','text','media','watermark','banner'] as const).map(type=><Button key={type} size="sm" disabled={locked || layout.elements.length>=32 || type==='media' && layout.elements.some(e=>e.type==='media')} onClick={()=>{const id=`${type}-${crypto.randomUUID().slice(0,8)}`;update({elements:[...layout.elements,newElement(type,id)]});setSelected(id)}}>+ {labels[type]}</Button>)}</div>
        <Select label="Elemento selecionado" value={selected} disabled={locked} portalContainer={portalContainer} onChange={e=>setSelected(e.target.value)}><option value="">Selecione no preview</option>{layout.elements.map(e=><option key={e.id} value={e.id}>{labels[e.type]} · {e.id}</option>)}</Select>
        {element && <><div className="flex gap-2"><Button size="sm" disabled={locked || layout.elements[0]===element} onClick={()=>{const list=[...layout.elements],i=list.indexOf(element);[list[i-1],list[i]]=[list[i],list[i-1]];update({elements:list})}}>Para trás</Button><Button size="sm" disabled={locked || layout.elements.at(-1)===element} onClick={()=>{const list=[...layout.elements],i=list.indexOf(element);[list[i+1],list[i]]=[list[i],list[i+1]];update({elements:list})}}>Para frente</Button><Button size="sm" disabled={locked} onClick={()=>{update({elements:layout.elements.filter(e=>e.id!==element.id)});setSelected('')}}>Remover elemento</Button></div>
          <Toggle label="Elemento visível" checked={element.visible} disabled={locked} onChange={visible=>patch(element.id,{visible})} />
          <div className="grid grid-cols-2 gap-2">{num('X (px)','x',-2160,4320)}{num('Y (px)','y',-2160,4320)}{num('Largura (px)','width',1,4320)}{num('Altura (px)','height',1,4320)}{num('Radius (px)','radius',0,2160)}{num('Borda (px)','borderWidth',0,100)}</div>
          <ColorField label="Cor da borda" value={element.borderColor} disabled={locked} portalContainer={portalContainer} onChange={borderColor=>patch(element.id,{borderColor})} />
          {num('Opacidade (%)','opacity',0,100)}<Slider label="Ajustar opacidade" value={element.opacity} disabled={locked} onChange={opacity=>patch(element.id,{opacity})} />
          {element.type==='text'?<>
            <Textarea label="Texto do bloco" value={element.text} disabled={locked} maxLength={4000} onChange={e=>patch(element.id,{text:e.target.value})} />
            <p className="text-xs text-dim">Variáveis: {'{{profile_name}} · {{username}} · {{caption}} · {{custom_text}}'}. A largura controla a quebra automática.</p>
            {select('Fonte',element.font,['Inter','Roboto','Noto Serif'],font=>patch(element.id,{font:font as 'Inter'}))}
            {select('Peso',String(element.weight),['400','500','600','700','800'],weight=>patch(element.id,{weight:Number(weight) as 400}))}
            {select('Alinhamento',element.align,['left','center','right'],align=>patch(element.id,{align:align as 'left'}))}
            <Input label="Tamanho da fonte (px)" type="number" min={8} max={300} value={element.fontSize} disabled={locked} onChange={e=>patch(element.id,{fontSize:Number(e.target.value)})} />
            <Input label="Altura de linha" type="number" min={0.8} max={3} step={0.1} value={element.lineHeight} disabled={locked} onChange={e=>patch(element.id,{lineHeight:Number(e.target.value)})} />
            <Input label="Espaçamento interno do texto" type="number" min={0} max={200} value={element.padding} disabled={locked} onChange={e=>patch(element.id,{padding:Number(e.target.value)})} />
            <ColorField label="Cor do texto" value={element.color} disabled={locked} portalContainer={portalContainer} onChange={color=>patch(element.id,{color})} />
          </>:<><Input label="Imagem PNG do elemento" type="file" accept="image/png" disabled={locked} onChange={e=>void upload(e.target.files?.[0])} />{element.type==='media' && <>
            {select('Ajuste da mídia',element.fit,['contain','cover'],fit=>patch(element.id,{fit:fit as 'contain'}))}
            <Input label="Alinhamento horizontal (%)" type="number" min={0} max={100} value={element.alignX} disabled={locked} onChange={e=>patch(element.id,{alignX:Number(e.target.value)})} /><Input label="Alinhamento vertical (%)" type="number" min={0} max={100} value={element.alignY} disabled={locked} onChange={e=>patch(element.id,{alignY:Number(e.target.value)})} />
            {element.imageData && <Button disabled={locked} onClick={()=>patch(element.id,{imageData:undefined})}>Usar vídeo do Container</Button>}
          </>}{element.type==='banner' && <><Input label="Banner começa (s)" type="number" min={0} step={0.1} value={element.startMs/1000} disabled={locked} onChange={e=>patch(element.id,{startMs:Math.round(Number(e.target.value)*1000)})} /><Input label="Banner termina (s)" type="number" min={0.1} step={0.1} value={element.endMs/1000} disabled={locked} onChange={e=>patch(element.id,{endMs:Math.round(Number(e.target.value)*1000)})} /></>}</>}
        </>}
      </FieldGroup></CollapsibleCard>
      <CollapsibleCard title="Textos dinâmicos" defaultOpen><FieldGroup>{(['profile_name','username','caption','custom_text'] as const).map(key=><Input key={key} label={`Valor de ${key}`} value={value.context[key] ?? ''} disabled={locked} onChange={e=>onChange({...value,context:{...value.context,[key]:e.target.value}})} />)}<p className="text-xs text-dim">Caption usa a legenda efetiva de cada vídeo no agendamento. Os demais valores ficam no snapshot.</p></FieldGroup></CollapsibleCard>
      <CollapsibleCard title="Capa e camadas herdadas"><Input label="Quadro para capa (s)" type="number" min={0} max={86400} step={0.1} value={value.coverFrameMs===undefined?'':value.coverFrameMs/1000} disabled={locked} onChange={e=>onChange({...value,coverFrameMs:e.target.value===''?undefined:Math.round(Number(e.target.value)*1000)})} /><p className="text-xs text-dim">Vazio desativa a seleção de quadro. Capa PNG ou override individual tem prioridade.</p><ContainerVisualFields value={value} onChange={next=>onChange(next.version===2?next:{version:2,layout:blankLayout(),context:{}})} disabled={locked} portalContainer={portalContainer} onLoading={setLoading} /></CollapsibleCard>
      {!checked.success && <FieldError>{checked.error.issues[0].message}</FieldError>}{error && <FieldError>{error}</FieldError>}
      {warnings.length>0 && <ul aria-label="Avisos da composição" className="flex flex-col gap-1">{warnings.map(w=><li key={w} className="text-xs text-warning-fg">{w}</li>)}</ul>}
    </div>
    <div className="flex min-w-0 flex-col gap-4"><div className="flex flex-wrap items-center justify-between gap-2"><Pills<'individual'|'grid'> label="Modo de preview" value={mode} onChange={setMode} options={[{value:'individual',label:'Preview individual'},{value:'grid',label:'Preview em grade'}]} /><Button onClick={()=>setPicking(p=>!p)}>Selecionar mídias da Biblioteca</Button></div>
      {picking && <div className="rounded-card border border-line p-3"><Input label="Buscar mídia para preview" value={text} onChange={e=>{setText(e.target.value);setPage(0)}} /><p className="text-xs text-dim">Selecione até 9 mídias. Nenhum arquivo será processado.</p><div className="grid grid-cols-3 gap-2">{library.data?.items.map(m=><Button key={m.id} aria-pressed={samples.some(v=>v.id===m.id)} onClick={()=>setSamples(v=>v.some(s=>s.id===m.id)?v.filter(s=>s.id!==m.id):v.length<9?[...v,m]:v)} className="h-auto flex-col"><span className="truncate text-xs">{m.caption?.slice(0,40) || m.id}</span>{m.thumbnailPath && <img src={mediaUrl(m.thumbnailPath)} alt="" className="h-16 object-cover" />}</Button>)}</div>{library.isError && <FieldError>Não foi possível carregar mídias.</FieldError>}{library.data && <Pagination compact label="Paginação da mídia" page={page+1} pageSize={18} total={library.data.total} busy={library.isFetching} noun="vídeos" onPage={p=>setPage(p-1)}/>}<div className="flex gap-2"><Button onClick={()=>setPicking(false)}>Concluir seleção</Button></div></div>}
      {mode==='individual'?<VisualPreview value={value} media={samples[0] ?? media?.[0]} selected={selected} onSelect={setSelected} onElementChange={patch} disabled={locked} />:<div className="flex flex-col gap-2"><p className="text-xs text-dim">Simulação de grade com as mídias escolhidas. Não reproduz o recorte aplicado pelo Instagram.</p><div className="grid grid-cols-3 gap-px bg-line" data-testid="template-profile-grid">{Array.from({length:9},(_,i)=><div key={i} className="bg-panel p-1">{samples[i]?<VisualPreview value={value} media={samples[i]} disabled />:<div className="flex size-full min-h-24 flex-col items-center justify-center gap-2 p-2 text-center" style={{aspectRatio:`${layout.width}/${layout.height}`}}><span className="text-xs text-dim">Posição {i+1} sem mídia</span><Button size="sm" onClick={()=>setPicking(true)}>Selecionar mídia</Button></div>}</div>)}</div></div>}
      <p className="text-xs text-dim">Selecione no preview para mover e redimensionar; use os números para precisão. A composição é independente da interface do Instagram.</p>
    </div>
  </div>
}
