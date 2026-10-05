import type { Db } from './db/client'
export interface Ctx { db: Db; dataRoot: string; clock: () => Date; secret?(workspaceId: string, key: 'apifyToken' | 'webhookSecret' | 'instagramToken'): string | null }
