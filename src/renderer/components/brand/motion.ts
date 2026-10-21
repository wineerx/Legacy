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
      // Follow the cursor anywhere in the window: direction from the angle, reach eases in over ~240px.
      const reach = Math.max(Math.hypot(dx, dy), 240)
      const x = dx / reach
      element.style.setProperty('--look-x', x.toFixed(3))
      element.style.setProperty('--look-y', (dy / reach).toFixed(3))
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
