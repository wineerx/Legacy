import { eq } from 'drizzle-orm'
import type { Ctx } from '../context'
import { jobs, jobAttempts } from '../db/schema'
import { ownedJob, type LeasedJob } from '../queue/queue'

export function holdContainerJob(ctx: Ctx, job: LeasedJob, control: 'paused' | 'cancelled') {
  return ctx.db.transaction(tx => {
    const changed = tx.update(jobs).set({ state: control==='cancelled' ? 'cancelled' : 'queued',
      runAt: new Date(ctx.clock().getTime()+60000).toISOString(), leaseUntil:null,
      attempts: Math.max(0,job.attempts-1), updatedAt:ctx.clock().toISOString() }).where(ownedJob(tx,job,ctx.clock())).run().changes
    if (changed) tx.update(jobAttempts).set({ finishedAt:ctx.clock().toISOString(), outcome:'retry',errorCode:'container_held',errorMessage:control }).where(eq(jobAttempts.id,job.attemptId)).run()
    return changed>0
  }, { behavior:'immediate' })
}
