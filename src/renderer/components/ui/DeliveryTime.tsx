import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { zonedToUtc } from '@shared/schedule'
import { Input } from './Input'
import { Button } from './Button'

export function deliveryError(value: string, timeZone: string, now = new Date(), count = 1, intervalMin = 60): string | undefined {
 if (!Number.isInteger(intervalMin) || intervalMin<15 || intervalMin>10080) return 'Use um intervalo entre 15 e 10080 minutos.'
 if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return 'Escolha data e horário.'
 try { const [date,time] = value.split('T'); const utc = zonedToUtc(date,time,timeZone); const last = utc.getTime() + (count-1)*intervalMin*60000
  if (!Number.isFinite(utc.getTime()) || utc.getTime() < now.getTime()+60000) return 'Escolha pelo menos um minuto no futuro.'
  if (last > now.getTime()+90*86400000) return 'Todas as publicações devem ocorrer em até 90 dias.'
 } catch {return 'Data, horário ou fuso inválidos.'}
}
export function DeliveryTime({ value, onChange, timeZone, count = 1, intervalMin = 60 }: { value: string; onChange(v:string):void; timeZone:string; count?:number; intervalMin?:number }) {
 const [now,setNow] = useState(()=>new Date()); useEffect(()=>{const id=setInterval(()=>setNow(new Date()),30000);return()=>clearInterval(id)},[])
 const [date='',time=''] = value.split('T')
 const localToday = new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(now)
 const [month,setMonth] = useState(()=> (date || localToday).slice(0,7))
 const start = new Date(`${month}-01T12:00:00Z`); const y=start.getUTCFullYear(),m=start.getUTCMonth(); const days=new Date(Date.UTC(y,m+1,0)).getUTCDate(); const blank=start.getUTCDay()
 const chooseDate=(d:string)=>onChange(`${d}T${time || '18:30'}`)
 const error=deliveryError(value,timeZone,now,count,intervalMin)
 const shift=(n:number)=>setMonth(new Date(Date.UTC(y,m+n,1)).toISOString().slice(0,7))
 return <section className="grid gap-4" aria-label="Escolher data e horário"><div className="ds-calendar"><div className="flex items-center justify-between"><Button size="sm" aria-label="Mês anterior" onClick={()=>shift(-1)} icon={<ChevronLeft size={14}/>} /><span className="text-sm font-semibold">{start.toLocaleDateString('pt-BR',{month:'long',year:'numeric',timeZone:'UTC'})}</span><Button size="sm" aria-label="Próximo mês" onClick={()=>shift(1)} icon={<ChevronRight size={14}/>} /></div><div className="mt-3 grid grid-cols-7 gap-1 text-center">{['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'].map(d=><span className="text-[11px] text-dim" key={d}>{d}</span>)}{Array.from({length:blank},(_,i)=><span key={`blank${i}`}/>)}{Array.from({length:days},(_,i)=>{const d=`${month}-${String(i+1).padStart(2,'0')}`;return <button key={d} type="button" aria-label={`Selecionar ${d}`} aria-pressed={d===date} disabled={d<localToday} className="ds-calendar-day" onClick={()=>chooseDate(d)}>{i+1}</button>})}</div></div><div className="grid grid-cols-2 gap-3"><Input label="Data" type="date" min={localToday} value={date} onChange={e=>{chooseDate(e.target.value);if(e.target.value)setMonth(e.target.value.slice(0,7))}} /><Input label="Horário" type="time" value={time} onChange={e=>onChange(`${date || localToday}T${e.target.value}`)} /></div><div className="flex flex-wrap gap-2" aria-label="Atalhos de horário">{['09:00','12:00','18:30','20:00'].map(t=><Button key={t} size="sm" aria-pressed={time===t} onClick={()=>onChange(`${date || localToday}T${t}`)}>{t}</Button>)}</div><p className="text-xs text-dim">Fuso horário: <strong className="text-fg">{timeZone}</strong></p>{error ? <p role="status" className="text-xs text-danger-fg">{error}</p> : <div className="ds-summary" role="status">{count} publicação(ões) a partir de {date.split('-').reverse().join('/')} às {time}.{count>1 && ` Intervalo de ${intervalMin} minutos.`}</div>}</section>
}
