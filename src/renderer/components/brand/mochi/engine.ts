// Mochi, the Coucou character by Louis Raillé, drawn with Canvas 2D.
// Ported from Coucou's windows/src/mochi/engine.ts (MIT code; the character is used
// with the author's written permission, see docs/decisions/0005-mochi-avatar.md).
// Same constants, tweens, easings and particles. Not ported: outfits, sounds,
// mini bots and the mailbox morph, which Legacy does not use.

export type EyeShape =
  | 'pill' | 'wide' | 'dot' | 'line' | 'flat' | 'happy' | 'closed'
  | 'spiral' | 'heart' | 'star' | 'tired' | 'wink'
export type BadgeKind = 'dots' | 'bang' | 'question' | 'dot'
export type RGB = readonly [number, number, number]
export type Badge = { kind: BadgeKind; color: RGB }
export type BotStateName =
  | 'idle' | 'working' | 'thinking' | 'searching' | 'approval' | 'question' | 'error'
  | 'finished' | 'ratelimit' | 'sleeping' | 'dizzy'
  | 'publishing' | 'downloading' | 'upload' | 'waiting' | 'warning' | 'offline' | 'notification'
export type BotEmoteName = 'love' | 'surprised' | 'proud' | 'wink' | 'yawn' | 'happy' | 'annoyed'

type EaseFn = (t: number) => number
type TweenKey = readonly [target: number, durationMs: number, ease: EaseFn]
type PropKey = 'pitch' | 'roll' | 'tilt' | 'open' | 'sx' | 'sy' | 'oy' | 'ox' | 'hands' | 'blush' | 'es' | 'badgeS'
type Tween = { keys: TweenKey[]; index: number; from: number; startMs: number; onComplete?: () => void }
type StateCfg = {
  color: RGB; tint: number; eye: EyeShape; badge: Badge | null
  bounces: boolean; scans: boolean; breathes: boolean; zz: boolean; sweat: boolean
  look: readonly [number, number] | null; tilt: number
}
type Particle = { type: 'heart' | 'star' | 'spark' | 'sweat' | 'z'; x: number; y: number; vx: number; vy: number; age: number; life: number; rot: number; size: number }

const Ease = {
  out: (t: number) => 1 - Math.pow(1 - t, 3),
  inOut: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  back: (t: number) => 1 + 2.7 * Math.pow(t - 1, 3) + 1.7 * Math.pow(t - 1, 2),
  lin: (t: number) => t,
}
const lerp = (a: number, b: number, t: number) => a + (b - a) * t

const EYE_W = 0.25
const EYE_H = 0.27
const EYE_SP = 0.37
const EYE_P = -0.12
const BASE_TOP: RGB = [0.929, 0.929, 0.937] // #EDEDEF
const BASE_BOTTOM: RGB = [0.769, 0.773, 0.792] // #C4C5CA
const INK = 'rgb(26,20,18)' // #1A1412

const C = {
  idle: [0.902, 0.914, 0.933] as RGB,
  working: [0.231, 0.62, 1] as RGB,
  thinking: [0.545, 0.361, 0.965] as RGB,
  searching: [0.388, 0.396, 0.949] as RGB,
  approval: [0.961, 0.647, 0.141] as RGB,
  question: [0.133, 0.827, 0.933] as RGB,
  error: [0.957, 0.314, 0.369] as RGB,
  finished: [0.204, 0.831, 0.6] as RGB,
  ratelimit: [0.984, 0.573, 0.235] as RGB,
  sleeping: [0.58, 0.635, 0.722] as RGB,
  dizzy: [0.957, 0.447, 0.714] as RGB,
}
const base = { bounces: false, scans: false, breathes: false, zz: false, sweat: false, look: null, tilt: 0 }

