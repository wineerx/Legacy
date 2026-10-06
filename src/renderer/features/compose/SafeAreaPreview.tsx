import type { ReactNode } from 'react'

export function SafeAreaPreview({ children }: { children: ReactNode }) {
  return (
    <div className="relative mx-auto w-full max-w-[260px] overflow-hidden rounded-card border border-line bg-black" style={{ aspectRatio: '9 / 16' }}>
      {children}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[12%] border-b border-dashed border-white/30 bg-white/5" />
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-[22%] border-t border-dashed border-white/30 bg-white/5" />
      <div aria-hidden className="pointer-events-none absolute bottom-[22%] right-0 top-[40%] w-[14%] border-l border-dashed border-white/30 bg-white/5" />
      <span className="absolute bottom-1 left-2 text-[11px] text-white/60">Áreas tracejadas ficam sob a interface do Reels/TikTok</span>
    </div>
  )
}
