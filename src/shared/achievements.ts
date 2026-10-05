export interface Challenge { id: string; title: string; description: string; current: number; target: number; unlocked: boolean }
export interface AchievementSummary { challenges: Challenge[]; streaks: { username: string; current: number; best: number; today: boolean }[] }

// Calendar days, not elapsed 24-hour windows; DST and midnight use the workspace timezone.
export function streakFor(dates: string[], now: Date, timeZone: string) {
  const day = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
  const serial = (s: string) => Math.floor(Date.parse(`${s}T12:00:00Z`) / 86400000)
  const days = [...new Set(dates.map(d => serial(day(new Date(d)))))].sort((a, b) => b - a)
  const today = serial(day(now)); let best = 0; let run = 0; let prev: number | undefined
  for (const d of days) { run = prev === d + 1 ? run + 1 : 1; best = Math.max(best, run); prev = d }
  let current = 0
  if (days[0] === today || days[0] === today - 1) {
    current = 1
    while (days[current] === days[current - 1] - 1) current++
  }
  return { current, best, today: days.includes(today) }
}
