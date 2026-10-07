import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CollapsibleCard } from './Collapsible'

describe('CollapsibleCard', () => {
  it('supports keyboard toggling, hides collapsed controls, and preserves form values', async () => {
    const user = userEvent.setup()
    render(<CollapsibleCard title="Filtros" description="Refine os resultados">
      <input aria-label="Hashtag" defaultValue="" />
    </CollapsibleCard>)
    const trigger = screen.getByRole('button', { name: 'Filtros' })
    const panel = document.querySelector('.collapsible-content')!
    expect(trigger).toHaveAccessibleDescription('Refine os resultados')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(panel).toHaveAttribute('inert')
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    await user.tab()
    expect(trigger).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(trigger).toHaveAttribute('aria-controls', panel.id)
    expect(panel).not.toHaveAttribute('inert')
    await user.type(screen.getByRole('textbox'), '#treino')
    trigger.focus()
    await user.keyboard(' ')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await user.keyboard('{Enter}')
    expect(screen.getByRole('textbox')).toHaveValue('#treino')
  })

  it('keeps header actions separate from the trigger in controlled mode', async () => {
    const action = vi.fn()
    function Example() {
      const [open, setOpen] = useState(true)
      return <CollapsibleCard title="Grupo" open={open} onOpenChange={setOpen}
        actions={<button onClick={action}>Marcar como lido</button>}>Eventos</CollapsibleCard>
    }
    render(<Example />)
    const trigger = screen.getByRole('button', { name: 'Grupo' })
    const button = screen.getByRole('button', { name: 'Marcar como lido' })
    expect(trigger).not.toContainElement(button)
    await userEvent.click(button)
    expect(action).toHaveBeenCalledOnce()
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    await userEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  it('does not expand when disabled', async () => {
    render(<CollapsibleCard title="Indisponível" disabled>Conteúdo</CollapsibleCard>)
    const trigger = screen.getByRole('button', { name: 'Indisponível' })
    await userEvent.click(trigger)
    expect(trigger).toBeDisabled()
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })
})
