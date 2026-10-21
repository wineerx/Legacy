export interface Percentiles { p50:number; p90:number; p95:number; p99:number; max:number }
export function latencyPercentiles(values: number[]): Percentiles {
  const v=[...values].sort((a,b)=>a-b)
  const p=(n:number)=>v[Math.max(0,Math.ceil(v.length*n)-1)]??0
  return {p50:p(.5),p90:p(.9),p95:p(.95),p99:p(.99),max:p(1)}
}
export interface PipelineSnapshot {
  queue: {depth:number;due:number;oldestJob:string|null;lagMs:number;jobsPerMinute:number;jobsPerHour:number;retryRate:number;failureRate:number;stalled:number;dlq:number}
  workers: {active:number;busy:number;utilization:number;capacity:number}
  resources: {rssBytes:number;heapUsedBytes:number;dbLatencyMs:number;scope:string}
  latencies: Record<string,{samples:number;ms:Percentiles}>
  health: {component:string;state:'Healthy'|'Degraded'|'Unavailable';detail:string;applicable:boolean}[]
}
