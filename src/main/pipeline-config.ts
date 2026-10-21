/** Local resource limits, never a claim about provider quotas. Invalid overrides fail at startup. */
function integer(key: string, fallback: number, min = 1, max = 64) {
  const raw = process.env[key]
  const value = raw === undefined ? fallback : Number(raw)
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${key} deve estar entre ${min} e ${max}`)
  return value
}
export const pipelineConfig = {
  workerConcurrency: integer('LEGACY_WORKER_CONCURRENCY', 2),
  mediaConcurrency: integer('MEDIA_CONCURRENCY', 1),
  uploadConcurrency: integer('UPLOAD_CONCURRENCY', 2),
  providerConcurrency: integer('PUBLISH_CONCURRENCY', 2),
  accountConcurrency: integer('INSTAGRAM_ACCOUNT_CONCURRENCY', 1),
  maxRetries: integer('MAX_RETRIES', 24, 1, 100),
  leaseMs: integer('STALLED_TIMEOUT', 60_000, 3000, 3_600_000),
  jobTimeoutMs: integer('JOB_TIMEOUT', 600_000, 1000, 3_600_000),
  pollMs: integer('PROVIDER_POLL_MS', 15_000, 1, 300_000),
  confirmationTimeoutMs: integer('CONFIRMATION_TIMEOUT', 3_600_000, 1000, 86_400_000),
  cacheTtlMs: integer('PROCESSED_CACHE_TTL', 86_400_000, 1000, 604_800_000),
  circuitFailures: integer('PROVIDER_CIRCUIT_FAILURES', 5),
  circuitCooldownMs: integer('PROVIDER_CIRCUIT_COOLDOWN', 60_000, 1000, 3_600_000)
} as const

export class Semaphore {
  private active = 0
  private readonly waiters: (() => void)[] = []
  constructor(readonly capacity: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.capacity) await new Promise<void>(resolve => this.waiters.push(resolve))
    else this.active++
    try { return await fn() } finally {
      const next = this.waiters.shift()
      if (next) next(); else this.active--
    }
  }
}
