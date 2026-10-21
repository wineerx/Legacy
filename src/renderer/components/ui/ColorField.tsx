import * as Popover from '@radix-ui/react-popover'
import { Input } from './Input'
import { Button } from './Button'
import { Slider } from './Slider'
export function ColorField({label,value,onChange,disabled,portalContainer}:{label:string;value:string;onChange(v:string):void;disabled?:boolean;portalContainer?:HTMLElement|null}){
  const hex=/^#[0-9a-f]{6,8}$/i.test(value)?value:'#000000'
  const channels=[parseInt(hex.slice(1,3),16),parseInt(hex.slice(3,5),16),parseInt(hex.slice(5,7),16)]
  return <div className="flex items-end gap-2"><div className="min-w-0 flex-1"><Input label={label} value={value} disabled={disabled} onChange={e=>onChange(e.target.value)} /></div><Popover.Root><Popover.Trigger asChild><Button disabled={disabled} aria-label={`Escolher ${label.toLowerCase()}`}><span className="size-4 rounded border border-line" style={{background:hex}} /></Button></Popover.Trigger><Popover.Portal container={portalContainer ?? undefined}><Popover.Content className="ds-dropdown flex w-64 flex-col gap-3 p-3" sideOffset={6} aria-label={`Seletor de ${label.toLowerCase()}`}>
    {channels.map((v,i)=><div key={i} className="flex flex-col gap-1"><span className="text-xs text-dim">{['Vermelho','Verde','Azul'][i]} · {v}</span><Slider label={`${label} ${['vermelho','verde','azul'][i]}`} value={v} max={255} onChange={n=>{const next=[...channels];next[i]=n;onChange('#'+next.map(c=>c.toString(16).padStart(2,'0')).join('')+hex.slice(7))}} /></div>)}
    <div className="flex gap-2">{['#ffffff','#000000','#ef4444','#22c55e','#3b82f6'].map(c=><Button key={c} size="sm" aria-label={`Cor ${c}`} onClick={()=>onChange(c)}><span className="size-4" style={{background:c}} /></Button>)}</div>
  </Popover.Content></Popover.Portal></Popover.Root></div>
}