export const BOT_STATES: Record<BotStateName, StateCfg> = {
  idle: { ...base, color: C.idle, tint: 0, eye: 'pill', badge: null },
  working: { ...base, color: C.working, tint: 0.72, eye: 'pill', badge: { kind: 'dots', color: C.working } },
  thinking: { ...base, color: C.thinking, tint: 0.72, eye: 'pill', badge: { kind: 'dots', color: C.thinking }, look: [0.55, 0.55] },
  searching: { ...base, color: C.searching, tint: 0.72, eye: 'pill', badge: { kind: 'dots', color: C.searching }, scans: true },
  approval: { ...base, color: C.approval, tint: 0.78, eye: 'wide', badge: { kind: 'bang', color: C.approval }, bounces: true },
  question: { ...base, color: C.question, tint: 0.75, eye: 'pill', badge: { kind: 'question', color: C.question }, tilt: 0.17 },
  error: { ...base, color: C.error, tint: 0.78, eye: 'flat', badge: { kind: 'dot', color: C.error } },
  finished: { ...base, color: C.finished, tint: 0.35, eye: 'happy', badge: { kind: 'dot', color: C.finished } },
  ratelimit: { ...base, color: C.ratelimit, tint: 0.72, eye: 'tired', badge: { kind: 'dot', color: C.ratelimit }, sweat: true },
  sleeping: { ...base, color: C.sleeping, tint: 0.32, eye: 'closed', badge: null, breathes: true, zz: true },
  dizzy: { ...base, color: C.dizzy, tint: 0.7, eye: 'spiral', badge: null },
  // Legacy states, composed from Mochi's own colours and eyes.
  publishing: { ...base, color: C.working, tint: 0.72, eye: 'pill', badge: { kind: 'dots', color: C.working } },
  downloading: { ...base, color: C.searching, tint: 0.72, eye: 'pill', badge: { kind: 'dots', color: C.searching }, look: [0, -0.5] },
  upload: { ...base, color: C.working, tint: 0.72, eye: 'pill', badge: { kind: 'dots', color: C.working }, look: [0, 0.6] },
  waiting: { ...base, color: C.sleeping, tint: 0.4, eye: 'pill', badge: { kind: 'dot', color: C.approval } },
  warning: { ...base, color: C.approval, tint: 0.72, eye: 'wide', badge: { kind: 'bang', color: C.approval } },
  offline: { ...base, color: C.sleeping, tint: 0.6, eye: 'flat', badge: { kind: 'dot', color: C.sleeping } },
  notification: { ...base, color: C.question, tint: 0.5, eye: 'wide', badge: { kind: 'dot', color: C.question } },
}

const EMOTE_EYE: Record<BotEmoteName, EyeShape> = {
  love: 'heart', surprised: 'dot', proud: 'star', wink: 'wink', yawn: 'tired', happy: 'happy', annoyed: 'line',
}

const now = () => performance.now() / 1000
const rgba = (c: RGB, a = 1) => `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${a})`
const mix3 = (a: RGB, b: RGB, t: number): RGB => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]
const FONT = 'system-ui, "Segoe UI Variable Text", "Segoe UI", sans-serif'

function roundRectPath(x: CanvasRenderingContext2D, X: number, Y: number, W: number, H: number, R: number) {
  const r = Math.max(0, Math.min(R, W / 2, H / 2))
  x.beginPath()
  x.moveTo(X + r, Y)
  x.arcTo(X + W, Y, X + W, Y + H, r)
  x.arcTo(X + W, Y + H, X, Y + H, r)
  x.arcTo(X, Y + H, X, Y, r)
  x.arcTo(X, Y, X + W, Y, r)
  x.closePath()
}
function heartPath(x: CanvasRenderingContext2D, s: number) {
  x.beginPath()
  x.moveTo(0, s * 0.38)
  x.bezierCurveTo(-s * 1.05, -s * 0.15, -s * 0.5, -s * 0.95, 0, -s * 0.38)
  x.bezierCurveTo(s * 0.5, -s * 0.95, s * 1.05, -s * 0.15, 0, s * 0.38)
  x.closePath()
}
function starPath(x: CanvasRenderingContext2D, ro: number, ri: number) {
  x.beginPath()
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? ri : ro
    const a = -Math.PI / 2 + (i * Math.PI) / 5
    x.lineTo(Math.cos(a) * r, Math.sin(a) * r)
  }
  x.closePath()
}

/** The 112-BPM dance: sway, hop, tilt and a squash on landing. */
function danceTransform(seconds: number, level: number, R: number) {
  const beat = (seconds * 112) / 60
  const hop = Math.abs(Math.sin(Math.PI * beat))
  const land = Math.pow(1 - hop, 6)
  return { dx: 0.08 * R * Math.sin(Math.PI * beat) * level, dy: -0.2 * R * hop * level, rotate: 0.1 * Math.sin(Math.PI * beat) * level, sx: 1 + 0.045 * land * level, sy: 1 - 0.06 * land * level }
}

export class BotEngine {
  yaw = 0; pitch = 0; roll = 0; tilt = 0; open = 1
  sx = 1; sy = 1; oy = 0; ox = 0
  tint = 0; hands = 0; blush = 0; es = 1; badgeS = 0
  tgYaw = 0; tgPitch = 0; tgTilt = 0; tgSy = 1; tgSx = 1; tgEs = 1
  isDancing = false
  dancingLevel = 0
  col: RGB = C.idle
  colT: RGB = C.idle
  state: BotStateName = 'idle'
  cfg: StateCfg = BOT_STATES.idle
  eyeOverride: EyeShape | null = null
  eyeOverrideUntil = 0
  permanentEye: EyeShape | null = null
  badge: Badge | null = null
  lookX = 0
  lookY = 0
  waveUntil = 0
  waveStart = 0
  /** Fired when three pokes land inside 1.7 s (→ dizzy). */
  onDizzy: (() => void) | null = null

