import { useEffect, useState } from 'react'
import { DatePicker } from './DatePicker'
import * as ToggleGroup from '@radix-ui/react-toggle-group'
import { zonedToUtc } from '@shared/schedule'
import { Input } from './Input'

export function deliveryError(value: string, timeZone: string, now = new Date(), count = 1, intervalMin = 60): string | undefined {
 if (count > 1 && (!Number.isInteger(intervalMin) || intervalMin<15 || intervalMin>10080)) return 'Use um intervalo entre 15 e 10080 minutos.'
 if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return 'Escolha data e horário.'
 try { const [date,time] = value.split('T'); const utc = zonedToUtc(date,time,timeZone); const last = utc.getTime() + (count > 1 ? (count-1)*intervalMin*60000 : 0)
  if (!Number.isFinite(utc.getTime()) || utc.getTime() < now.getTime()+60000) return 'Escolha pelo menos um minuto no futuro.'
  if (last > now.getTime()+90*86400000) return 'Todas as publicações devem ocorrer em até 90 dias.'
 } catch {return 'Data, horário ou fuso inválidos.'}
}
export function DeliveryTime({ value, onChange, timeZone, count = 1, intervalMin = 60, compact = false }: { value: string; onChange(v:string):void; timeZone:string; count?:number; intervalMin?:number; compact?:boolean }) {
 const [now,setNow] = useState(()=>new Date()); useEffect(()=>{const id=setInterval(()=>setNow(new Date()),30000);return()=>clearInterval(id)},[])
 const [date='',time=''] = value.split('T')
 const localToday = new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(now)
 const error=deliveryError(value,timeZone,now,count,intervalMin)
 return <section className={compact ? 'grid gap-2' : 'grid gap-4'} aria-label="Escolher data e horário">
  <div className="grid grid-cols-2 gap-3"><DatePicker label="Data" min={localToday} value={date} onChange={d=>onChange(`${d}T${time || '18:30'}`)} /><Input label="Horário" type="time" value={time} onChange={e=>onChange(`${date || localToday}T${e.target.value}`)} /></div>
  <ToggleGroup.Root type="single" value={time} onValueChange={t=>{if(t)onChange(`${date || localToday}T${t}`)}} className="flex flex-wrap gap-2" aria-label="Atalhos de horário">{['09:00','12:00','18:30','20:00'].map(t=><ToggleGroup.Item key={t} value={t} className="rounded-ctl border border-line px-3 py-1 text-xs data-[state=on]:bg-fg data-[state=on]:text-app">{t}</ToggleGroup.Item>)}</ToggleGroup.Root>
  <p className="text-xs text-dim">Fuso horário: <strong className="text-fg">{timeZone}</strong></p>
  {error ? <p role="status" className="text-xs text-danger-fg">{error}</p> : <div className="ds-summary" role="status">{count} publicação(ões) a partir de {date.split('-').reverse().join('/')} às {time}.{count>1 && ` Intervalo de ${intervalMin} minutos.`}</div>}
 </section>
}
