import type { VisualElement, VisualLayout } from './visual-layout'
export interface VisualRaster { background: string; layers: { id:string; png:string }[]; mask?:string; mediaBorder?:string }
export type RasterizeVisual = (layout:VisualLayout)=>Promise<VisualRaster>
export const mediaElement = (layout:VisualLayout) => layout.elements.find((e):e is Extract<VisualElement,{type:'media'}>=>e.type==='media' && e.visible)