  private badgeKey = 'none'
  private badgeToken = 0
  private tweens = new Map<PropKey, Tween>()
  private particles: Particle[] = []
  private timers = new Set<ReturnType<typeof setTimeout>>()
  private t0 = now() - Math.random() * 5
  private nextBlink = now() + 1.5 + Math.random() * 2
  private greetToken = 0
  private lastAmbient = 0
  private slapTimes: number[] = []

  private later(ms: number, fn: () => void) {
    const id = setTimeout(() => { this.timers.delete(id); fn() }, ms)
    this.timers.add(id)
  }
  dispose() { this.timers.forEach(clearTimeout); this.timers.clear() }

  setState(next: BotStateName, force = false) {
    if (this.state === next && !force) return
    const prev = this.state
    this.state = next
    this.cfg = BOT_STATES[next]
    this.colT = this.cfg.color
    this.tint = this.cfg.tint
    this.setBadge(this.cfg.badge)
    switch (next) {
      case 'finished':
        this.doRoll(950, 1)
        this.later(500, () => this.emit('spark', 5))
        break
      case 'error':
        this.anim('ox', [[0.08, 50, Ease.out], [-0.08, 70, Ease.inOut], [0.05, 70, Ease.inOut], [0, 90, Ease.out]])
        break
      case 'approval':
        this.anim('oy', [[-0.2, 150, Ease.out], [0, 300, Ease.back]])
        break
      case 'dizzy':
        this.doRoll(1300, 2)
        break
      case 'question':
        this.blink()
        break
      case 'ratelimit':
        this.emit('sweat', 1)
        break
      default:
        if (prev !== 'idle' || next !== 'idle') this.blink()
    }
  }

  /** Jumps to the resting pose of the current state: used for still drawings. */
  settle() {
    this.tweens.clear()
    this.particles = []
    this.badgeToken++
    this.badge = this.cfg.badge
    this.badgeKey = this.badge ? `${this.badge.kind}-${this.badge.color.join(',')}` : 'none'
    this.badgeS = this.badge ? 1 : 0
    this.col = this.colT
    this.roll = 0; this.ox = 0; this.oy = 0; this.open = 1; this.sx = 1; this.sy = 1; this.es = 1
    this.update(0)
    this.yaw = this.tgYaw; this.pitch = this.tgPitch; this.tilt = this.tgTilt
  }

  setBadge(b: Badge | null) {
    const key = b ? `${b.kind}-${b.color.join(',')}` : 'none'
    if (key === this.badgeKey) return
    this.badgeKey = key
    const token = ++this.badgeToken
    this.anim('badgeS', [[0, 90, Ease.inOut]])
    this.later(100, () => {
      if (token !== this.badgeToken) return
      this.badge = b
      if (b) this.anim('badgeS', [[1, 280, Ease.back]])
    })
  }

  blink() {
    if (this.tweens.has('open')) return
    this.anim('open', [[0.06, 70, Ease.inOut], [1, 130, Ease.out]])
  }

  squash() {
    this.anim('sy', [[0.78, 70, Ease.out], [1.1, 130, Ease.out], [1, 170, Ease.inOut]])
    this.anim('sx', [[1.16, 70, Ease.out], [0.95, 130, Ease.out], [1, 170, Ease.inOut]])
  }

  /** A poke: squash and an annoyed look; three in a row make Mochi dizzy. */
  slap() {
    this.interruptGreet()
    if (this.state === 'dizzy') return
    const t = now()
    this.slapTimes = this.slapTimes.filter(s => t - s < 1.7)
    this.slapTimes.push(t)
    this.squash()
    if (this.slapTimes.length >= 3) {
      this.slapTimes = []
      this.onDizzy?.()
    } else {
      this.eyeOverride = 'line'
      this.eyeOverrideUntil = t + 0.8
    }
  }

  doRoll(durationMs: number, turns: number) {
    this.roll = 0
    this.anim('roll', [[Math.PI * 2 * turns, durationMs, Ease.inOut]], () => { this.roll = 0 })
  }

  /** The "coucou" wave. */
  greet() {
    const t = now()
    const token = ++this.greetToken
    this.waveStart = t + 0.45
    this.waveUntil = t + 1.55
    this.eyeOverride = 'happy'
    this.eyeOverrideUntil = t + 2.0
    this.anim('oy', [[-0.06, 220, Ease.out], [0, 220, Ease.back]])
    this.later(250, () => {
      if (this.greetToken !== token) return
      this.anim('hands', [[1, 280, Ease.out]])
      this.anim('sy', [[0.95, 100, Ease.out], [1, 260, Ease.back]])
      this.anim('sx', [[1.04, 100, Ease.out], [1, 260, Ease.back]])
    })
    this.later(550, () => { if (this.greetToken === token) this.blink() })
    this.later(1500, () => { if (this.greetToken === token) this.blink() })
    this.later(1550, () => {
      if (this.greetToken !== token) return
      this.waveUntil = 0
      this.anim('hands', [[0, 200, Ease.inOut]])
    })
  }

