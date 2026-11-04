import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ePub from 'epubjs'
import Leitor from './Leitor.vue'

vi.mock('epubjs', () => ({ default: vi.fn() }))

const livro = { id: 'quincas borba.epub', title: 'Quincas Borba' }

function epubFalso() {
  const rendition = { on: vi.fn(), display: vi.fn(async () => {}), next: vi.fn(), prev: vi.fn() }
  const instancia = { renderTo: vi.fn(() => rendition), destroy: vi.fn() }
  ePub.mockReturnValue(instancia)
  return { rendition, instancia }
}

describe('Leitor', () => {
  beforeEach(() => ePub.mockReset())

  it('abre o arquivo do livro pela API', async () => {
    const { rendition } = epubFalso()
    mount(Leitor, { props: { livro } })
    await flushPromises()
    expect(ePub).toHaveBeenCalledWith('/api/books/quincas%20borba.epub/file', { openAs: 'epub' })
    expect(rendition.display).toHaveBeenCalled()
  })

  it('avança e volta pelas setas e pelo teclado', async () => {
    const { rendition } = epubFalso()
    const leitor = mount(Leitor, { props: { livro } })
    await flushPromises()
    const [anterior, proxima] = leitor.findAll('footer button')
    await proxima.trigger('click')
    await anterior.trigger('click')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
    expect(rendition.next).toHaveBeenCalledTimes(2)
    expect(rendition.prev).toHaveBeenCalledTimes(1)
    leitor.unmount()
  })

  it('mostra erro quando o livro não abre', async () => {
    const { rendition } = epubFalso()
    rendition.display.mockRejectedValue(new Error('arquivo inválido'))
    const leitor = mount(Leitor, { props: { livro } })
    await flushPromises()
    expect(leitor.text()).toContain('Não foi possível abrir este livro')
  })

  it('libera o livro ao fechar', async () => {
    const { instancia } = epubFalso()
    const leitor = mount(Leitor, { props: { livro } })
    await flushPromises()
    leitor.unmount()
    expect(instancia.destroy).toHaveBeenCalled()
  })
})
