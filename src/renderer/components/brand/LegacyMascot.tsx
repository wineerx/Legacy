import type { CSSProperties } from 'react'
import { useBrandPreferences } from './preferences'
import { PARTICLE_ROOM, useMascotMotion } from './motion'
import './brand.css'

export const mascotStates = {
  idle: 'Em repouso', working: 'Trabalhando', thinking: 'Pensando', searching: 'Buscando',
  approval: 'Aguardando aprovação', question: 'Uma dúvida', error: 'Algo deu errado',
  finished: 'Concluído', sleeping: 'Descansando', greeting: 'Olá!', dizzy: 'Tonto',
  love: 'Com carinho', surprised: 'Surpresa', proud: 'Uma conquista', wink: 'Piscadinha',
  dancing: 'Comemorando', upload: 'Enviando',
  downloading: 'Baixando', publishing: 'Publicando', waiting: 'Na espera',
  warning: 'Atenção', rate_limit: 'Limite temporário', offline: 'Sem rede', notification: 'Novo aviso',
} as const
export type MascotState = keyof typeof mascotStates
export const mascotAccessories = { none: 'Original', glasses: 'Óculos', beanie: 'Gorro', crown: 'Coroa', party: 'Festa', bow: 'Laço' } as const
export type MascotAccessory = keyof typeof mascotAccessories

// Accessories sit on Mochi's body as drawn by the engine in a 160 × 160 box:
// body from y 41 to 125, eyes at (60, 88) and (100, 88).
function Wear({ wear }: { wear: MascotAccessory }) {
  return <svg className="mascot-wear" viewBox="0 0 160 160" aria-hidden>
    {wear === 'glasses' && <g fill="none" stroke="#3a3f4a" strokeWidth="3"><circle cx="60" cy="88" r="13" /><circle cx="100" cy="88" r="13" /><path d="M73 87 Q80 81 87 87 M26 84 L47 86 M113 86 L134 84" /></g>}
    {wear === 'beanie' && <g transform="translate(0 4)"><path d="M30 63 Q40 27 80 28 Q120 27 130 63Z" fill="#719ed9" /><path d="M42 56 Q80 46 118 56 M57 36 L53 54 M80 30 V51 M103 36 L107 54" fill="none" stroke="#afc9ed" strokeWidth="2" /><rect x="28" y="56" width="104" height="12" rx="6" fill="#a4c5ed" /><circle cx="80" cy="24" r="9" fill="#f0f2f7" /></g>}
    {wear === 'crown' && <path d="M42 52 L37 28 59 41 80 21 101 41 123 28 118 52 Q80 63 42 52Z" fill="#e5b85f" stroke="#ffe3a5" strokeWidth="3" />}
    {wear === 'party' && <g><path d="M62 46 L81 6 104 48Z" fill="#d77eb1" stroke="#f0aed5" strokeWidth="2" /><path d="M72 27 L91 25 M67 38 L98 37" stroke="#ffdb9e" strokeWidth="4" /><circle cx="81" cy="7" r="4" fill="#ffdb9e" /></g>}
    {wear === 'bow' && <g fill="#d982b4" stroke="#eaa2c9" strokeWidth="2"><path d="M101 47 Q78 25 87 55Z M103 47 Q122 29 121 57Z" /><circle cx="103" cy="47" r="5" /></g>}
  </svg>
}

export function LegacyMascot({ state = 'idle', accessory, size = 96, decorative = false, animated = true, interactive = false }: {
  state?: MascotState; accessory?: MascotAccessory; size?: number; decorative?: boolean; animated?: boolean; interactive?: boolean
}) {
  const preferences = useBrandPreferences()
  const wear = accessory ?? (state === 'proud' ? 'crown' : preferences.accessory)
  const motion = useMascotMotion(state, size, interactive, animated && preferences.motion)
  return <span ref={motion.ref} role={decorative ? undefined : 'img'}
    aria-hidden={decorative || undefined} aria-label={decorative ? undefined : `Legacy: ${mascotStates[state]}`}
    className={`legacy-mascot mascot-${state}`} data-state={state} data-animated={motion.allowed}
    style={{ width: size, height: size, '--mascot-room': `${PARTICLE_ROOM * 100}%` } as CSSProperties}>
    <canvas ref={motion.canvas} className="mascot-canvas" aria-hidden />
    {wear !== 'none' && <Wear wear={wear} />}
  </span>
}

export function LegacyLogo({ compact = false, state = 'idle', interactive = false }: { compact?: boolean; state?: MascotState; interactive?: boolean }) {
  return <span className={`legacy-logo ${compact ? 'legacy-logo-compact' : ''}`} role="img" aria-label="Legacy">
    <LegacyMascot state={state} size={compact ? 38 : 46} interactive={interactive} decorative />
    {!compact && <span aria-hidden>legacy<span className="legacy-logo-dot">.</span></span>}
  </span>
}
