import type { Db } from './db/client'
export interface Ctx { db: Db; dataRoot: string; clock: () => Date; renderVisual?:import('@shared/visual-raster').RasterizeVisual; secret?(workspaceId: string, key: import('./services/integrations').SecretKey): string | null }
