import type { ComponentProps } from 'react'
import { Button, Tooltip } from './ui'

export function ActionIcon({ label, ...props }: ComponentProps<typeof Button> & { label: string }) {
  return <Tooltip content={label}><span><Button {...props} aria-label={label} className={`action-icon ${props.className ?? ''}`} /></span></Tooltip>
}
