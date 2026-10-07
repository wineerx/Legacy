import * as ToggleGroup from '@radix-ui/react-toggle-group'
import { Clapperboard, Grid2X2, Layers, UserRoundCheck } from 'lucide-react'
import { Tooltip, cx } from '../../components/ui'
import type { ProfileContentSource } from '@shared/ipc-contract'

const options = [
  { value: 'posts', label: 'Posts', icon: Grid2X2 },
  { value: 'reels', label: 'Reels', icon: Clapperboard },
  { value: 'tagged', label: 'Marcados', icon: UserRoundCheck },
  { value: 'all', label: 'Todos', icon: Layers }
] as const

export function ContentSourcePicker({ value, onChange, label, fullWidth = false }: { value: ProfileContentSource; onChange(value: ProfileContentSource): void; label: string; fullWidth?: boolean }) {
  return <ToggleGroup.Root type="single" value={value} onValueChange={source => { if (source) onChange(source as ProfileContentSource) }} aria-label={label} className={cx('inline-flex overflow-hidden rounded-ctl border border-line bg-panel', fullWidth ? 'w-full' : 'w-fit')}>
    {options.map(({ value: source, label: name, icon: Icon }) => <Tooltip key={source} content={name}>
      <ToggleGroup.Item value={source} aria-label={name}
        className={cx('flex h-8 items-center justify-center border-r border-line transition-colors last:border-r-0', fullWidth ? 'min-w-0 flex-1' : 'w-9', value === source ? 'bg-fg text-app' : 'text-dim hover:bg-raised hover:text-fg')}>
        <Icon size={16} aria-hidden="true"/>
      </ToggleGroup.Item>
    </Tooltip>)}
  </ToggleGroup.Root>
}
