import type { ContainerVisualSnapshot } from '@shared/container-visual'
import type { VisualElement } from '@shared/visual-layout'

type Scene=Extract<ContainerVisualSnapshot,{version:2}>
export const elementLabels:Record<VisualElement['type'],string>={media:'Mídia',image:'Logo / avatar',text:'Texto',watermark:'Watermark',banner:'Banner'}
/** Editor-level warnings: the result is still valid, but the user should review it before scheduling. */
export function layoutWarnings(value:Scene):string[]{
  const {layout,context}=value,warnings:string[]=[]
  for(const e of layout.elements){
    if(e.visible && (e.x<0 || e.y<0 || e.x+e.width>layout.width || e.y+e.height>layout.height))warnings.push(`${elementLabels[e.type]} ${e.id} ultrapassa o canvas e será recortado.`)
    if(e.type!=='text')continue
    const missing=[...new Set([...e.text.matchAll(/\{\{\s*(profile_name|username|custom_text)\s*\}\}/g)].map(m=>m[1] as 'profile_name'|'username'|'custom_text'))].filter(k=>!context[k]?.trim())
    for(const key of missing)warnings.push(`Preencha ${key} em Textos dinâmicos antes de agendar.`)
  }
  return [...new Set(warnings)]
}
