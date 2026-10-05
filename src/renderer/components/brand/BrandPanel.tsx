import { useState } from 'react'
import { LegacyLogo, LegacyMascot, mascotAccessories, mascotStates, type MascotState, type MascotAccessory } from './LegacyMascot'
import { setBrandPreferences, useBrandPreferences } from './preferences'
import { Toggle } from '../ui'

export function BrandPanel() {
  const [state, setState] = useState<MascotState>('greeting')
  const preferences = useBrandPreferences()
  return <section className="brand-panel" aria-labelledby="brand-title">
    <div className="brand-panel-heading"><div><p className="brand-eyebrow">FEITO PARA ACOMPANHAR VOCÊ</p><h2 id="brand-title">O seu Legacy.</h2><p>Um pouco de personalidade em cada etapa.</p></div><LegacyLogo /></div>
    <div className="brand-playground">
      <div className="brand-stage"><span className="brand-orbit brand-orbit-one" /><span className="brand-orbit brand-orbit-two" /><LegacyMascot state={state} size={200} /><span className="brand-stage-label" aria-live="polite">{mascotStates[state]}</span></div>
      <div className="brand-controls"><h3>Experimente as expressões</h3><p>Prévia dos estados do mascote. Na interface, ele acompanha suas tarefas.</p><div className="brand-state-list">{Object.entries(mascotStates).map(([value, label]) => <button key={value} type="button" aria-pressed={state === value} onClick={() => setState(value as MascotState)}>{label}</button>)}</div></div>
    </div>
    <fieldset className="brand-wardrobe"><legend>Escolha o visual</legend><p>Salvo neste computador. Nas conquistas, o Legacy usa a coroa por um instante.</p><div className="brand-accessories">{Object.entries(mascotAccessories).map(([value, label]) => <button type="button" key={value} aria-label={`Visual: ${label}`} aria-pressed={preferences.accessory === value} onClick={() => setBrandPreferences({ accessory: value as MascotAccessory })}><LegacyMascot accessory={value as MascotAccessory} size={78} animated={false} decorative /><span>{label}</span></button>)}</div></fieldset>
    <div className="brand-motion"><div><h3>Animações do mascote</h3><p>Movimentos suaves, piscadas e comemorações. Respeita a redução de movimento do sistema.</p></div><Toggle label="Animações do mascote" checked={preferences.motion} onChange={motion => setBrandPreferences({ motion })} /></div>
  </section>
}