  interruptGreet() {
    if (this.hands <= 0.01 && now() >= this.waveUntil) return
    this.greetToken++
    this.waveUntil = 0
    this.waveStart = 0
    this.anim('hands', [[0, 150, Ease.inOut]])
  }

  /** Holds an emote's eyes until cleared; `animated` also plays its entrance. */
  setEmote(emote: BotEmoteName | null, animated = true) {
    this.permanentEye = emote ? EMOTE_EYE[emote] : null
    if (emote && animated) this.triggerEmote(emote)
    else { this.eyeOverride = this.permanentEye; this.eyeOverrideUntil = this.permanentEye ? Number.POSITIVE_INFINITY : 0 }
    if (emote === 'love' || emote === 'proud') this.blush = Math.max(this.blush, emote === 'love' ? 1 : 0.7)
  }

  triggerEmote(emote: BotEmoteName, duration = 1.8) {
    const t = now()
    this.eyeOverride = EMOTE_EYE[emote]
    this.eyeOverrideUntil = t + duration
    switch (emote) {
      case 'love':
        this.anim('blush', [[1, 300, Ease.out]])
        this.emit('heart', 4)
        this.anim('oy', [[-0.1, 160, Ease.out], [0, 300, Ease.back]])
        break
      case 'surprised':
        this.anim('oy', [[-0.3, 140, Ease.out], [0, 380, Ease.back]])
        this.anim('es', [[1.25, 120, Ease.out], [1, 500, Ease.inOut]])
        break
      case 'proud':
        this.emit('star', 5)
        this.anim('tilt', [[-0.14, 220, Ease.out], [-0.14, (duration - 0.5) * 1000, Ease.lin], [0, 280, Ease.inOut]])
        this.anim('blush', [[0.7, 250, Ease.out]])
        break
      case 'wink':
        this.anim('tilt', [[0.12, 160, Ease.out], [0.12, (duration - 0.4) * 1000, Ease.lin], [0, 240, Ease.inOut]])
        break
      case 'yawn':
        this.anim('sy', [[1.12, 500, Ease.inOut], [1, 500, Ease.inOut]])
        this.anim('sx', [[0.94, 500, Ease.inOut], [1, 500, Ease.inOut]])
        this.later(700, () => { this.eyeOverride = 'closed'; this.emit('z', 2) })
        break
      case 'happy':
        this.anim('blush', [[0.6, 200, Ease.out], [0, 600, Ease.inOut]])
        break
      case 'annoyed':
        this.eyeOverrideUntil = t + 0.8
        break
    }
  }

  emit(type: Particle['type'], count: number) {
    for (let i = 0; i < count; i++) {
      const isZ = type === 'z'
      this.particles.push({
        type,
        x: (Math.random() - 0.5) * 0.9 + (isZ ? 0.55 : 0),
        y: -0.7 - Math.random() * 0.2,
        vx: (Math.random() - 0.5) * 0.35 + (isZ ? 0.18 : 0),
        vy: -(0.45 + Math.random() * 0.35),
        age: -i * 0.14,
        life: 1.3 + Math.random() * 0.5,
        rot: Math.random() * Math.PI * 2,
        size: 0.15 + Math.random() * 0.08,
      })
    }
  }

  /** True while anything still moves, so the caller can stop its frame loop. */
  get busy(): boolean {
    return this.tweens.size > 0 || this.particles.length > 0 || this.timers.size > 0 ||
      this.cfg.bounces || this.cfg.scans || this.cfg.breathes || this.cfg.zz || this.cfg.sweat ||
      this.state === 'dizzy' || this.isDancing || this.dancingLevel > 0.001 ||
      this.eyeOverride === 'spiral' || this.eyeOverride === 'star' ||
      (this.eyeOverride !== null && this.eyeOverrideUntil !== Number.POSITIVE_INFINITY) ||
      Math.abs(this.tgYaw - this.yaw) > 0.002 || Math.abs(this.tgPitch - this.pitch) > 0.002 ||
      Math.abs(this.tgTilt - this.tilt) > 0.002 || Math.abs(this.tgSy - this.sy) > 0.002 ||
      Math.abs(this.tgSx - this.sx) > 0.002 || Math.abs(this.tgEs - this.es) > 0.002 ||
      Math.abs(this.col[0] - this.colT[0]) > 0.003 || Math.abs(this.col[1] - this.colT[1]) > 0.003 || Math.abs(this.col[2] - this.colT[2]) > 0.003
  }

