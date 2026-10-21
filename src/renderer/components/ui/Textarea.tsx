import { useId,type TextareaHTMLAttributes } from 'react'
export function Textarea({label,id,...props}:TextareaHTMLAttributes<HTMLTextAreaElement>&{label:string}){
  const auto=useId(),inputId=id ?? auto
  return <div className="flex flex-col gap-1.5"><label htmlFor={inputId} className="text-xs text-dim">{label}</label><textarea {...props} id={inputId} aria-label={label} className="ds-field min-h-24 resize-y py-2" /></div>
}
