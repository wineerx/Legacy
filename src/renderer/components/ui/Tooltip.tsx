import * as T from '@radix-ui/react-tooltip'
import type { ReactNode } from 'react'

export function Tooltip({ content, children }: { content: string; children: ReactNode }) {
  return (
    <T.Provider delayDuration={300}>
      <T.Root>
        <T.Trigger asChild>{children}</T.Trigger>
        <T.Portal>
          <T.Content sideOffset={6} className="rounded-ctl border border-line bg-raised px-2 py-1 text-xs text-fg shadow-lg">{content}</T.Content>
        </T.Portal>
      </T.Root>
    </T.Provider>
  )
}