  /** Seconds until the next idle blink, so an idle loop can sleep until then. */
  get nextBlinkIn(): number { return Math.max(0, this.nextBlink - now()) }

  anim(prop: PropKey, keys: TweenKey[], onComplete?: () => void) {
    this.tweens.set(prop, { keys, index: 0, from: this[prop], startMs: performance.now(), onComplete })
  }

  update(dt: number) {
    const n = now()
    const nowMs = performance.now()
    for (const [prop, tw] of [...this.tweens]) {
      const k = tw.keys[tw.index]
      const p = Math.min(1, Math.max(0, (nowMs - tw.startMs) / k[1]))
      this[prop] = tw.from + (k[0] - tw.from) * k[2](p)
      if (p >= 1) {
        tw.from = k[0]
        tw.index += 1
        tw.startMs = nowMs
        if (tw.index >= tw.keys.length) { this.tweens.delete(prop); tw.onComplete?.() }
      }
    }

    const t = n - this.t0
    let ty = this.lookX * 0.62
    let tp = this.lookY * 0.5
    if (this.cfg.look) { ty = ty * 0.35 + this.cfg.look[0] * 0.55; tp = tp * 0.3 + this.cfg.look[1] * 0.5 }
    if (this.cfg.scans) { ty = Math.sin(t * 2.6) * 0.6; tp = -0.06 }
    if (this.state === 'sleeping') { ty = 0; tp = -0.14 }
    if (this.state === 'dizzy') ty = Math.sin(t * 9) * 0.25
    this.tgYaw = ty
    this.tgPitch = tp
    this.tgTilt = this.cfg.tilt
    if (n > this.waveStart && n < this.waveUntil) this.tgTilt = -0.06 + Math.sin(2 * Math.PI * 1.2 * (n - this.waveStart)) * 0.07

    const bounce = this.cfg.bounces ? -Math.abs(Math.sin(t * 5.2)) * 0.07 : 0
    const kGen = 1 - Math.pow(0.0008, dt)
    if (!this.tweens.has('oy')) this.oy += (bounce - this.oy) * kGen
    if (this.cfg.breathes) {
      this.tgSy = 1 + Math.sin(t * 1.8) * 0.035
      this.tgSx = 1 - Math.sin(t * 1.8) * 0.035 * 0.57
    } else { this.tgSy = 1; this.tgSx = 1 }

    const kLook = 1 - Math.pow(0.0025, dt)
    this.yaw += (this.tgYaw - this.yaw) * kLook
    if (!this.tweens.has('pitch')) this.pitch += (this.tgPitch - this.pitch) * kLook
    if (!this.tweens.has('tilt')) this.tilt += (this.tgTilt - this.tilt) * kGen
    if (!this.tweens.has('sy')) this.sy += (this.tgSy - this.sy) * kGen
    if (!this.tweens.has('sx')) this.sx += (this.tgSx - this.sx) * kGen
    if (!this.tweens.has('es')) this.es += (this.tgEs - this.es) * kGen
    this.col = mix3(this.col, this.colT, 1 - Math.pow(0.002, dt))

    if (n > this.nextBlink) {
      if (this.state !== 'sleeping' && this.state !== 'dizzy') {
        this.blink()
        if (Math.random() < 0.22) this.later(230, () => this.blink())
      }
      this.nextBlink = n + 2.2 + Math.random() * 3.2
    }
    if (this.eyeOverride && n > this.eyeOverrideUntil) {
      this.eyeOverride = this.permanentEye
      if (this.permanentEye) this.eyeOverrideUntil = Number.POSITIVE_INFINITY
    }
    if (dt > 0 && n - this.lastAmbient > 1.3) {
      this.lastAmbient = n
      if (this.cfg.zz) this.emit('z', 1)
      if (this.cfg.sweat && Math.random() < 0.5) this.emit('sweat', 1)
    }
    for (const p of this.particles) p.age += dt
    this.particles = this.particles.filter(p => p.age < p.life)
    const target = this.isDancing ? 1 : 0
    this.dancingLevel = this.dancingLevel < target ? Math.min(target, this.dancingLevel + dt / 0.3) : Math.max(target, this.dancingLevel - dt / 0.5)
  }

  /** Dance bounce around the bottom of the body; call before draw() on a saved context. */
  applyDance(x: CanvasRenderingContext2D, W: number, H: number) {
    if (this.dancingLevel <= 0.001) return
    const R = W * 0.3
    const px = W / 2 + this.ox * R
    const py = H / 2 + this.oy * R + R * 0.06 + R * 0.88
    const d = danceTransform(now(), this.dancingLevel, R)
    x.translate(px + d.dx, py + d.dy)
    x.rotate(d.rotate)
    x.scale(d.sx, d.sy)
    x.translate(-px, -py)
  }

