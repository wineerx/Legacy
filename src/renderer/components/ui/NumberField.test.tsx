import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Input } from './Input'

function Fixture() {
  const [value, setValue] = useState('1')
  return <Input label="Segundo" type="number" min={0} max={2} step={0.5} value={value} onChange={e => setValue(e.target.value)} />
}
describe('numeric control', () => {
  it('increments decimals, respects bounds and supports keyboard', async () => {
    render(<Fixture />)
    const input = screen.getByRole('spinbutton', { name: 'Segundo' })
    await userEvent.click(screen.getByRole('button', { name: 'Aumentar Segundo' }))
    expect(input).toHaveValue(1.5)
    await userEvent.keyboard('{ArrowUp}')
    expect(input).toHaveValue(2)
    expect(screen.getByRole('button', { name: 'Aumentar Segundo' })).toBeDisabled()
    await userEvent.keyboard('{ArrowDown}')
    expect(input).toHaveValue(1.5)
    await userEvent.clear(input)
    expect(input).toHaveValue(null)
    await userEvent.type(input, '3')
    expect(input).toHaveAttribute('aria-invalid', 'true')
  })
  it('does not change disabled or read-only values', () => {
    render(<Input label="Limite" type="number" min={1} value={1} disabled />)
    expect(screen.getByRole('button', { name: 'Aumentar Limite' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Diminuir Limite' })).toBeDisabled()
  })
})
