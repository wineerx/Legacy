import { LegacyLogo, LegacyMascot } from './LegacyMascot'

export function StartupScreen({ error }: { error?: string }) {
  return <div className="legacy-startup" role={error ? 'alert' : 'status'}>
    <LegacyMascot state={error ? 'error' : 'thinking'} size={128} decorative />
    <LegacyLogo />
    <p>{error ?? 'Abrindo…'}</p>
  </div>
}
