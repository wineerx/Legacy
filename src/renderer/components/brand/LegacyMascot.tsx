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
const ink = '#2a2620'
// Squircle: flat sides with soft corners, a little wider at the base.
const body = 'M80 38 C118 38 131 45 132 85 C131 125 118 132 80 132 C42 132 29 125 28 85 C29 45 42 38 80 38Z'

function Eye({ cx, state }: { cx: number; state: MascotState }) {
  const surprised = state === 'surprised'
  return <g>
    <ellipse cx={cx} cy="88" rx="14" ry={surprised ? 17 : 15.5} fill="#fffdf8" stroke={ink} strokeWidth="2.5" />
    {state === 'dizzy'
      ? <path d={`M${cx} 88 m-1 0 a2 2 0 1 1 3 2 a5 5 0 1 1 -7 -6 a8 8 0 1 1 9 11`} fill="none" stroke={ink} strokeWidth="2.2" />
      : <g className="mascot-pupil" stroke="none"><circle cx={cx} cy="89" r={surprised ? 5.5 : 7.5} fill="#221f1b" /><circle cx={cx - 2.6} cy="85.8" r="2.4" fill="#fff" /></g>}
  </g>
}

function Mouth({ state, happy, worried, active }: { state: MascotState; happy: boolean; worried: boolean; active: boolean }) {
  if (happy || state === 'love') return <path d="M70 110 Q80 123 90 110Z" fill={ink} strokeLinejoin="round" />
  if (state === 'surprised') return <ellipse cx="80" cy="115" rx="4" ry="5" fill={ink} stroke="none" />
  if (state === 'dizzy') return <path d="M70 114 q5 -4 10 0 t10 0" />
  if (state === 'sleeping') return <path d="M76 114 H84" />
  if (worried) return <path d="M72 116 Q80 110 88 116" />
  if (active) return <path d="M74 113 Q80 116 86 113" />
  return <path d="M72 111 Q80 118 88 111" />
}

