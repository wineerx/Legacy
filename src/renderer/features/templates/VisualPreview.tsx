import { useEffect,useRef,useState } from 'react'
import type { GridItem } from '@shared/types'
import { resolveLayout,type VisualElement } from '@shared/visual-layout'
import { pngDimensions,watermarkGeometry,type ContainerVisualSnapshot,type VisualPreviewOverrides } from '@shared/container-visual'
import { paintScene } from '../../lib/visual-render'
import { mediaUrl } from '../../lib/api'
import { Button,Input } from '../../components/ui'
import { FieldError } from '../../components/ui/Field'
export function VisualPreview({value,media,selected,onSelect,onElementChange,disabled,overrides}:{value:Extract<ContainerVisualSnapshot,{version:2}>;media?:GridItem;selected?:string;onSelect?(id:string):void;onElementChange?(id:string,patch:Partial<VisualElement>):void;disabled?:boolean;overrides?:VisualPreviewOverrides}){
  const canvas=useRef<HTMLCanvasElement>(null),video=useRef<HTMLVideoElement>(null),root=useRef<HTMLDivElement>(null)
  const [tick,setTick]=useState(0),[error,setError]=useState(''),[warnings,setWarnings]=useState<string[]>([]),[time,setTime]=useState(0)
  const drag=useRef<{id:string;resize:boolean;x:number;y:number;element:VisualElement;scale:number}|null>(null)
  const src=overrides?.sourcePath ?? media?.filePath
  useEffect(()=>{let alive=true;const render=async()=>{
    if(!canvas.current)return
    try{
      let input:CanvasImageSource|undefined=video.current?.readyState && video.current.readyState>=2?video.current:undefined
      if(input){
        const v=video.current!,c=document.createElement('canvas');c.width=v.videoWidth;c.height=v.videoHeight;const ctx=c.getContext('2d')!;ctx.drawImage(input,0,0)
        const cover=overrides?.coverPath ?? (value.cover?.enabled?value.cover.imageData:null)
        const banner=overrides?.banner ?? (value.banner?.enabled?{path:value.banner.imageData!,startMs:value.banner.startMs,endMs:value.banner.endMs,firstFrame:false}:null)
        const img=async(path:string)=>{const im=new Image();await new Promise<void>((res,rej)=>{im.onload=()=>res();im.onerror=rej;im.src=path.startsWith('data:')?path:mediaUrl(path)});return im}
        if(cover && !overrides?.sourcePath && time<33){const im=await img(cover),scale=Math.max(c.width/im.width,c.height/im.height);ctx.drawImage(im,(c.width-im.width*scale)/2,(c.height-im.height*scale)/2,im.width*scale,im.height*scale)}
        else if(banner && (banner.firstFrame && time===0 || time>=banner.startMs && time<=banner.endMs))ctx.drawImage(await img(banner.path),0,0,c.width,c.height)
        const wm=overrides?.watermark ?? value.watermark
        if(wm?.enabled && wm.imageData){const im=await img(wm.imageData),r=watermarkGeometry(c.width,c.height,pngDimensions(wm.imageData),wm);ctx.globalAlpha=wm.opacityPct/100;ctx.drawImage(im,r.x,r.y,r.width,r.height)}input=c
      }
      const result=await paintScene(canvas.current,resolveLayout(value.layout,{...value.context,caption:media?.caption ?? value.context.caption}),input,time)
      if(alive){setWarnings(result);setError('')}
    }catch(e){if(alive)setError(String(e))}
  };void render();return()=>{alive=false}},[value,media,tick,time,overrides])
  useEffect(()=>{const v=video.current;if(!v)return;let id=0;const frame=()=>{setTick(n=>n+1);setTime(v.currentTime*1000);id=v.requestVideoFrameCallback(frame)};id=v.requestVideoFrameCallback(frame);return()=>v.cancelVideoFrameCallback(id)},[src])
  const begin=(e:React.PointerEvent,id:string,resize=false)=>{if(disabled)return;e.preventDefault();e.stopPropagation();onSelect?.(id);const element=value.layout.elements.find(v=>v.id===id)!;drag.current={id,resize,x:e.clientX,y:e.clientY,element,scale:value.layout.width/(root.current?.getBoundingClientRect().width || 1)};e.currentTarget.setPointerCapture(e.pointerId)}
  return <div className="flex flex-col gap-2">
    <div ref={root} className="relative mx-auto w-full max-w-96" style={{aspectRatio:`${value.layout.width}/${value.layout.height}`}} data-testid="visual-scene-preview">
      <canvas ref={canvas} className="block size-full" aria-label="Composição do Template" />
      {onSelect && value.layout.elements.filter(e=>e.visible).map(e=><div key={e.id} role="button" tabIndex={disabled?-1:0} aria-label={`Selecionar ${e.type} ${e.id}`} onClick={()=>onSelect(e.id)} onPointerDown={event=>begin(event,e.id)} onPointerMove={event=>{const d=drag.current;if(!d)return;const dx=(event.clientX-d.x)*d.scale,dy=(event.clientY-d.y)*d.scale;onElementChange?.(d.id,d.resize?{width:Math.max(1,Math.min(4320,Math.round(d.element.width+dx))),height:Math.max(1,Math.min(4320,Math.round(d.element.height+dy)))}:{x:Math.max(-2160,Math.min(4320,Math.round(d.element.x+dx))),y:Math.max(-2160,Math.min(4320,Math.round(d.element.y+dy)))})}} onPointerUp={()=>{drag.current=null}} onPointerCancel={()=>{drag.current=null}} onKeyDown={event=>{if(disabled)return;const offsets:Record<string,[number,number]>={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};const step=offsets[event.key];if(step){event.preventDefault();onElementChange?.(e.id,{x:e.x+step[0]*(event.shiftKey?10:1),y:e.y+step[1]*(event.shiftKey?10:1)})}}} className={selected===e.id?'absolute touch-none border-2 border-fg outline outline-1 outline-app':'absolute touch-none'} style={{left:`${e.x/value.layout.width*100}%`,top:`${e.y/value.layout.height*100}%`,width:`${e.width/value.layout.width*100}%`,height:`${e.height/value.layout.height*100}%`}}>
        {selected===e.id && !disabled && <button type="button" aria-label={`Redimensionar ${e.id}`} onPointerDown={event=>begin(event,e.id,true)} className="absolute -right-1 -bottom-1 size-3 border border-line bg-fg" />}
      </div>)}
    </div>
    {src && <><video key={src} ref={video} src={mediaUrl(src)} preload="auto" muted playsInline className="hidden" onLoadedData={()=>setTick(n=>n+1)} onSeeked={()=>setTick(n=>n+1)} onError={()=>setError('Mídia indisponível para a prévia.')} /><div className="flex items-end gap-2"><Button size="sm" onClick={()=>{const v=video.current;if(v?.paused)void v.play();else v?.pause()}}>Reproduzir / pausar</Button><Input label="Quadro da prévia (s)" type="number" min={0} max={(media?.durationMs ?? 60000)/1000} step={0.1} value={time/1000} onChange={e=>{const t=Number(e.target.value);setTime(t*1000);if(video.current)video.current.currentTime=t}} /></div></>}
    {warnings.map(w=><p key={w} role="status" className="text-xs text-warning-fg">{w}</p>)}{error && <FieldError>{error}</FieldError>}
  </div>
}
