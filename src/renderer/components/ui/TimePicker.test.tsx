import { useState } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it } from 'vitest'
import { TimePicker } from './TimePicker'

function Controlled({ initial = '14:07' }: { initial?: string }) {
  const [value, setValue] = useState(initial)
  return <TimePicker label="Horário" value={value} onChange={setValue} />
}

it('preserves manual entry and selects any hour or minute in 24-hour format', async () => {
  render(<Controlled />)
  const input = screen.getByLabelText('Horário', { exact: true })
  fireEvent.change(input, { target: { value: '23:59' } })
  expect(input).toHaveValue('23:59')
  await userEvent.click(screen.getByRole('button', { name: 'Selecionar horário: Horário' }))
  expect(screen.getByRole('radio', { name: 'Hora 23' })).toHaveAttribute('aria-checked', 'true')
  expect(screen.getByRole('radio', { name: 'Minuto 59' })).toHaveAttribute('aria-checked', 'true')
  await userEvent.click(screen.getByRole('radio', { name: 'Hora 00' }))
  expect(input).toHaveValue('00:59')
  await userEvent.click(screen.getByRole('radio', { name: 'Minuto 01' }))
  expect(input).toHaveValue('00:01')
  await userEvent.keyboard('{Escape}')
  expect(screen.queryByLabelText('Seletor de horário: Horário')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Selecionar horário: Horário' })).toHaveFocus()
})

it('supports empty values, keyboard selection and clearing the input', async () => {
  render(<Controlled initial="" />)
  const input = screen.getByLabelText('Horário', { exact: true })
  await userEvent.click(screen.getByRole('button', { name: 'Selecionar horário: Horário' }))
  await userEvent.keyboard('{ArrowDown}')
  await waitFor(() => expect(screen.getByRole('radio', { name: 'Hora 01' })).toHaveFocus())
  await userEvent.keyboard(' ')
  expect(input).toHaveValue('01:00')
  await userEvent.click(screen.getByRole('radio', { name: 'Minuto 37' }))
  expect(input).toHaveValue('01:37')
  await userEvent.keyboard('{Escape}')
  fireEvent.change(input, { target: { value: '' } })
  expect(input).toHaveValue('')
})