export function LegacyMascot({ state = 'idle', accessory, size = 96, decorative = false, animated = true, interactive = false }: {
  state?: MascotState; accessory?: MascotAccessory; size?: number; decorative?: boolean; animated?: boolean; interactive?: boolean
}) {
  const id = useId().replace(/:/g, '')
  const preferences = useBrandPreferences()
  const wear = accessory ?? (state === 'proud' ? 'crown' : preferences.accessory)
  const motion = useMascotMotion(interactive, animated && preferences.motion)
  const happy = ['greeting', 'finished', 'dancing', 'proud'].includes(state)
  const worried = ['error', 'warning', 'rate_limit', 'offline'].includes(state)
  const active = ['working', 'thinking', 'searching', 'publishing', 'downloading', 'upload'].includes(state)
  const badge = active || ['approval', 'question', 'error', 'finished', 'rate_limit', 'warning', 'notification'].includes(state)
  return <svg ref={motion.ref} viewBox="0 0 160 160" width={size} height={size} role={decorative ? undefined : 'img'}
    aria-hidden={decorative || undefined} aria-label={decorative ? undefined : `Legacy: ${mascotStates[state]}`}
    className={`legacy-mascot mascot-${state}`} data-state={state} data-animated={motion.allowed}
    style={{ '--mascot-tint': colors[state] ?? '#e6dccb' } as CSSProperties}>
    <defs>
      <radialGradient id={`${id}-body`} cx="32%" cy="18%" r="92%"><stop stopColor="#fffaf2" /><stop offset=".45" stopColor="#efe9df" /><stop offset="1" stopColor="var(--mascot-tint)" /></radialGradient>
      <radialGradient id={`${id}-shine`} cx="50%" cy="0%" r="85%"><stop stopColor="#fff" stopOpacity=".85" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></radialGradient>
      <radialGradient id={`${id}-aura`}><stop stopColor="var(--mascot-tint)" stopOpacity=".18" /><stop offset="1" stopColor="var(--mascot-tint)" stopOpacity="0" /></radialGradient>
    </defs>
    <circle cx="80" cy="85" r="77" fill={`url(#${id}-aura)`} />
    <ellipse className="mascot-shadow" cx="80" cy="141" rx="38" ry="5" fill="#000" opacity=".22" />
    <g className="mascot-tilt"><g className="mascot-float">
      {state === 'greeting' && <g fill="#efe9df"><ellipse className="mascot-hand" cx="140" cy="72" rx="10" ry="10" /><ellipse cx="20" cy="112" rx="10" ry="10" /></g>}
      <g className="mascot-body">
        <path d={body} fill={`url(#${id}-body)`} stroke="#fff" strokeOpacity=".35" />
        <path d="M48 54 Q56 44 80 44 Q104 44 112 54 Q80 48 48 54" fill={`url(#${id}-shine)`} />
        {(wear === 'none' || wear === 'glasses') && <g className="mascot-ribbon"><path d="M107 37 H120 V63 L113.5 57.5 L107 63Z" fill="#dfc39b" /><path d="M107 37 H120 V41 H107Z" fill="#c9a774" /></g>}
        {['love', 'proud', 'greeting', 'finished', 'dancing'].includes(state) && <g fill="#eea7b9" opacity=".55"><ellipse cx="42" cy="108" rx="8" ry="4" /><ellipse cx="118" cy="108" rx="8" ry="4" /></g>}
        <g className="mascot-gaze" fill="none" stroke={ink} strokeLinecap="round">
          {worried && <path d="M48 70 Q58 69 70 64 M90 64 Q102 69 112 70" strokeWidth="3" />}
          {(state === 'question' || state === 'approval') && <path d="M50 67 Q59 65 70 67 M90 64 Q101 58 112 63" strokeWidth="3" />}
          <g className="mascot-eyes" strokeWidth="5">
            {happy ? <><path d="M48 92 Q60 76 72 92" /><path d="M88 92 Q100 76 112 92" /></>
              : state === 'sleeping' ? <><path d="M48 88 Q60 97 72 88" /><path d="M88 88 Q100 97 112 88" /></>
              : <><Eye cx={60} state={state} />{state === 'wink' ? <path d="M88 92 Q100 78 112 92" /> : <Eye cx={100} state={state} />}</>}
          </g>
          <g className="mascot-mouth" strokeWidth="3.5"><Mouth state={state} happy={happy} worried={worried} active={active} /></g>
        </g>
        {state === 'upload' && <path className="mascot-upload" d="M80 62 V44 M73 51 L80 44 87 51" fill="none" stroke="#6485b7" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />}
        {state === 'downloading' && <path className="mascot-download" d="M80 44 V62 M73 55 L80 62 87 55" fill="none" stroke="#6485b7" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />}
        {['waiting', 'rate_limit'].includes(state) && <path d="M76 47 V58 M84 47 V58" stroke="#98744f" strokeWidth="3" strokeLinecap="round" />}
        {state === 'offline' && <path d="M71 54 Q80 46 89 54 M72 46 L88 62" fill="none" stroke="#818899" strokeWidth="2.5" strokeLinecap="round" />}
        {wear === 'glasses' && <g fill="none" stroke="#78654f" strokeWidth="3"><circle cx="60" cy="88" r="18" /><circle cx="100" cy="88" r="18" /><path d="M78 87 Q80 83 82 87 M28 84 L42 87 M118 87 L132 84" /></g>}
        {wear === 'beanie' && <g transform="translate(0 -6)"><path d="M28 63 Q38 27 80 28 Q122 27 132 63Z" fill="#719ed9" /><path d="M40 56 Q80 46 120 56 M56 36 L52 54 M80 30 V51 M103 36 L108 54" fill="none" stroke="#afc9ed" strokeWidth="2" /><rect x="27" y="56" width="106" height="12" rx="6" fill="#a4c5ed" /><circle cx="80" cy="24" r="9" fill="#f0f2f7" /></g>}
        {wear === 'crown' && <path d="M39 51 L34 26 57 39 79 18 101 39 126 26 120 52 Q80 62 39 51Z" fill="#e5b85f" stroke="#ffe3a5" strokeWidth="3" />}
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
