import * as T from '@radix-ui/react-tabs'
import * as S from '@radix-ui/react-scroll-area'
import * as SeparatorPrimitive from '@radix-ui/react-separator'
import { forwardRef, type ComponentProps } from 'react'
import { cx } from './cx'
export const Tabs = T.Root
export const TabsList = (props: ComponentProps<typeof T.List>) => (
  <T.List {...props} className={cx('diagnostic-tabs', props.className)} />
)
export const TabsTrigger = (props: ComponentProps<typeof T.Trigger>) => (
  <T.Trigger {...props} className={cx('diagnostic-tab', props.className)} />
)
export const TabsContent = T.Content
export const Separator = () => (
  <SeparatorPrimitive.Root className="diagnostic-separator" />
)
export const ScrollArea = forwardRef<
  HTMLDivElement,
  ComponentProps<typeof S.Viewport>
>(function ScrollArea({ children, ...props }, ref) {
  return (
    <S.Root className="diagnostic-scroll">
      <S.Viewport {...props} ref={ref} className="size-full">
        {children}
      </S.Viewport>
      <S.Scrollbar orientation="vertical" className="diagnostic-scrollbar">
        <S.Thumb className="diagnostic-thumb" />
      </S.Scrollbar>
    </S.Root>
  )
})
