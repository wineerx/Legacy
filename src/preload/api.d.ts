export interface LegacyBridge {
  invoke(channel: string, input: unknown): Promise<unknown>
  on(event: string, cb: (payload: unknown) => void): () => void
  pathForFile(file: File): string
  version: string
}
declare global { interface Window { legacy: LegacyBridge } }
