import { useEffect, useRef, useSyncExternalStore } from 'react'
import { BotEngine, type BotEmoteName, type BotStateName } from './mochi/engine'
import type { MascotState } from './LegacyMascot'

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

const emotes: Partial<Record<MascotState, BotEmoteName>> = { love: 'love', surprised: 'surprised', proud: 'proud', wink: 'wink' }
function botState(state: MascotState): BotStateName {
  if (state === 'rate_limit') return 'ratelimit'
  if (state === 'greeting' || state === 'dancing' || state === 'love' || state === 'surprised' || state === 'proud' || state === 'wink') return 'idle'
  return state
}
/** Room above the body, in body heights, for hearts, stars and z's to float into. */
export const PARTICLE_ROOM = 0.45
const canDraw = () => typeof Path2D !== 'undefined'

export function useMascotMotion(state: MascotState, size: number, interactive: boolean, enabled: boolean) {
  const allowed = useSyncExternalStore(subscribe, snapshot, () => false) && enabled
  const ref = useRef<HTMLSpanElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const engine = useRef<BotEngine | null>(null)
  const wake = useRef<() => void>(() => {})
  const repaint = useRef<() => void>(() => {})
  const current = useRef(state)
  current.current = state

  useEffect(() => {
    const element = ref.current
    const target = canvas.current
    const context = canDraw() ? target?.getContext('2d') : null
    if (!element || !target || !context) return
    const bot = engine.current ??= new BotEngine()
    const room = size * PARTICLE_ROOM
    const dpr = Math.max(1, window.devicePixelRatio || 1)
    target.width = Math.round(size * dpr)
    target.height = Math.round((size + room) * dpr)
    let frame = 0, idle: ReturnType<typeof setTimeout> | undefined, last = performance.now()
    const paint = () => {
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
      context.clearRect(0, 0, size, size + room)
      context.translate(0, room)
      context.save()
      bot.applyDance(context, size, size)
      bot.draw(context, size, size)
      context.restore()
    }
    const tick = (time: number) => {
      frame = 0
      bot.update(Math.min(0.1, (time - last) / 1000))
      last = time
      paint()
      if (!allowed || element.dataset.visible === 'false') return
      if (bot.busy) frame = requestAnimationFrame(tick)
      else idle = setTimeout(start, bot.nextBlinkIn * 1000)
    }
    const start = () => { clearTimeout(idle); if (!frame) { last = performance.now(); frame = requestAnimationFrame(tick) } }
    wake.current = allowed ? start : () => {}
    repaint.current = paint
    if (allowed) start()
    else { bot.settle(); paint() }
    const observer = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver(([entry]) => {
      element.dataset.visible = String(entry.isIntersecting)
      if (entry.isIntersecting) wake.current()
    }) : null
    observer?.observe(element)
    return () => { cancelAnimationFrame(frame); clearTimeout(idle); observer?.disconnect(); wake.current = () => {}; repaint.current = () => {} }
  }, [size, allowed])

  useEffect(() => {
    const bot = engine.current
    if (!bot) return
    const emote = emotes[state] ?? (state === 'greeting' && !allowed ? 'happy' : null)
    bot.setState(botState(state))
    bot.setEmote(emote, allowed)
    bot.isDancing = state === 'dancing' && allowed
    if (state === 'greeting' && allowed) bot.greet()
    if (!allowed) {
      bot.settle()
      if (state === 'dancing') bot.setEmote('happy', false)
    }
    if (allowed) wake.current()
    else repaint.current()
  }, [state, allowed])

  useEffect(() => () => engine.current?.dispose(), [])

  useEffect(() => {
    const element = ref.current
    const bot = engine.current
    if (!element || !bot) return
    const look = (x: number, y: number) => {
      bot.lookX = x; bot.lookY = y
      element.style.setProperty('--look-x', x.toFixed(3))
      element.style.setProperty('--look-y', y.toFixed(3))
      wake.current()
    }
    const reset = () => look(0, 0)
    reset()
    if (!interactive || !allowed) return
    let back: ReturnType<typeof setTimeout> | undefined
    bot.onDizzy = () => {
      bot.setState('dizzy')
      back = setTimeout(() => { bot.setState(botState(current.current)); wake.current() }, 2400)
    }
    const move = (event: PointerEvent) => {
      if (element.dataset.visible === 'false') return
      const rect = element.getBoundingClientRect()
      // Mochi's gaze: tanh of the distance to the body, y up.
      look(Math.tanh((event.clientX - rect.left - rect.width / 2) / 260), -Math.tanh((event.clientY - rect.top - rect.height / 2) / 200))
    }
    const poke = () => { bot.slap(); wake.current() }
    window.addEventListener('pointermove', move, { passive: true })
    window.addEventListener('blur', reset)
    document.documentElement.addEventListener('pointerleave', reset)
    element.addEventListener('pointerdown', poke)
    return () => {
      clearTimeout(back); bot.onDizzy = null
      window.removeEventListener('pointermove', move); window.removeEventListener('blur', reset)
      document.documentElement.removeEventListener('pointerleave', reset); element.removeEventListener('pointerdown', poke); reset()
    }
  }, [interactive, allowed])

  return { ref, canvas, allowed }
}
