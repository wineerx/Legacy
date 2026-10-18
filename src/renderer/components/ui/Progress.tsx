import * as Primitive from '@radix-ui/react-progress'
export function Progress({ value, label }: { value: number; label: string }) {
  const percent = Math.max(0, Math.min(100, value))
  return (
    <Primitive.Root
      value={percent}
      aria-label={label}
      className="h-1.5 w-full overflow-hidden rounded-full bg-raised"
    >
      <Primitive.Indicator
        className="h-full w-full bg-fg transition-transform"
        style={{ transform: `translateX(-${100 - percent}%)` }}
      />
    </Primitive.Root>
  )
}