  /** Draws hands, body, blush, eyes, badge and particles into a W×H box. */
  draw(x: CanvasRenderingContext2D, W: number, H: number) {
    const R = W * 0.3
    const rx = R * 1.14
    const ry = R * 0.88
    const cx = W / 2 + this.ox * R
    const cy = H / 2 + this.oy * R + R * 0.06

    this.drawHandsBehind(x, R, rx, ry, cx, cy)
    x.save()
    x.translate(cx, cy)
    if (this.tilt !== 0) x.rotate(this.tilt)
    x.scale(this.sx, this.sy)
    const body = this.bodyPath(rx, ry)
    this.drawBody(x, body, R, rx, ry)
    const blushVal = Math.max(this.blush, this.tint * 0.5)
    if (blushVal > 0.01) {
      x.save()
      x.clip(body)
      const yOffset = Math.sin(this.yaw) * rx * 0.8
      x.fillStyle = `rgba(255,120,150,${0.5 * blushVal})`
      for (const sd of [-1, 1]) {
        x.beginPath()
        x.ellipse(sd * rx * 0.55 + yOffset, ry * 0.2, R * 0.17, R * 0.1, 0, 0, Math.PI * 2)
        x.fill()
      }
      x.restore()
    }
    this.drawEyes(x, body, R, rx, ry)
    x.restore()
    if (this.badge && this.badgeS > 0.01) this.drawBadge(x, this.badge, R, cx, cy)
    this.drawParticles(x, R, cx, cy)
  }

