import { and, eq, gte, sql, count, desc, asc } from 'drizzle-orm'
import { accessSync, constants } from 'node:fs'
import { jobs, jobAttempts, destinationAccounts, providerLimits } from '../db/schema'
import type { Ctx } from '../context'
import { workerHeartbeat, diagnosticEvents } from '../diagnostics'
import { pipelineConfig } from '../pipeline-config'
import { latencyPercentiles, type PipelineSnapshot } from '@shared/pipeline'

export function pipelineSnapshot(ctx: Ctx, ws: string, alive: boolean): PipelineSnapshot {
  const start=performance.now(),now=ctx.clock(),iso=now.toISOString(),hour=new Date(now.getTime()-3_600_000).toISOString()
  const rows=ctx.db.select({state:jobs.state,n:count()}).from(jobs).where(eq(jobs.workspaceId,ws)).groupBy(jobs.state).all()
  const n=(state:string)=>rows.find(r=>r.state===state)?.n??0
  const due=ctx.db.select({n:count(),oldest:sql<string|null>`min(${jobs.runAt})`}).from(jobs).where(and(eq(jobs.workspaceId,ws),eq(jobs.state,'queued'),sql`${jobs.runAt} <= ${iso}`)).get()!
  const oldest=ctx.db.select({id:jobs.id}).from(jobs).where(and(eq(jobs.workspaceId,ws),eq(jobs.state,'queued'),sql`${jobs.runAt} <= ${iso}`)).orderBy(asc(jobs.runAt)).limit(1).get()
  const throughput=ctx.db.select({hour:count(),minute:sql<number>`sum(case when ${jobs.updatedAt} >= ${new Date(now.getTime()-60000).toISOString()} then 1 else 0 end)`}).from(jobs).where(and(eq(jobs.workspaceId,ws),eq(jobs.state,'done'),gte(jobs.updatedAt,hour))).get()!
  const attempts=ctx.db.select({start:jobAttempts.startedAt,end:jobAttempts.finishedAt,outcome:jobAttempts.outcome,code:jobAttempts.errorCode}).from(jobAttempts).innerJoin(jobs,eq(jobs.id,jobAttempts.jobId)).where(and(eq(jobs.workspaceId,ws),gte(jobAttempts.startedAt,hour))).orderBy(desc(jobAttempts.startedAt)).limit(10000).all()
  const stalled=ctx.db.select({n:count()}).from(jobs).where(and(eq(jobs.workspaceId,ws),eq(jobs.state,'running'),sql`${jobs.leaseUntil} < ${iso}`)).get()!.n
  const dbLatencyMs=performance.now()-start,heartbeat=workerHeartbeat(),healthy=alive && !!heartbeat && now.getTime()-Date.parse(heartbeat)<10000
  const completed=ctx.db.select({start:sql<string>`min(${jobAttempts.startedAt})`,end:jobs.updatedAt}).from(jobs).innerJoin(jobAttempts,eq(jobAttempts.jobId,jobs.id)).where(and(eq(jobs.workspaceId,ws),eq(jobs.state,'done'),gte(jobs.updatedAt,hour))).groupBy(jobs.id).orderBy(desc(jobs.updatedAt)).limit(10000).all()
  const buckets:Record<string,number[]>={job_total:completed.map(a=>Date.parse(a.end)-Date.parse(a.start)),job_attempt:attempts.filter(a=>a.end).map(a=>Date.parse(a.end!)-Date.parse(a.start))}
  for(const e of diagnosticEvents(ws)) {
    if(e.duration===undefined)continue
    const key=e.source==='network'?'api_request':e.source==='media'?'ffmpeg':e.source==='publication'?`stage:${(e.metadata as {previousStage?:string})?.previousStage??'initial'}`:null
    if(key)(buckets[key]??=[]).push(e.duration)
  }
  const health:PipelineSnapshot['health']=[{component:'Database',state:dbLatencyMs>100?'Degraded':'Healthy',detail:`SQLite WAL; consulta ${dbLatencyMs.toFixed(1)} ms`,applicable:true},
    {component:'Redis',state:'Unavailable',detail:'Não utilizado nesta arquitetura desktop.',applicable:false},
    {component:'Queue',state:stalled||due.oldest && now.getTime()-Date.parse(due.oldest)>600000?'Degraded':'Healthy',detail:`${due.n} tarefas vencidas; ${stalled} leases vencidas`,applicable:true},
    ...['Media Worker','Publish Worker'].map(component=>({component,state:(healthy?'Healthy':'Unavailable') as 'Healthy'|'Unavailable',detail:'Slots no mesmo utility process; heartbeat compartilhado.',applicable:true})),
    {component:'TikTok',state:'Unavailable',detail:'Exportação manual; Direct Post não integrado.',applicable:false}]
  const connected=ctx.db.select({n:count()}).from(destinationAccounts).where(and(eq(destinationAccounts.workspaceId,ws),eq(destinationAccounts.provider,'instagram'),eq(destinationAccounts.state,'connected'))).get()!.n
  const cool=ctx.db.select({n:count()}).from(providerLimits).where(and(eq(providerLimits.workspaceId,ws),sql`${providerLimits.cooldownUntil} > ${iso}`)).get()!.n
  health.push({component:'Instagram',state:!connected?'Unavailable':cool?'Degraded':'Healthy',detail:!connected?'Nenhuma conta no registro; conexão legada pode exigir migração.':cool?'Cooldown ativo.':'Contas conectadas localmente; não substitui uma verificação remota.',applicable:true})
  try {accessSync(ctx.dataRoot,constants.W_OK);health.push({component:'Storage',state:'Healthy',detail:'Diretório acessível para escrita.',applicable:true})}catch{health.push({component:'Storage',state:'Unavailable',detail:'Diretório de dados indisponível.',applicable:true})}
  const memory=process.memoryUsage(),denominator=attempts.filter(a=>a.end && a.code!=='provider_pending').length
  return {queue:{depth:n('queued'),due:due.n,oldestJob:oldest?.id??null,lagMs:due.oldest?Math.max(0,now.getTime()-Date.parse(due.oldest)):0,jobsPerMinute:throughput.minute??0,jobsPerHour:throughput.hour,retryRate:denominator?attempts.filter(a=>a.outcome==='retry'&&a.code!=='provider_pending').length/denominator:0,failureRate:denominator?attempts.filter(a=>a.outcome==='failed').length/denominator:0,stalled,dlq:n('failed')},workers:{active:healthy?1:0,busy:n('running'),capacity:pipelineConfig.workerConcurrency,utilization:n('running')/pipelineConfig.workerConcurrency},resources:{rssBytes:memory.rss,heapUsedBytes:memory.heapUsed,dbLatencyMs,scope:'main process; não inclui worker nem filhos FFmpeg'},latencies:Object.fromEntries(Object.entries(buckets).map(([key,values])=>[key,{samples:values.length,ms:latencyPercentiles(values)}])),health}
}
