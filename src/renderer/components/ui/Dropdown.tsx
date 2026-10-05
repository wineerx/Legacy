import * as Popover from '@radix-ui/react-popover'
import type { ReactNode } from 'react'
export function Dropdown({trigger,children}:{trigger:ReactNode;children:ReactNode}) {return <Popover.Root><Popover.Trigger asChild>{trigger}</Popover.Trigger><Popover.Portal><Popover.Content align="end" sideOffset={6} className="ds-dropdown">{children}</Popover.Content></Popover.Portal></Popover.Root>}
export const DropdownClose=Popover.Close
