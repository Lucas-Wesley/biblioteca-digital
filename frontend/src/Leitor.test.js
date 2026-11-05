import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { abrirEpub } from './motores/epub.js'
import { abrirPdf } from './motores/pdf.js'
import { preferencias } from './preferencias.js'
import Leitor from './Leitor.vue'

vi.mock('./motores/epub.js', () => ({ abrirEpub: vi.fn() }))
vi.mock('./motores/pdf.js', () => ({ abrirPdf: vi.fn() }))

const livro = { id: 'quincas borba', title: 'Quincas Borba', format: 'epub' }
const urlProgresso = '/api/books/quincas%20borba/progress'

function motorFalso(sumario = []) {
  return {
    sumario: () => sumario,
    anterior: vi.fn(),
    proxima: vi.fn(),
    irPara: vi.fn(),
    aplicar: vi.fn(),
    redimensionar: vi.fn(),
    destruir: vi.fn(),
  }
}

function stubProgresso(salvo = { position: '', percent: 0 }) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => salvo })))
}

function salvamentos() {
  return fetch.mock.calls.filter(([, opcoes]) => opcoes?.method === 'PUT')
}

describe('Leitor', () => {
  beforeEach(() => {
    abrirEpub.mockReset()
    abrirPdf.mockReset()
    stubProgresso()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('abre o motor do formato do livro na posição salva', async () => {
    stubProgresso({ position: 'epubcfi(/6/8)', percent: 0.5 })
    abrirEpub.mockResolvedValue(motorFalso())
    mount(Leitor, { props: { livro } })
    await flushPromises()
    expect(fetch).toHaveBeenCalledWith(urlProgresso)
    expect(abrirEpub.mock.calls[0][0].posicao).toBe('epubcfi(/6/8)')
    expect(abrirPdf).not.toHaveBeenCalled()

    abrirPdf.mockResolvedValue(motorFalso())
    mount(Leitor, { props: { livro: { ...livro, format: 'pdf' } } })
    await flushPromises()
    expect(abrirPdf).toHaveBeenCalled()
  })

  it('abre do início quando a API de progresso falha', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    abrirEpub.mockResolvedValue(motorFalso())
    const leitor = mount(Leitor, { props: { livro } })
    await flushPromises()
    expect(abrirEpub.mock.calls[0][0].posicao).toBeUndefined()
    expect(leitor.text()).not.toContain('Não foi possível')
  })

  it('avança e volta pelos botões e pelo teclado', async () => {
    const motor = motorFalso()
    abrirEpub.mockResolvedValue(motor)
    const leitor = mount(Leitor, { props: { livro } })
    await flushPromises()
    const [anterior, proxima] = leitor.findAll('footer button')
    await proxima.trigger('click')
    await anterior.trigger('click')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
    expect(motor.proxima).toHaveBeenCalledTimes(2)
    expect(motor.anterior).toHaveBeenCalledTimes(1)
    leitor.unmount()
  })

  it('vira a página pelas laterais e esconde os controles pelo centro', async () => {
    const motor = motorFalso()
    abrirEpub.mockResolvedValue(motor)
    const leitor = mount(Leitor, { props: { livro } })
    await flushPromises()
    const { aoClicar, aoDeslizar } = abrirEpub.mock.calls[0][0]
    aoClicar(window.innerWidth * 0.1)
    aoClicar(window.innerWidth * 0.9)
    aoDeslizar('proxima')
    expect(motor.anterior).toHaveBeenCalledTimes(1)
    expect(motor.proxima).toHaveBeenCalledTimes(2)

    aoClicar(window.innerWidth * 0.5)
    await flushPromises()
    expect(leitor.get('header').classes()).toContain('oculto')
    leitor.unmount()
  })

  it('não salva ao abrir, só depois de a leitura avançar', async () => {
    vi.useFakeTimers()
    abrirEpub.mockResolvedValue(motorFalso())
    const leitor = mount(Leitor, { props: { livro } })
    await flushPromises()
    const { aoMudar } = abrirEpub.mock.calls[0][0]

    aoMudar({ posicao: 'epubcfi(/6/2)', percentual: 0, capitulo: '', rotulo: '' })
    vi.advanceTimersByTime(5000)
    expect(salvamentos()).toHaveLength(0)

    await leitor.findAll('footer button')[1].trigger('click')
    aoMudar({ posicao: 'epubcfi(/6/4)', percentual: 0.25, capitulo: '', rotulo: '' })
    aoMudar({ posicao: 'epubcfi(/6/6)', percentual: 0.5, capitulo: '', rotulo: '' })
    vi.advanceTimersByTime(1000)

    const salvos = salvamentos()
    expect(salvos).toHaveLength(1)
    expect(salvos[0][0]).toBe(urlProgresso)
    expect(JSON.parse(salvos[0][1].body)).toEqual({ position: 'epubcfi(/6/6)', percent: 0.5 })
    leitor.unmount()
  })

  it('salva na hora ao fechar e libera o motor', async () => {
    const motor = motorFalso()
    abrirEpub.mockResolvedValue(motor)
    const leitor = mount(Leitor, { props: { livro } })
    await flushPromises()
    await leitor.findAll('footer button')[1].trigger('click')
    abrirEpub.mock.calls[0][0].aoMudar({ posicao: 'epubcfi(/6/4)', percentual: 0.25, capitulo: '', rotulo: '' })
    leitor.unmount()
    expect(salvamentos()).toHaveLength(1)
    expect(salvamentos()[0][1].keepalive).toBe(true)
    expect(motor.destruir).toHaveBeenCalled()
  })

  it('mostra o sumário, marca o capítulo atual e navega', async () => {
    const motor = motorFalso([
      { rotulo: 'Capítulo 1', destino: 'c1.xhtml', nivel: 0 },
      { rotulo: 'Capítulo 2', destino: 'c2.xhtml', nivel: 1 },
    ])
    abrirEpub.mockResolvedValue(motor)
    const leitor = mount(Leitor, { props: { livro } })
    await flushPromises()
    abrirEpub.mock.calls[0][0].aoMudar({ posicao: 'x', percentual: 0, capitulo: 'c2.xhtml', rotulo: 'Capítulo 2' })
    await leitor.findAll('header button').find((b) => b.text() === 'Sumário').trigger('click')
    expect(leitor.get('.sumario [aria-current]').text()).toBe('Capítulo 2')
    await leitor.findAll('.sumario button')[0].trigger('click')
    expect(motor.irPara).toHaveBeenCalledWith('c1.xhtml')
    expect(leitor.find('.sumario').exists()).toBe(false)
    leitor.unmount()
  })

  it('aplica os ajustes de leitura e respeita os limites', async () => {
    preferencias.fonte = 190
    preferencias.margem = 'media'
    const motor = motorFalso()
    abrirEpub.mockResolvedValue(motor)
    const leitor = mount(Leitor, { props: { livro } })
    await flushPromises()
    await leitor.findAll('header button').find((b) => b.text() === 'Ajustes').trigger('click')

    await leitor.get('[aria-label="Aumentar fonte"]').trigger('click')
    await flushPromises()
    expect(preferencias.fonte).toBe(200)
    expect(motor.aplicar).toHaveBeenCalled()
    expect(leitor.get('[aria-label="Aumentar fonte"]').attributes('disabled')).toBeDefined()

    await leitor.findAll('.opcoes button').find((b) => b.text() === 'Grande').trigger('click')
    await flushPromises()
    expect(leitor.get('.area').classes()).toContain('margem-grande')
    expect(motor.redimensionar).toHaveBeenCalled()
    preferencias.fonte = 100
    preferencias.margem = 'media'
    leitor.unmount()
  })

  it('no PDF, troca fonte e margens por zoom', async () => {
    abrirPdf.mockResolvedValue(motorFalso())
    const leitor = mount(Leitor, { props: { livro: { ...livro, format: 'pdf' } } })
    await flushPromises()
    await leitor.findAll('header button').find((b) => b.text() === 'Ajustes').trigger('click')
    expect(leitor.find('[aria-label="Aumentar zoom"]').exists()).toBe(true)
    expect(leitor.find('[aria-label="Aumentar fonte"]').exists()).toBe(false)
    expect(leitor.text()).not.toContain('Margens')
    leitor.unmount()
  })

  it('mostra erro quando o livro não abre', async () => {
    abrirEpub.mockRejectedValue(new Error('arquivo inválido'))
    const leitor = mount(Leitor, { props: { livro } })
    await flushPromises()
    expect(leitor.text()).toContain('Não foi possível abrir este livro')
  })
})
