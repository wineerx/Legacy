import { useEffect, useRef, useSyncExternalStore } from 'react'

let windowVisible = true

function subscribe(listener: () => void) {
  const unsubscribe = window.legacy?.on('app.visibility', payload => {
    windowVisible = (payload as { visible?: boolean })?.visible !== false
    listener()
  })
  const media = window.matchMedia?.('(prefers-reduced-motion: reduce)')
  document.addEventListener('visibilitychange', listener)
  media?.addEventListener('change', listener)
  return () => { unsubscribe?.(); document.removeEventListener('visibilitychange', listener); media?.removeEventListener('change', listener) }
}
const snapshot = () => windowVisible && document.visibilityState !== 'hidden' && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
export function useMascotMotion(interactive: boolean, enabled: boolean) {
  const allowed = useSyncExternalStore(subscribe, snapshot, () => false) && enabled
  const ref = useRef<SVGSVGElement>(null)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver(([entry]) => { element.dataset.visible = String(entry.isIntersecting) }) : null
    observer?.observe(element)
    return () => observer?.disconnect()
  }, [])
  useEffect(() => {
    const element = ref.current
    if (!element) return
    let frame = 0
    let lastX = 0, lastY = 0
    const light = element.querySelector('radialGradient[id$="-body"]')
    const reset = () => { element.style.setProperty('--look-x', '0'); element.style.setProperty('--look-y', '0'); light?.setAttribute('cx', '32%') }
    reset()
    if (!interactive || !allowed) return
    const draw = () => {
      frame = 0
      if (element.dataset.visible === 'false') return
      const rect = element.getBoundingClientRect()
      const dx = lastX - rect.left - rect.width / 2, dy = lastY - rect.top - rect.height / 2
      if (Math.abs(dx) > rect.width / 2 + 100 || Math.abs(dy) > rect.height / 2 + 100) { reset(); return }
      const x = Math.max(-1, Math.min(1, dx / (rect.width / 2 + 60)))
      element.style.setProperty('--look-x', String(x))
      element.style.setProperty('--look-y', String(Math.max(-1, Math.min(1, dy / (rect.height / 2 + 60)))))
      light?.setAttribute('cx', `${32 + x * 4}%`)
    }
    const move = (event: PointerEvent) => { lastX = event.clientX; lastY = event.clientY; if (!frame) frame = requestAnimationFrame(draw) }
    window.addEventListener('pointermove', move, { passive: true })
    window.addEventListener('blur', reset)
    document.documentElement.addEventListener('pointerleave', reset)
    return () => { cancelAnimationFrame(frame); window.removeEventListener('pointermove', move); window.removeEventListener('blur', reset); document.documentElement.removeEventListener('pointerleave', reset); reset() }
  }, [interactive, allowed])
  return { ref, allowed }
}
