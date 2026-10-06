export interface ExposedMedia { url: string; release(): Promise<void> }
// Swappable hosting: R2 signed URLs or a broker can implement this later.
export interface MediaHost {
  id: 'cloudflare-quick-tunnel'
  expose(input: { jobId: string; filePath: string }): Promise<ExposedMedia>
}
