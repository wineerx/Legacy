import { useId, type InputHTMLAttributes, type TextareaHTMLAttributes, type ReactNode } from 'react'
import { LoaderCircle, Search } from 'lucide-react'
import { cx } from './cx'
import { Input } from './Input'

export function Spinner({ label = 'Carregando' }: { label?: string }) { return <LoaderCircle role="status" aria-label={label} size={16} className="animate-spin shrink-0" /> }
export function Checkbox({ label, description, error, className, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; description?: string; error?: string }) {
 const auto = useId(); const id = props.id ?? auto
 return <label className={cx('ds-choice', props.checked && 'ds-selected', props.disabled && 'opacity-50', className)} htmlFor={id}><input {...props} id={id} type="checkbox" aria-labelledby={`${id}-label`} aria-invalid={!!error || undefined} aria-describedby={description || error ? `${id}-help` : undefined} /><span><span id={`${id}-label`} className="font-medium">{label}</span>{(description || error) && <span id={`${id}-help`} className={cx('mt-1 block text-xs', error ? 'text-danger-fg' : 'text-dim')}>{error ?? description}</span>}</span></label>
}
export function Radio({ label, description, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; description?: string }) {
 const id = useId(); return <label htmlFor={id} className={cx('ds-choice',props.checked && 'ds-selected',props.disabled && 'opacity-50')}><input {...props} type="radio" id={id} /><span><span className="font-medium">{label}</span>{description && <span className="mt-1 block text-xs text-dim">{description}</span>}</span></label>
}
export { Select } from './Select'
export function Textarea({ label, error, className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; error?: string }) {
 const id = useId();return <div className="grid gap-1.5"><label htmlFor={id} className="text-xs text-dim">{label}</label><textarea {...props} id={id} aria-invalid={!!error || undefined} aria-describedby={error ? `${id}-err` : undefined} className={cx('ds-field min-h-24 resize-y',className)} />{error && <p id={`${id}-err`} className="text-xs text-danger-fg">{error}</p>}</div>
}
export function SearchInput(props: InputHTMLAttributes<HTMLInputElement> & { label: string }) { return <div className="relative"><Search className="pointer-events-none absolute bottom-2.5 left-3 text-dim" size={16} /><Input {...props} type="search" className="pl-9" /></div> }
export function Badge({ children, tone = 'default' }: { children: ReactNode; tone?: 'default'|'success'|'error'|'selected' }) { return <span className={cx('ds-badge',tone === 'error' && 'text-danger-fg',tone === 'success' && 'text-ok',tone === 'selected' && 'bg-fg text-app')}>{children}</span> }
