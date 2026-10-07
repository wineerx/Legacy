import { profileInitials } from './UserAvatar'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, act, within, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Button, Input, Modal, Pills, Toggle, EmptyState, ToastProvider, useToast, cx } from './index'

describe('Button', () => {
  it('dispara clique', async () => {
    const fn = vi.fn()
    render(<Button onClick={fn}>Importar</Button>)
    await userEvent.click(screen.getByRole('button', { name: 'Importar' }))
    expect(fn).toHaveBeenCalledOnce()
  })
  it('com motivo de desabilitado não dispara e expõe o motivo', async () => {
    const fn = vi.fn()
    render(<Button onClick={fn} disabledReason="Conecte o Instagram primeiro.">Publicar</Button>)
    const b = screen.getByRole('button', { name: 'Publicar' })
    expect(b).toHaveAttribute('aria-disabled', 'true')
    expect(b).toHaveAccessibleDescription('Conecte o Instagram primeiro.')
    await userEvent.click(b)
    expect(fn).not.toHaveBeenCalled()
  })
  it('renderiza o motivo como tooltip visível', () => {
    render(<Button disabledReason="Conecte o Instagram primeiro.">Publicar</Button>)
    expect(screen.getByRole('tooltip')).toHaveTextContent('Conecte o Instagram primeiro.')
  })
})

describe('Input', () => {
  it('com erro tem aria-invalid e o erro como descrição', () => {
    render(<Input label="Nome" error="Campo obrigatório" />)
    const i = screen.getByLabelText('Nome')
    expect(i).toHaveAttribute('aria-invalid', 'true')
    expect(i).toHaveAccessibleDescription('Campo obrigatório')
  })
})

describe('cx', () => {
  it('resolve conflitos de classes Tailwind', () => {
    expect(cx('border-line', 'border-danger')).toBe('border-danger')
  })
})

function Trigger({ tone }: { tone: 'info' | 'error' }) {
  const { show } = useToast()
  return <button onClick={() => show({ title: 'Falhou', tone })}>disparar</button>
}

describe('Toast', () => {
  it('erro vai em role=alert, tem "Erro:" e não some sozinho', async () => {
    vi.useFakeTimers()
    try {
      render(<ToastProvider><Trigger tone="error" /></ToastProvider>)
      await act(async () => { screen.getByText('disparar').click(); await vi.advanceTimersByTimeAsync(1) })
      const alert = screen.getByRole('alert')
      expect(alert).toHaveTextContent('Erro: Falhou')
      act(() => { vi.advanceTimersByTime(6000) })
      expect(within(screen.getByRole('alert')).getByText('Falhou')).toBeInTheDocument()
    } finally { vi.useRealTimers() }
  })
  it('info some após 5 s', async () => {
    vi.useFakeTimers()
    try {
      render(<ToastProvider><Trigger tone="info" /></ToastProvider>)
      await act(async () => { screen.getByText('disparar').click(); await vi.advanceTimersByTimeAsync(1) })
      expect(screen.getByText('Falhou')).toBeInTheDocument()
      await act(async () => { await vi.advanceTimersByTimeAsync(5400) })
      expect(screen.queryByText('Falhou')).not.toBeInTheDocument()
    } finally { vi.useRealTimers() }
  })
  it('fecha manualmente uma notificação de erro', async () => {
    render(<ToastProvider><Trigger tone="error" /></ToastProvider>)
    await userEvent.click(screen.getByText('disparar'))
    await userEvent.click(await screen.findByRole('button', { name: 'Fechar notificação' }))
    await waitFor(() => expect(screen.queryByText('Falhou')).not.toBeInTheDocument())
  })
  it('empilha avisos de tipos diferentes e pausa o fechamento ao expandir', async () => {
    vi.useFakeTimers()
    try {
      render(<ToastProvider><Trigger tone="info" /><Trigger tone="error" /></ToastProvider>)
      await act(async () => {
        screen.getAllByText('disparar').forEach(button => button.click())
        await vi.advanceTimersByTimeAsync(1)
      })
      const cards = document.querySelectorAll('[data-sonner-toast]')
      expect(cards).toHaveLength(2)
      expect(cards[0]).toHaveAttribute('data-front', 'true')
      expect(within(cards[0] as HTMLElement).getByRole('alert')).toBeInTheDocument()
      const stack = document.querySelector('[data-sonner-toaster]')!
      fireEvent.mouseEnter(stack)
      expect(cards[1]).toHaveAttribute('data-expanded', 'true')
      await act(async () => { await vi.advanceTimersByTimeAsync(6000) })
      expect(screen.getByRole('status')).toBeInTheDocument()
      fireEvent.mouseLeave(stack)
      await act(async () => { await vi.advanceTimersByTimeAsync(5400) })
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
      expect(screen.getByRole('alert')).toBeInTheDocument()
    } finally { vi.useRealTimers() }
  })
})

describe('Modal', () => {
  it('fecha com Esc', async () => {
    const onOpenChange = vi.fn()
    render(<Modal open onOpenChange={onOpenChange} title="Revisar lote">conteúdo</Modal>)
    expect(screen.getByRole('dialog', { name: 'Revisar lote' })).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})

describe('Pills e Toggle', () => {
  it('Pills marca a opção ativa', async () => {
    const onChange = vi.fn()
    render(<Pills label="Ordenar" value="views" onChange={onChange} options={[{ value: 'views', label: 'Mais vistos' }, { value: 'likes', label: 'Mais curtidos' }]} />)
    expect(screen.getByRole('button', { name: 'Mais vistos' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(screen.getByRole('button', { name: 'Mais curtidos' }))
    expect(onChange).toHaveBeenCalledWith('likes')
  })
  it('Toggle alterna', async () => {
    const onChange = vi.fn()
    render(<Toggle label="Minimizar para a bandeja" checked={false} onChange={onChange} />)
    await userEvent.click(screen.getByRole('switch', { name: 'Minimizar para a bandeja' }))
    expect(onChange).toHaveBeenCalledWith(true)
  })
})

describe('EmptyState', () => {
  it('mostra título, texto e ação', () => {
    render(<EmptyState icon={null} title="Comece pela biblioteca" body="Importe vídeos do seu computador." action={<Button>Importar vídeos</Button>} />)
    expect(screen.getByRole('heading', { name: 'Comece pela biblioteca' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Importar vídeos' })).toBeInTheDocument()
  })
})

it('iniciais ignoram símbolos do nome e identificam usuários locais', () => {
 expect(profileInitials('∝winner')).toBe('WN')
 expect(profileInitials('Eduardo Ximenes')).toBe('EX')
 expect(profileInitials('')).toBe('LG')
})
