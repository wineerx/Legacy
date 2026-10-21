import { useRef, useState } from 'react'
import { MoreHorizontal, Trash2 } from 'lucide-react'
import type { ProfileDto } from '@shared/ipc-contract'
import { ProfileAvatar } from '../../components/ui/ProfileAvatar'
import { cx } from '../../components/ui'

/** A rightward swipe reveals an archive action; releasing never deletes data. */
export function ProfileListItem({ profile, active, disabled, onSelect, onArchive }: {
  profile: ProfileDto; active: boolean; disabled?: boolean; onSelect(): void; onArchive(): void
}) {
  const [offset, setOffset] = useState(0)
  const [dragging, setDragging] = useState(false)
  const gesture = useRef<{ x: number; y: number; offset: number; moved: boolean } | null>(null)
  const suppressClick = useRef(false)
  const transition = dragging ? 'transition-none' : 'transition-[transform,width,border-radius]'
  return <li className="group relative w-full min-w-0 max-w-full overflow-hidden rounded-ctl">
    <button type="button" aria-label={`Arquivar @${profile.username}`} disabled={disabled} aria-hidden={!offset}
      tabIndex={offset ? 0 : -1}
      style={{ width: offset }}
      className={cx('absolute inset-y-0 left-0 flex overflow-hidden items-center justify-center bg-danger text-white duration-200 ease-out motion-reduce:transition-none disabled:opacity-50', transition, !offset && 'invisible')}
      onClick={onArchive}><Trash2 size={17} aria-hidden /></button>
    <button type="button" aria-label={`@${profile.username}`} aria-current={active} disabled={disabled}
      className={cx('relative flex min-h-10 min-w-0 touch-pan-y select-none items-center gap-2 px-2.5 text-left text-sm duration-200 ease-out focus-visible:-outline-offset-2 motion-reduce:transition-none', transition,
        offset ? 'rounded-r-ctl rounded-l-none' : 'rounded-ctl pr-9',
        active ? 'bg-raised text-fg' : 'bg-app text-dim hover:text-fg')}
      style={{ transform: `translateX(${offset}px)`, width: `calc(100% - ${offset}px)` }}
      onPointerDown={e => {
        if (e.button !== 0 || disabled) return
        gesture.current = { x: e.clientX, y: e.clientY, offset, moved: false }
        suppressClick.current = false
      }}
      onPointerMove={e => {
        const start = gesture.current
        if (!start) return
        const dx = e.clientX - start.x
        if (!start.moved && Math.abs(e.clientY - start.y) > Math.abs(dx) && Math.abs(e.clientY - start.y) > 6) {
          gesture.current = null
          return
        }
        if (start.moved || Math.abs(dx) > 6) {
          start.moved = true
          suppressClick.current = true
          setDragging(true)
          e.currentTarget.setPointerCapture?.(e.pointerId)
          setOffset(Math.min(80, Math.max(0, start.offset + dx)))
        }
      }}
      onPointerUp={() => {
        if (gesture.current?.moved) setOffset(offset >= 32 ? 64 : 0)
        gesture.current = null
        setDragging(false)
      }}
      onPointerCancel={() => { gesture.current = null; setDragging(false); setOffset(0) }}
      onKeyDown={e => {
        if (e.key === 'Escape' || e.key === 'ArrowLeft') setOffset(0)
        if (e.key === 'ArrowRight') { e.preventDefault(); setOffset(64) }
      }}
      onClick={() => {
        if (suppressClick.current) { suppressClick.current = false; return }
        if (offset) setOffset(0)
        else onSelect()
      }}>
      <ProfileAvatar username={profile.username} path={profile.avatarPath} />
      <span className="min-w-0 flex-1 truncate">@{profile.username}</span>
    </button>
    {!offset && <button type="button" aria-label={`Opções de @${profile.username}`} title="Arraste para a direita ou clique para arquivar"
      disabled={disabled} onClick={() => setOffset(64)}
      className="absolute inset-y-1 right-1 flex w-7 items-center justify-center rounded-ctl text-dim opacity-0 hover:bg-panel hover:text-fg focus:opacity-100 group-hover:opacity-100">
      <MoreHorizontal size={16} aria-hidden />
    </button>}
  </li>
}
