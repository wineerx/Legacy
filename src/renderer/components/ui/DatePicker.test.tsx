import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DatePicker } from './DatePicker'

describe('DatePicker', () => {
  it('navigates months, selects a date and closes', async () => {
    const change = vi.fn()
    render(<DatePicker label="Data" value="2026-10-06" onChange={change} />)
    await userEvent.click(screen.getByRole('button', { name: 'Data' }))
    expect(screen.getByText('Outubro 2026')).toBeInTheDocument()
    const next = document.querySelector('.rdp-button_next') as HTMLButtonElement
    await userEvent.click(next)
    expect(screen.getByText('Novembro 2026')).toBeInTheDocument()
    await userEvent.click(document.querySelector('.rdp-button_previous') as HTMLButtonElement)
    await userEvent.click(document.querySelector('[data-day="2026-10-15"] button') as HTMLButtonElement)
    expect(change).toHaveBeenCalledWith('2026-10-15')
    expect(screen.queryByText('Outubro 2026')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Data' })).toHaveFocus()
  })
  it('disables dates before the minimum and clears selection', async () => {
    const change = vi.fn()
    render(<DatePicker label="Data" value="2026-10-06" min="2026-10-06" onChange={change} clearable />)
    await userEvent.click(screen.getByRole('button', { name: 'Data' }))
    expect(document.querySelector('[data-day="2026-10-05"] button')).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Limpar data' }))
    expect(change).toHaveBeenCalledWith('')
  })
  it('opens the minimum month for an empty field and closes with Escape', async () => {
    render(<DatePicker label="Data" value="" min="2026-10-06" onChange={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Data' }))
    expect(screen.getByText('Outubro 2026')).toBeInTheDocument()
    expect(document.querySelector('.rdp-root')).toHaveAttribute('data-nav-layout', 'around')
    expect(document.querySelector('[data-day="2026-09-27"]')).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByText('Outubro 2026')).not.toBeInTheDocument()
  })
})
