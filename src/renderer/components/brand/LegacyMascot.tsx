import { useId, type CSSProperties } from 'react'
import { useBrandPreferences } from './preferences'
import { useMascotMotion } from './motion'
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

const colors: Partial<Record<MascotState, string>> = {
  working: '#8bcfff', thinking: '#c6acf4', searching: '#a7b1fa', approval: '#f0cf8e',
  question: '#8ee4e8', error: '#eda2b0', finished: '#a3deca', love: '#a6d9f7',
  dizzy: '#e8b2d6', proud: '#b7dfcf', upload: '#b0cdf1', downloading: '#a4d4f1', publishing: '#a4c8ef',
  warning: '#ecc891', rate_limit: '#efb27c', waiting: '#ddd1b6', offline: '#b8bdc9', notification: '#d5c4a5',
}

export function LegacyMascot({ state = 'idle', accessory, size = 96, decorative = false, animated = true, interactive = false }: {
  state?: MascotState; accessory?: MascotAccessory; size?: number; decorative?: boolean; animated?: boolean; interactive?: boolean
}) {
  const id = useId().replace(/:/g, '')
  const preferences = useBrandPreferences()
  const wear = accessory ?? (state === 'proud' ? 'crown' : preferences.accessory)
  const motion = useMascotMotion(interactive, animated && preferences.motion)
  const happy = ['greeting', 'finished', 'dancing', 'proud'].includes(state)
  const closed = state === 'sleeping' || state === 'error'
  const active = ['working', 'thinking', 'searching', 'publishing', 'downloading', 'upload'].includes(state)
  const badge = active || ['approval', 'question', 'error', 'finished', 'rate_limit', 'warning', 'notification'].includes(state)
  return <svg ref={motion.ref} viewBox="0 0 160 160" width={size} height={size} role={decorative ? undefined : 'img'}
    aria-hidden={decorative || undefined} aria-label={decorative ? undefined : `Legacy: ${mascotStates[state]}`}
    className={`legacy-mascot mascot-${state}`} data-state={state} data-animated={motion.allowed}
    style={{ '--mascot-tint': colors[state] ?? '#e5e5e8' } as CSSProperties}>
    <defs>
      <radialGradient id={`${id}-body`} cx="32%" cy="18%" r="90%"><stop stopColor="#fff" /><stop offset=".42" stopColor="#eeeef0" /><stop offset="1" stopColor="var(--mascot-tint)" /></radialGradient>
      <radialGradient id={`${id}-shine`} cx="50%" cy="0%" r="85%"><stop stopColor="#fff" stopOpacity=".8" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></radialGradient>
      <radialGradient id={`${id}-aura`}><stop stopColor="var(--mascot-tint)" stopOpacity=".18" /><stop offset="1" stopColor="var(--mascot-tint)" stopOpacity="0" /></radialGradient>
    </defs>
    <circle cx="80" cy="83" r="77" fill={`url(#${id}-aura)`} />
    <ellipse className="mascot-shadow" cx="80" cy="139" rx="37" ry="5" fill="#000" opacity=".22" />
    <g className="mascot-tilt"><g className="mascot-float">
      {state === 'greeting' && <g fill="#ececef"><ellipse className="mascot-hand" cx="139" cy="70" rx="10" ry="10" /><ellipse cx="20" cy="114" rx="10" ry="10" /></g>}
      <g className="mascot-body">
        <path d={state === 'upload' ? 'M47 42 Q33 42 33 58 V112 Q33 128 49 128 H111 Q127 128 127 112 V58 Q127 42 111 42Z' : 'M80 39 C116 39 133 48 134 80 C136 117 121 130 80 130 C40 130 25 117 26 84 C26 51 41 39 80 39Z'} fill={`url(#${id}-body)`} stroke="#fff" strokeOpacity=".3" />
        <path d="M45 60 Q53 45 82 46 Q111 46 119 60 Q82 50 45 60" fill={`url(#${id}-shine)`} />
        {['love', 'proud', 'greeting'].includes(state) && <g fill="#eea7b9" opacity=".5"><ellipse cx="48" cy="103" rx="9" ry="4" /><ellipse cx="112" cy="103" rx="9" ry="4" /></g>}
        <g className="mascot-gaze"><g className="mascot-eyes" fill="#242329" stroke="#242329" strokeWidth="4.5" strokeLinecap="round">
          {happy ? <><path d="M53 95 Q60 81 67 95" fill="none" /><path d="M93 95 Q100 81 107 95" fill="none" /></> : closed ? <><path d="M54 94 Q60 100 66 94" fill="none" /><path d="M94 94 Q100 100 106 94" fill="none" /></> : state === 'dizzy' ? <><path d="M65 96 c-14 10-18-14-4-12 c10 1 7 15 0 11 c-4-2-1-6 1-4 M105 96 c-14 10-18-14-4-12 c10 1 7 15 0 11 c-4-2-1-6 1-4" fill="none" strokeWidth="2.5" /></> : <><ellipse cx="60" cy="93" rx="3.7" ry={state === 'surprised' ? 6.8 : 5} stroke="none" />{state === 'wink' ? <path d="M94 95 Q100 84 107 95" fill="none" /> : <ellipse cx="100" cy="93" rx="3.7" ry={state === 'surprised' ? 6.8 : 5} stroke="none" />}</>}
        </g></g>
        {state === 'upload' && <path className="mascot-upload" d="M80 73 V53 M73 60 L80 53 87 60" fill="none" stroke="#6485b7" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />}
        {state === 'downloading' && <path className="mascot-download" d="M80 52 V72 M73 65 L80 72 87 65" fill="none" stroke="#6485b7" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />}
        {['waiting', 'rate_limit'].includes(state) && <path d="M76 57 V68 M84 57 V68" stroke="#98744f" strokeWidth="3" strokeLinecap="round" />}
        {state === 'offline' && <path d="M71 63 Q80 55 89 63 M72 55 L88 71" fill="none" stroke="#818899" strokeWidth="2.5" strokeLinecap="round" />}
        {wear === 'glasses' && <g fill="none" stroke="#78654f" strokeWidth="3"><circle cx="60" cy="93" r="13" /><circle cx="100" cy="93" r="13" /><path d="M73 92 Q80 86 87 92 M27 88 L47 91 M113 91 L134 88" /></g>}
        {wear === 'beanie' && <g><path d="M28 63 Q38 27 80 28 Q122 27 132 63Z" fill="#719ed9" /><path d="M40 56 Q80 46 120 56 M56 36 L52 54 M80 30 V51 M103 36 L108 54" fill="none" stroke="#afc9ed" strokeWidth="2" /><rect x="27" y="56" width="106" height="12" rx="6" fill="#a4c5ed" /><circle cx="80" cy="24" r="9" fill="#f0f2f7" /></g>}
        {wear === 'crown' && <path d="M39 53 L34 28 57 41 79 20 101 41 126 28 120 54 Q80 66 39 53Z" fill="#e5b85f" stroke="#ffe3a5" strokeWidth="3" />}
        {wear === 'party' && <g><path d="M62 44 L81 4 106 47Z" fill="#d77eb1" stroke="#f0aed5" strokeWidth="2" /><path d="M72 25 L92 23 M67 36 L99 35" stroke="#ffdb9e" strokeWidth="4" /><circle cx="81" cy="5" r="4" fill="#ffdb9e" /></g>}
        {wear === 'bow' && <g fill="#d982b4" stroke="#eaa2c9" strokeWidth="2"><path d="M101 46 Q78 24 87 54Z M103 46 Q122 28 121 56Z" /><circle cx="103" cy="46" r="5" /></g>}
      </g>
      {badge && <g className="mascot-badge"><rect x="25" y="36" width="32" height="19" rx="9.5" fill={colors[state]} stroke="#26262e" strokeWidth="3" />{active ? <g className="mascot-dots" fill="#fff"><circle cx="34" cy="45.5" r="2" /><circle cx="41" cy="45.5" r="2" /><circle cx="48" cy="45.5" r="2" /></g> : <text x="41" y="50" textAnchor="middle" fontSize="14" fontWeight="700" fill="#292832">{state === 'finished' ? '✓' : state === 'question' ? '?' : state === 'notification' ? '•' : '!'}</text>}</g>}
      {['love', 'proud', 'dancing'].includes(state) && <g className="mascot-sparkles" fill={state === 'love' ? '#ed95b5' : '#edc77d'}><path d="M33 26 L36 33 44 34 38 40 39 48 33 44 26 48 28 40 22 34 30 33Z" /><path d="M122 14 L125 21 133 22 127 28 128 36 122 32 115 36 117 28 111 22 119 21Z" /></g>}
    </g></g>
  </svg>
}

export function LegacyLogo({ compact = false, state = 'idle', interactive = false }: { compact?: boolean; state?: MascotState; interactive?: boolean }) {
  return <span className={`legacy-logo ${compact ? 'legacy-logo-compact' : ''}`} role="img" aria-label="Legacy">
    <LegacyMascot state={state} size={compact ? 38 : 46} interactive={interactive} decorative />
    {!compact && <span aria-hidden>legacy<span className="legacy-logo-dot">.</span></span>}
  </span>
}
