import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { aplicarOrientacao, podeGirar, soltar } from './orientacao.js'

// A tela cheia e a trava de orientação de mentira, como no Chrome do Android: a trava só vale
// em tela cheia (precisaTelaCheia) e a tela cheia só abre com um toque recente.
function aparelho({ precisaTelaCheia = true, toque = true, gesto = true, semSuporte = false } = {}) {
  const estado = { telaCheia: null, travada: null }
  const orientation = {
    lock: vi.fn(async (tipo) => {
      if (semSuporte) throw Object.assign(new Error('não disponível'), { name: 'NotSupportedError' })
      if (precisaTelaCheia && !estado.telaCheia) throw Object.assign(new Error('precisa de tela cheia'), { name: 'SecurityError' })
      estado.travada = tipo
    }),
    unlock: vi.fn(() => {
      estado.travada = null
    }),
  }
  Object.defineProperty(screen, 'orientation', { value: orientation, configurable: true })
  vi.stubGlobal('matchMedia', vi.fn((q) => ({ matches: q === '(pointer: coarse)' && toque })))
  Object.defineProperty(navigator, 'userActivation', { value: { isActive: gesto }, configurable: true })
  Object.defineProperty(document, 'fullscreenEnabled', { value: true, configurable: true })
  Object.defineProperty(document, 'fullscreenElement', { get: () => estado.telaCheia, configurable: true })
  document.documentElement.requestFullscreen = vi.fn(async () => {
    if (!gesto) throw new TypeError('Permissions check failed')
    estado.telaCheia = document.documentElement
  })
  document.exitFullscreen = vi.fn(async () => {
    estado.telaCheia = null
    estado.travada = null
  })
  return { orientation, estado }
}

describe('girar a tela (R40)', () => {
  beforeEach(async () => {
    await soltar()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    delete screen.orientation
  })

  it('só oferece a opção em aparelho de toque com a trava', () => {
    aparelho()
    expect(podeGirar()).toBe(true)
    aparelho({ toque: false })
    expect(podeGirar()).toBe(false)
    Object.defineProperty(screen, 'orientation', { value: { type: 'portrait-primary' }, configurable: true })
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    expect(podeGirar()).toBe(false)
  })

  it('entra em tela cheia para travar e sai dela no automático', async () => {
    const { orientation, estado } = aparelho()
    expect(await aplicarOrientacao('deitado')).toEqual({ ok: true })
    expect(document.documentElement.requestFullscreen).toHaveBeenCalled()
    expect(orientation.lock).toHaveBeenLastCalledWith('landscape')
    expect(estado).toEqual({ telaCheia: document.documentElement, travada: 'landscape' })

    expect(await aplicarOrientacao('em-pe')).toEqual({ ok: true })
    expect(estado.travada).toBe('portrait')

    expect(await aplicarOrientacao('auto')).toEqual({ ok: true })
    expect(orientation.unlock).toHaveBeenCalled()
    expect(document.exitFullscreen).toHaveBeenCalled()
    expect(estado.telaCheia).toBeNull()
  })

  it('no app instalado, trava sem precisar da tela cheia', async () => {
    const { estado } = aparelho({ precisaTelaCheia: false })
    expect(await aplicarOrientacao('em-pe')).toEqual({ ok: true })
    expect(document.documentElement.requestFullscreen).not.toHaveBeenCalled()
    expect(estado.travada).toBe('portrait')
  })

  it('a tela cheia que já estava aberta não é fechada pelo automático', async () => {
    const { estado } = aparelho()
    await document.documentElement.requestFullscreen()
    await aplicarOrientacao('deitado')
    await aplicarOrientacao('auto')
    expect(estado.telaCheia).toBe(document.documentElement)
    expect(estado.travada).toBeNull()
  })

  it('sem um toque recente, a escolha fica esperando', async () => {
    const { estado } = aparelho({ gesto: false })
    expect(await aplicarOrientacao('deitado')).toEqual({ ok: false, motivo: 'sem-gesto' })
    expect(document.documentElement.requestFullscreen).not.toHaveBeenCalled()
    expect(estado.telaCheia).toBeNull()
  })

  it('aparelho que não trava (computador): avisa e não fica em tela cheia', async () => {
    const { estado } = aparelho({ semSuporte: true })
    expect(await aplicarOrientacao('em-pe')).toEqual({ ok: false, motivo: 'sem-suporte' })
    expect(estado.telaCheia).toBeNull()
    delete screen.orientation
    expect(await aplicarOrientacao('em-pe')).toEqual({ ok: false, motivo: 'sem-suporte' })
  })
})
