import * as Avatar from '@radix-ui/react-avatar'
import { mediaUrl } from '../../lib/api'
export function ProfileAvatar({
  username,
  path
}: {
  username: string
  path?: string | null
}) {
  return (
    <Avatar.Root className="inline-flex size-5 shrink-0 overflow-hidden rounded-full bg-raised align-middle">
      <Avatar.Image
        src={path ? mediaUrl(path) : undefined}
        alt=""
        className="size-full object-cover"
      />
      <Avatar.Fallback className="grid size-full place-items-center text-[10px] font-medium">
        {username
          .replace(/[^a-z0-9]/gi, '')
          .slice(0, 2)
          .toUpperCase() || 'P'}
      </Avatar.Fallback>
    </Avatar.Root>
  )
}
