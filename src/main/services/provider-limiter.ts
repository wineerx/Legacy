import { and, eq } from 'drizzle-orm'
import type { Ctx } from '../context'
import { providerLimits } from '../db/schema'
import { pipelineConfig } from '../pipeline-config'

export function retryAfterMs(value: string | string[] | undefined, now = Date.now()): number | undefined {
  if (typeof value !== 'string') return undefined
  const seconds=Number(value)
  const delay=Number.isFinite(seconds) ? seconds*1000 : Date.parse(value)-now
  return Number.isFinite(delay) ? Math.max(0,delay) : undefined
}
export function providerCooldown(ctx: Ctx, ws: string, accountId: string, operation: string, error: { status: number; apiCode: number; retryAfterMs?: number }) {
  // Meta app-wide throttling codes versus user/account limits; HTTP 429 without scope is account scoped.
  const scope=[4,613].includes(error.apiCode) ? '' : accountId
  const key={workspaceId:ws,provider:'instagram',accountId:scope,operation}
  const where=and(eq(providerLimits.workspaceId,ws),eq(providerLimits.provider,'instagram'),eq(providerLimits.accountId,scope),eq(providerLimits.operation,operation))
  ctx.db.transaction(tx => {
    const previous=tx.select().from(providerLimits).where(where).get()
    const failures=(previous?.failures??0)+1
    const delay=Math.max(error.retryAfterMs??0,Math.min(600_000,1000*2**Math.min(failures,9))+Math.floor(Math.random()*1000),failures>=pipelineConfig.circuitFailures?pipelineConfig.circuitCooldownMs:0)
    const cooldownUntil=new Date(Math.max(previous?Date.parse(previous.cooldownUntil):0,ctx.clock().getTime()+delay)).toISOString()
    tx.insert(providerLimits).values({...key,failures,cooldownUntil}).onConflictDoUpdate({target:[providerLimits.workspaceId,providerLimits.provider,providerLimits.accountId,providerLimits.operation],set:{failures,cooldownUntil}}).run()
  },{behavior:'immediate'})
}
export function providerSucceeded(ctx: Ctx, ws: string, accountId: string, operation: string) {
  // Success on account A must not clear a provider-wide or account B cooldown.
  ctx.db.delete(providerLimits).where(and(eq(providerLimits.workspaceId,ws),eq(providerLimits.provider,'instagram'),eq(providerLimits.accountId,accountId),eq(providerLimits.operation,operation))).run()
}
