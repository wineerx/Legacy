import { useEffect, useRef, useState, type InputHTMLAttributes } from 'react'
import { Minus, Plus } from 'lucide-react'
import { cx } from './cx'

export function NumberField({
  className,
  onChange,
  value,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  const ref = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState(
    typeof value === 'number' && !Number.isFinite(value)
      ? ''
      : String(value ?? '')
  )
  useEffect(() => {
    if (document.activeElement !== ref.current)
      setDraft(
        typeof value === 'number' && !Number.isFinite(value)
          ? ''
          : String(value ?? '')
      )
  }, [value])
  const n = draft === '' ? NaN : Number(draft)
  const min = props.min === undefined ? -Infinity : Number(props.min)
  const max = props.max === undefined ? Infinity : Number(props.max)
  const step = props.step === 'any' ? 1 : Number(props.step ?? 1)
  const invalid =
    draft === ''
      ? props.required || typeof value === 'number'
      : !Number.isFinite(n) ||
        n < min ||
        n > max ||
        (props.step !== 'any' &&
          Math.abs(
            (n - (Number.isFinite(min) ? min : 0)) / step -
              Math.round((n - (Number.isFinite(min) ? min : 0)) / step)
          ) > 1e-8)
  const increment = (direction: number) => {
    if (!ref.current) return
    const next = Math.min(
      max,
      Math.max(
        min,
        Number(
          (Number.isFinite(n)
            ? n + direction * step
            : Number.isFinite(min)
              ? min
              : 0
          ).toFixed(8)
        )
      )
    )
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value'
    )?.set
    setter?.call(ref.current, String(next))
    ref.current.dispatchEvent(new Event('input', { bubbles: true }))
    ref.current.focus()
  }
  const name = props['aria-label'] ?? 'valor'
  return (
    <div
      data-invalid={invalid || props['aria-invalid'] || undefined}
      className={cx(
        className,
        'number-field',
        (invalid || props['aria-invalid']) && 'border-danger',
        props.disabled && 'opacity-50'
      )}
    >
      <button
        type="button"
        disabled={props.disabled || props.readOnly || n <= min}
        aria-label={`Diminuir ${name}`}
        onClick={() => increment(-1)}
      >
        <Minus size={14} />
      </button>
      <input
        {...props}
        ref={ref}
        type="number"
        value={draft}
        aria-invalid={invalid || props['aria-invalid'] || undefined}
        onChange={(e) => {
          setDraft(e.target.value)
          onChange?.(e)
        }}
        onKeyDown={(e) => {
          props.onKeyDown?.(e)
          if (
            !e.defaultPrevented &&
            !props.disabled &&
            !props.readOnly &&
            ['ArrowUp', 'ArrowDown'].includes(e.key)
          ) {
            e.preventDefault()
            increment(e.key === 'ArrowUp' ? 1 : -1)
          }
        }}
      />
      <button
        type="button"
        disabled={props.disabled || props.readOnly || n >= max}
        aria-label={`Aumentar ${name}`}
        onClick={() => increment(1)}
      >
        <Plus size={14} />
      </button>
    </div>
  )
}
