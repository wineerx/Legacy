import '@fontsource-variable/inter'
import '@fontsource-variable/roboto'
import '@fontsource-variable/noto-serif'
import { fitRect, type VisualElement, type VisualLayout } from '@shared/visual-layout'
import type { VisualRaster } from '@shared/visual-raster'
import { wrapText } from '@shared/visual-text'

const fonts={Inter:'Inter Variable',Roboto:'Roboto Variable','Noto Serif':'Noto Serif Variable'}
const images=new Map<string,Promise<HTMLImageElement>>()
function image(data:string){let pending=images.get(data);if(!pending){pending=new Promise<HTMLImageElement>((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=()=>reject(new Error('Imagem PNG ilegível.'));im.src=data});if(images.size>=64)images.clear();images.set(data,pending)}return pending}
const canvas=(w:number,h:number)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c}
function box(ctx:CanvasRenderingContext2D,e:VisualElement){ctx.beginPath();ctx.roundRect(e.x,e.y,e.width,e.height,Math.min(e.radius,e.width/2,e.height/2))}
export function textLines(ctx:CanvasRenderingContext2D,text:string,width:number){
  return wrapText(text,width,v=>ctx.measureText(v).width)
}
export async function paintElement(ctx:CanvasRenderingContext2D,e:VisualElement,media?:CanvasImageSource,timeMs=0):Promise<boolean>{
  if(!e.visible || (e.type==='banner' && (timeMs<e.startMs || timeMs>e.endMs)))return false
  ctx.save();ctx.globalAlpha=e.opacity/100;box(ctx,e);ctx.clip();let overflow=false
  if(e.type==='text'){
    ctx.font=`${e.weight} ${e.fontSize}px "${fonts[e.font]}"`;ctx.fillStyle=e.color;ctx.textAlign=e.align;ctx.textBaseline='top'
    const lines=textLines(ctx,e.text,Math.max(1,e.width-2*e.padding));overflow=lines.length*e.fontSize*e.lineHeight>e.height-2*e.padding
    const x=e.x+(e.align==='center'?e.width/2:e.align==='right'?e.width-e.padding:e.padding)
    lines.forEach((line,i)=>ctx.fillText(line,x,e.y+e.padding+i*e.fontSize*e.lineHeight))
  }else if(e.type==='media'){
    const src=e.imageData?await image(e.imageData):media
    if(src){const v=src as HTMLVideoElement & HTMLImageElement;const r=fitRect(v.videoWidth || v.naturalWidth || v.width,v.videoHeight || v.naturalHeight || v.height,e);ctx.drawImage(src,r.x,r.y,r.width,r.height)}
  }else if(e.imageData)ctx.drawImage(await image(e.imageData),e.x,e.y,e.width,e.height)
  ctx.restore();if(e.borderWidth){ctx.save();ctx.globalAlpha=e.opacity/100;box(ctx,e);ctx.strokeStyle=e.borderColor;ctx.lineWidth=e.borderWidth;ctx.stroke();ctx.restore()}return overflow
}
export async function paintScene(c:HTMLCanvasElement,layout:VisualLayout,media?:CanvasImageSource,timeMs=0){
  await document.fonts.ready;await Promise.all(Object.values(fonts).map(f=>document.fonts.load(`700 48px "${f}"`)));c.width=layout.width;c.height=layout.height;const ctx=c.getContext('2d')!;ctx.fillStyle=layout.background;ctx.fillRect(0,0,c.width,c.height)
  const warnings:string[]=[];for(const e of layout.elements)if(await paintElement(ctx,e,media,timeMs))warnings.push(`Texto ${e.id} excede a área. Aumente a altura.`);return warnings
}
/** Same paintElement and fonts as the interactive preview. No video tools are used here. */
export async function rasterize(layout:VisualLayout):Promise<VisualRaster>{
  await document.fonts.ready
  // Explicit loads prevent font fallback on the first hidden render.
  await Promise.all(Object.values(fonts).map(f=>document.fonts.load(`700 48px "${f}"`)))
  const back=canvas(layout.width,layout.height),ctx=back.getContext('2d')!;ctx.fillStyle=layout.background;ctx.fillRect(0,0,back.width,back.height)
  const result:VisualRaster={background:back.toDataURL('image/png'),layers:[]}
  for(const e of layout.elements){
    if(!e.visible)continue
    if(e.type==='media' && !e.imageData){
      const mask=canvas(Math.round(e.width),Math.round(e.height)),mc=mask.getContext('2d')!;mc.fillStyle='#000000';mc.fillRect(0,0,mask.width,mask.height);mc.fillStyle='#ffffff';box(mc,{...e,x:0,y:0,opacity:100});mc.fill();result.mask=mask.toDataURL('image/png')
      if(e.borderWidth){const border=canvas(layout.width,layout.height),bc=border.getContext('2d')!;box(bc,e);bc.globalAlpha=e.opacity/100;bc.strokeStyle=e.borderColor;bc.lineWidth=e.borderWidth;bc.stroke();result.mediaBorder=border.toDataURL('image/png')}continue
    }
    const layer=canvas(layout.width,layout.height);await paintElement(layer.getContext('2d')!,e,undefined,e.type==='banner'?e.startMs:0);result.layers.push({id:e.id,png:layer.toDataURL('image/png')})
  }return result
}
