import { rasterize } from './lib/visual-render'
import { visualLayout } from '@shared/visual-layout'
Object.assign(window,{renderVisual:(input:unknown)=>rasterize(visualLayout.parse(input))})