  private bodyPath(rx: number, ry: number): Path2D {
    const n = 72
    const expN = 2.0 / 2.7
    const p = new Path2D()
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2
      const ca = Math.cos(a)
      const sa = Math.sin(a)
      const px = rx * (ca >= 0 ? Math.pow(ca, expN) : -Math.pow(-ca, expN))
      const py = ry * (sa >= 0 ? Math.pow(sa, expN) : -Math.pow(-sa, expN))
      if (i === 0) p.moveTo(px, py)
      else p.lineTo(px, py)
    }
    p.closePath()
    return p
  }

  private drawBody(x: CanvasRenderingContext2D, body: Path2D, R: number, rx: number, ry: number) {
    const g = x.createLinearGradient(rx * 0.7, -ry * 0.85, -rx * 0.8, ry * 0.9)
    g.addColorStop(0, rgba(BASE_TOP))
    g.addColorStop(1, rgba(BASE_BOTTOM))
    x.fillStyle = g
    if (this.tint > 0.01) {
      // The coloured glow around the body, as in the design captures.
      x.save()
      x.shadowColor = rgba(this.col, 0.55 * this.tint)
      x.shadowBlur = R * 0.55 * x.getTransform().a
      x.fill(body)
      x.restore()
    }
    x.fill(body)
    if (this.tint > 0.01) {
      const tg = x.createLinearGradient(0, ry, 0, -ry)
      tg.addColorStop(0, rgba(this.col, 0.72 * this.tint))
      tg.addColorStop(1, rgba(this.col, 0))
      x.fillStyle = tg
      x.fill(body)
    }
    const sh = x.createRadialGradient(0, 0, R * 0.15, 0, 0, R * 1.25)
    sh.addColorStop(0, 'rgba(0,0,0,0)')
    sh.addColorStop(0.6, 'rgba(0,0,0,0)')
    sh.addColorStop(1, 'rgba(0,0,0,0.2)')
    x.fillStyle = sh
    x.fill(body)
    const hl = x.createRadialGradient(rx * 0.34, -ry * 0.46, 0, rx * 0.34, -ry * 0.46, R * 0.42)
    hl.addColorStop(0, 'rgba(255,255,255,0.55)')
    hl.addColorStop(1, 'rgba(255,255,255,0)')
    x.fillStyle = hl
    x.fill(body)
  }

  private drawEyes(x: CanvasRenderingContext2D, body: Path2D, R: number, rx: number, ry: number) {
    let shape: EyeShape = this.eyeOverride ?? this.cfg.eye
    if (this.isDancing && this.dancingLevel > 0.15 && (this.state === 'idle' || this.state === 'finished')) shape = 'happy'
    x.save()
    x.clip(body)
    x.fillStyle = INK
    x.strokeStyle = INK
    for (const sd of [-1, 1]) {
      const eyeYaw = sd * EYE_SP + this.yaw
      let eyePitch = EYE_P + this.pitch + this.roll
      eyePitch = (((eyePitch + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) - Math.PI
      const cp = Math.cos(eyePitch)
      if (Math.cos(eyeYaw) * cp <= 0.04) continue
      const ex = Math.sin(eyeYaw) * cp * rx
      const ey = -Math.sin(eyePitch) * ry
      const fx = Math.max(0.18, Math.cos(eyeYaw))
      const fy = Math.max(0.18, cp)
      x.save()
      x.translate(ex, ey)
      x.scale(fx, fy)
      this.drawEyeShape(x, shape, R * EYE_W * this.es, R * EYE_H * this.es, sd)
      x.restore()
    }
    x.restore()
  }

  private drawEyeShape(x: CanvasRenderingContext2D, shape: EyeShape, w: number, h: number, sd: number): void {
    const t = now()
    const pill = () => {
      const hh = Math.max(h * this.open, w * 0.3)
      roundRectPath(x, -w / 2, -hh / 2, w, hh, Math.min(w / 2, hh / 2))
      x.fill()
    }
    const arc = () => {
      x.lineWidth = w * 0.5
      x.lineCap = 'round'
      x.beginPath()
      x.arc(0, h * 0.18, w * 0.82, Math.PI * 1.12, Math.PI * 1.88)
      x.stroke()
    }
    switch (shape) {
      case 'wide': return this.drawEyeShape(x, 'pill', w * 1.16, h * 1.12, sd)
      case 'pill': return pill()
      case 'dot':
        x.beginPath(); x.arc(0, 0, w * 0.45, 0, Math.PI * 2); x.fill()
        return
      case 'line':
        x.rotate(-sd * 0.2)
        roundRectPath(x, -w * 0.78, -w * 0.21, w * 1.56, w * 0.42, w * 0.21); x.fill()
        return
      case 'flat':
        roundRectPath(x, -w * 0.72, -w * 0.2, w * 1.44, w * 0.4, w * 0.2); x.fill()
        return
      case 'happy': return arc()
      case 'closed':
        x.lineWidth = w * 0.36
        x.lineCap = 'round'
        x.beginPath(); x.arc(0, -h * 0.08, w * 0.78, Math.PI * 0.15, Math.PI * 0.85); x.stroke()
        return
      case 'spiral': {
        x.lineWidth = w * 0.22
        x.lineCap = 'round'
        x.beginPath()
        for (let a = 0; a < 4.4 * Math.PI; a += 0.2) {
          const r = w * 0.06 + a * w * 0.058
          const aa = a + t * 9 * sd
          if (a === 0) x.moveTo(Math.cos(aa) * r, Math.sin(aa) * r)
          else x.lineTo(Math.cos(aa) * r, Math.sin(aa) * r)
        }
        x.stroke()
        return
      }
      case 'heart':
        x.fillStyle = '#FF4D6D'; heartPath(x, w * 1.2); x.fill(); x.fillStyle = INK
        return
      case 'star':
        x.fillStyle = '#F7B32B'; x.rotate(t * 1.5 * sd); starPath(x, w * 1.05, w * 0.46); x.fill(); x.fillStyle = INK
        return
      case 'tired':
        roundRectPath(x, -w / 2, -h * 0.02, w, h * 0.38, w / 2); x.fill()
        roundRectPath(x, -w * 0.62, -h * 0.1, w * 1.24, w * 0.22, w * 0.11); x.fill()
        return
      case 'wink':
        return sd < 0 ? pill() : arc()
    }
  }

  /** Hands sit behind the body and only show while greeting. */
  private drawHandsBehind(x: CanvasRenderingContext2D, R: number, rx: number, ry: number, cx: number, cy: number) {
    if (this.hands <= 0.01 || R <= 14) return
    const n = now()
    const bodyH = 2 * ry
    const hew = 0.3 * ry * this.hands
    const heh = 0.26 * ry * this.hands
    const hwB = rx * this.sx
    const hhB = ry * this.sy
    const isWaving = n >= this.waveStart && this.waveStart > 0 && n < this.waveUntil
    for (const sd of [-1, 1]) {
      let localX = sd * hwB * 1.08
      let localY = hhB * 0.7
      let handRot = 0
      if (sd > 0 && isWaving) {
        const wt = n - this.waveStart
        const rise = 1 - Math.pow(1 - Math.min(1, wt / 0.18), 3)
        localX = lerp(hwB * 1.08, hwB * 1.1 + Math.cos(13 * wt) * 0.06 * bodyH, rise)
        localY = lerp(hhB * 0.7, -hhB * 0.15 - Math.sin(13 * wt) * 0.14 * bodyH, rise)
        handRot = (-0.5 + Math.sin(13 * wt) * 0.35) * rise
      } else if (sd < 0 && isWaving) {
        localY += Math.sin(6 * (n - this.waveStart)) * 0.04 * bodyH
      }
      const cosT = Math.cos(this.tilt)
      const sinT = Math.sin(this.tilt)
      x.save()
      x.translate(cx + cosT * localX - sinT * localY, cy + sinT * localX + cosT * localY)
      if (handRot !== 0) x.rotate(handRot)
      const g = x.createLinearGradient(hew * 0.7, -heh * 0.85, -hew * 0.8, heh * 0.9)
      g.addColorStop(0, rgba(BASE_TOP))
      g.addColorStop(1, rgba(BASE_BOTTOM))
      x.beginPath()
      x.ellipse(0, 0, hew, heh, 0, 0, Math.PI * 2)
      x.fillStyle = g
      x.fill()
      x.strokeStyle = 'rgba(0,0,0,0.08)'
      x.lineWidth = 1
      x.stroke()
      x.restore()
    }
  }

  private drawBadge(x: CanvasRenderingContext2D, badge: Badge, R: number, cx: number, cy: number) {
    const t = now()
    const col = rgba(badge.color)
    x.save()
    x.translate(cx - R * 0.72 * this.sx, cy - R * 0.72 * this.sy)
    x.scale(this.badgeS, this.badgeS)
    if (badge.kind === 'dots') {
      const pw = R * 0.72
      const ph = R * 0.36
      const rim = R * 0.07
      roundRectPath(x, -pw / 2 - rim, -ph / 2 - rim, pw + rim * 2, ph + rim * 2, ph / 2 + rim)
      x.fillStyle = '#000'
      x.fill()
      roundRectPath(x, -pw / 2, -ph / 2, pw, ph, ph / 2)
      x.fillStyle = col
      x.fill()
      for (let i = 0; i < 3; i++) {
        const phase = (((t * 2.4 - i * 0.22) % 1) + 1) % 1
        x.fillStyle = '#fff'
        x.beginPath()
        x.arc((i - 1) * R * 0.18, 0, R * 0.055 * (1 + 0.4 * Math.max(0, Math.sin(phase * Math.PI * 2))), 0, Math.PI * 2)
        x.fill()
      }
    } else if (badge.kind === 'bang' || badge.kind === 'question') {
      x.fillStyle = '#000'
      x.beginPath(); x.arc(0, 0, R * 0.3, 0, Math.PI * 2); x.fill()
      x.fillStyle = col
      x.beginPath(); x.arc(0, 0, R * 0.23, 0, Math.PI * 2); x.fill()
      x.fillStyle = '#fff'
      x.font = `900 ${R * 0.32}px ${FONT}`
      x.textAlign = 'center'
      x.textBaseline = 'middle'
      x.fillText(badge.kind === 'bang' ? '!' : '?', 0, R * 0.02)
    } else {
      x.fillStyle = '#000'
      x.beginPath(); x.arc(0, 0, R * 0.2, 0, Math.PI * 2); x.fill()
      x.fillStyle = col
      x.beginPath(); x.arc(0, 0, R * 0.135, 0, Math.PI * 2); x.fill()
    }
    x.restore()
  }

  private drawParticles(x: CanvasRenderingContext2D, R: number, cx: number, cy: number) {
    for (const p of this.particles) {
      if (p.age <= 0) continue
      const k = p.age / p.life
      const a = k < 0.2 ? k / 0.2 : 1 - (k - 0.2) / 0.8
      const sz = R * p.size * (1 + k * 0.4)
      x.save()
      x.translate(cx + (p.x + p.vx * p.age) * R * 1.3, cy + (p.y + p.vy * p.age) * R * 1.3)
      x.globalAlpha = Math.min(1, Math.max(0, a))
      switch (p.type) {
        case 'heart': x.rotate(Math.sin(p.age * 6) * 0.3); x.fillStyle = '#FF4D6D'; heartPath(x, sz); x.fill(); break
        case 'star': x.rotate(p.rot + p.age * 2); x.fillStyle = '#F7B32B'; starPath(x, sz, sz * 0.45); x.fill(); break
        case 'spark': x.rotate(p.rot); x.fillStyle = '#fff'; starPath(x, sz * 0.8, sz * 0.18); x.fill(); break
        case 'sweat':
          x.fillStyle = '#7CC7FF'
          x.beginPath(); x.moveTo(0, -sz); x.quadraticCurveTo(sz * 0.8, sz * 0.2, 0, sz * 0.6); x.quadraticCurveTo(-sz * 0.8, sz * 0.2, 0, -sz); x.fill()
          break
        case 'z':
          x.fillStyle = 'rgb(209,219,235)'
          x.font = `700 ${sz * 1.9}px ${FONT}`
          x.textAlign = 'center'
          x.textBaseline = 'middle'
          x.fillText('z', 0, 0)
          break
      }
      x.restore()
    }
  }
}
