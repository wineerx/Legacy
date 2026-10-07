import * as Avatar from '@radix-ui/react-avatar'
import { useState } from 'react'

export function profileInitials(name: string) {
  const words = name
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (!words.length) return 'LG'
  if (words.length > 1) return `${words[0][0]}${words.at(-1)![0]}`.toUpperCase()
  return (
    words[0][0] +
    (words[0].slice(1).match(/[^aeiouáéíóúãõâêô]/i)?.[0] ?? words[0][1] ?? '')
  ).toUpperCase()
}
const localAvatar = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#e5e5e5"/><g fill="none" stroke="#252525" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 58c0-12 8-19 17-19s17 7 17 19M22 22c0-9 20-9 20 0v10c0 13-20 13-20 0Z"/><path d="M21 24c-4-8 2-16 12-16 12 0 15 9 9 15-4-1-6-4-7-7-3 5-8 7-14 8" fill="#252525"/><path d="M28 29h1m7 0h1m-9 7q4 3 8 0M25 43l7 7 7-7M32 50v8"/></g></svg>')}`
export function UserAvatar({ name, photo }: { name: string; photo?: string }) {
  const [photoFailed, setPhotoFailed] = useState(false)
  const [fallbackFailed, setFallbackFailed] = useState(false)
  const safePhoto = photo?.match(/^data:image\/(png|jpeg|webp);base64,/)
    ? photo
    : undefined
  const source =
    safePhoto && !photoFailed
      ? safePhoto
      : fallbackFailed
        ? undefined
        : localAvatar
  return (
    <Avatar.Root className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-ctl bg-raised text-xs font-semibold">
      {source && (
        <Avatar.Image
          key={source}
          src={source}
          alt=""
          className="h-full w-full object-cover"
          onLoadingStatusChange={(status) => {
            if (status === 'error') {
              if (source === safePhoto) setPhotoFailed(true)
              else setFallbackFailed(true)
            }
          }}
        />
      )}
      <Avatar.Fallback>{profileInitials(name)}</Avatar.Fallback>
    </Avatar.Root>
  )
}
