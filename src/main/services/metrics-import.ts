import { eq } from 'drizzle-orm'
import { AppError } from '@shared/errors'
import { normalizeInstagramUrl } from '@shared/instagram-url'
import type { Ctx } from '../context'
import { type Db, newId } from '../db/client'
import { metricSnapshots, remotePosts } from '../db/schema'
import { getProfile } from '../repos/profiles'
import { findByPermalink } from '../repos/remote-posts'
import { parseCsv } from './csv'

export interface MetricsImportReport { upserted: number; rows: { line: number; permalink?: string; error?: string }[] }

type RawRow = Record<string, unknown>
const METRICS = ['views', 'likes', 'comments'] as const
const eqId = (id: string) => eq(remotePosts.id, id)

function toNumber(v: unknown, field: string): number | null {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v)
  const cleaned = String(v).trim().replace(/[.,\s]/g, '')
  if (!/^\d+$/.test(cleaned)) throw new Error(`Valor inválido em ${field}: ${String(v)}`)
  return Number(cleaned)
}

function rowsFrom(text: string, format: 'csv' | 'json'): { line: number; data: RawRow }[] {
  if (format === 'json') {
    let parsed: unknown
    try { parsed = JSON.parse(text) } catch { throw new AppError('invalid_input', 'JSON inválido.') }
    if (!Array.isArray(parsed)) throw new AppError('invalid_input', 'O JSON precisa ser uma lista de objetos.')
    if (parsed.length && !parsed.every((o) => o && typeof o === 'object' && 'permalink' in o)) {
      throw new AppError('invalid_input', 'Cada item precisa da chave permalink.')
    }
    return parsed.map((data, i) => ({ line: i + 1, data: data as RawRow }))
  }
  const [header, ...body] = parseCsv(text)
  const cols = (header ?? []).map((h) => h.trim().toLowerCase())
  if (!cols.includes('permalink')) throw new AppError('invalid_input', 'O CSV precisa da coluna permalink.')
  return body.map((cells, i) => ({ line: i + 2, data: Object.fromEntries(cols.map((c, j) => [c, cells[j] ?? ''])) }))
}

export function importMetrics(ctx: Ctx, workspaceId: string, profileId: string, text: string, format: 'csv' | 'json'): MetricsImportReport {
  if (!getProfile(ctx.db, workspaceId, profileId)) throw new AppError('not_found', 'Perfil não encontrado.')
  const report: MetricsImportReport = { upserted: 0, rows: [] }
  const now = ctx.clock().toISOString()
  for (const { line, data } of rowsFrom(text, format)) {
    try {
      const ref = normalizeInstagramUrl(String(data.permalink ?? ''))
      if (ref.kind === 'profile') throw new Error('permalink precisa ser de um reel ou post')
      const present = METRICS.filter((m) => Object.hasOwn(data, m))
      const values = Object.fromEntries(present.map((m) => [m, toNumber(data[m], m)])) as Partial<Record<(typeof METRICS)[number], number | null>>
      const durationS = toNumber(data.duration_s, 'duration_s')
      const postedAt = data.posted_at ? new Date(String(data.posted_at)) : null
      if (postedAt && Number.isNaN(postedAt.getTime())) throw new Error('posted_at inválido')
      ctx.db.transaction((tx) => {
        const existing = findByPermalink(tx as unknown as Db, workspaceId, ref.url)
        const id = existing?.id ?? newId()
        const fields = {
          ...values, metricsSource: 'csv' as const, metricsUpdatedAt: now,
          caption: data.caption ? String(data.caption) : existing?.caption ?? null,
          postedAt: postedAt?.toISOString() ?? existing?.postedAt ?? null,
          durationMs: durationS !== null ? durationS * 1000 : existing?.durationMs ?? null
        }
        if (existing) tx.update(remotePosts).set(fields).where(eqId(id)).run()
        else tx.insert(remotePosts).values({ id, workspaceId, profileId, permalink: ref.url, mediaProductType: ref.kind === 'reel' ? 'REELS' : null, ...fields }).run()
        for (const m of present) {
          tx.insert(metricSnapshots).values({ id: newId(), workspaceId, remotePostId: id, metric: m, value: values[m] ?? null, source: 'csv', capturedAt: now }).run()
        }
      }, { behavior: 'immediate' })
      report.upserted++
      report.rows.push({ line, permalink: ref.url })
    } catch (e) {
      report.rows.push({ line, error: e instanceof Error ? e.message : String(e) })
    }
  }
  return report
}
