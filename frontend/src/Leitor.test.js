import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { abrirEpub } from './motores/epub.js'
import { abrirPdf } from './motores/pdf.js'
import { sincronizar, tentarRedeDeNovo } from './dados.js'
import { preferencias } from './preferencias.js'
import Leitor from './Leitor.vue'

vi.mock('./motores/epub.js', () => ({ abrirEpub: vi.fn() }))
vi.mock('./motores/pdf.js', () => ({ abrirPdf: vi.fn() }))
vi.mock('./motores/embutir.js', () => ({}))

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
    irParaPercentual: vi.fn(),
    irParaAncora: vi.fn(),
    marcar: vi.fn(),
    limparSelecao: vi.fn(),
    destruir: vi.fn(),
  }
}

function stubProgresso(salvo = { position: '', percent: 0 }, anotacoes = []) {
  vi.stubGlobal('fetch', vi.fn(async (url) => ({
    ok: true,
    status: 200,
    json: async () => (String(url).endsWith('/annotations') ? anotacoes : salvo),
  })))
}

function salvamentos() {
  return fetch.mock.calls.filter(([, opcoes]) => opcoes?.method === 'PUT')
}

describe('Leitor', () => {
  beforeEach(() => {
    localStorage.clear()
    tentarRedeDeNovo()
    abrirEpub.mockReset()
    abrirPdf.mockReset()
    stubProgresso()
  })
  afterEach(async () => {
    vi.useRealTimers()
    await sincronizar()
    vi.unstubAllGlobals()
  })

  it('abre o motor do formato do livro na posição salva', async () => {
    stubProgresso({ position: 'epubcfi(/6/8)', percent: 0.5 })
    abrirEpub.mockResolvedValue(motorFalso())
    mount(Leitor, { props: { livro } })
    await flushPromises()
    expect(fetch.mock.calls.map(([url]) => url)).toContain(urlProgresso)
    expect(abrirEpub.mock.calls[0][0].posicao).toBe('epubcfi(/6/8)')
    expect(abrirEpub.mock.calls[0][0].percentualSalvo).toBe(0.5)
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

    // Virar a página pelas laterais já esconde os controles; o centro os traz de volta.
    await flushPromises()
    expect(leitor.get('header').classes()).toContain('oculto')
    aoClicar(window.innerWidth * 0.5)
    await flushPromises()
    expect(leitor.get('header').classes()).not.toContain('oculto')
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
    expect(JSON.parse(salvos[0][1].body)).toMatchObject({ position: 'epubcfi(/6/6)', percent: 0.5 })
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
    await leitor.findAll('header button').find((b) => b.attributes('aria-label') === 'Sumário').trigger('click')
    expect(leitor.get('.sumario [aria-current]').text()).toBe('Capítulo 2')
    await leitor.findAll('.sumario li button')[0].trigger('click')
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
    await leitor.findAll('header button').find((b) => b.attributes('aria-label') === 'Ajustes').trigger('click')

    await leitor.get('[aria-label="Aumentar fonte"]').trigger('click')
    await flushPromises()
    expect(preferencias.fonte).toBe(200)
    expect(motor.aplicar).toHaveBeenCalled()
    expect(leitor.get('[aria-label="Aumentar fonte"]').attributes('disabled')).toBeDefined()

    motor.aplicar.mockClear()
    await leitor.findAll('.opcoes button').find((b) => b.text() === 'Grande').trigger('click')
    await flushPromises()
    expect(preferencias.margem).toBe('grande')
    expect(motor.aplicar).toHaveBeenCalledTimes(1)
    preferencias.fonte = 100
    preferencias.margem = 'media'
    leitor.unmount()
  })

  it('no PDF, troca fonte e margens por zoom', async () => {
    abrirPdf.mockResolvedValue(motorFalso())
    const leitor = mount(Leitor, { props: { livro: { ...livro, format: 'pdf' } } })
    await flushPromises()
    await leitor.findAll('header button').find((b) => b.attributes('aria-label') === 'Ajustes').trigger('click')
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

  it('a leitura por gesto conta como navegação e devolve a tela ao texto', async () => {
    vi.useFakeTimers()
    abrirEpub.mockResolvedValue(motorFalso())
    const leitor = mount(Leitor, { props: { livro } })
    await flushPromises()
    const { aoMudar } = abrirEpub.mock.calls[0][0]
    aoMudar({ posicao: 'p1', percentual: 0.1, capitulo: '', rotulo: '' }, false)
    await flushPromises()
    expect(leitor.get('header').classes()).not.toContain('oculto')

    aoMudar({ posicao: 'p2', percentual: 0.2, capitulo: '', rotulo: '' }, true)
    await flushPromises()
    expect(leitor.get('header').classes()).toContain('oculto')
    vi.advanceTimersByTime(1000)
    expect(JSON.parse(salvamentos()[0][1].body).position).toBe('p2')
    leitor.unmount()
  })

  it('a barra de progresso salta pelo motor', async () => {
    const motor = motorFalso()
    abrirEpub.mockResolvedValue(motor)
    const leitor = mount(Leitor, { props: { livro } })
    await flushPromises()
    const barra = leitor.get('input[type="range"]')
    await barra.setValue(250)
    await barra.trigger('change')
    expect(motor.irParaPercentual).toHaveBeenCalledWith(0.25)
    leitor.unmount()
  })

  it('cria a marcação pela seleção, com a cor escolhida', async () => {
    const motor = motorFalso()
    abrirEpub.mockResolvedValue(motor)
    const leitor = mount(Leitor, { props: { livro } })
    await flushPromises()
    const { aoSelecionar } = abrirEpub.mock.calls[0][0]

    aoSelecionar({ texto: 'um trecho', ancora: '{"a":1}', percentual: 0.3, rotulo: 'Cap 1' })
    await flushPromises()
    await leitor.get('[aria-label="Marcar em verde"]').trigger('click')
    await flushPromises()

    expect(motor.limparSelecao).toHaveBeenCalled()
    expect(motor.marcar.mock.lastCall[0]).toHaveLength(1)
    expect(motor.marcar.mock.lastCall[0][0]).toMatchObject({ color: 'verde', quote: 'um trecho', anchor: '{"a":1}', label: 'Cap 1', percent: 0.3 })
    expect(leitor.find('.selecao').exists()).toBe(false)
    const [url, opcoes] = salvamentos().at(-1)
    expect(url).toContain('/api/books/quincas%20borba/annotations/')
    expect(JSON.parse(opcoes.body).quote).toBe('um trecho')
    leitor.unmount()
  })

  it('a barra fica junto do trecho, acima dele ou abaixo se não couber', async () => {
    abrirEpub.mockResolvedValue(motorFalso())
    const leitor = mount(Leitor, { props: { livro } })
    await flushPromises()
    const { aoSelecionar } = abrirEpub.mock.calls[0][0]
    aoSelecionar({ texto: 'x', ancora: '{}', percentual: 0, rotulo: '', caixa: { topo: 300, base: 320 } })
    await flushPromises()
    expect(leitor.get('.selecao').attributes('style')).toContain('top: 236px')
    aoSelecionar({ texto: 'x', ancora: '{}', percentual: 0, rotulo: '', caixa: { topo: 20, base: 40 } })
    await flushPromises()
    expect(leitor.get('.selecao').attributes('style')).toContain('top: 68px')
    leitor.unmount()
  })

  it('copia e pesquisa o trecho e desfaz a seleção, sem criar marcação', async () => {
    const motor = motorFalso()
    abrirEpub.mockResolvedValue(motor)
    const writeText = vi.fn(async () => {})
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    vi.stubGlobal('open', vi.fn())
    const leitor = mount(Leitor, { props: { livro } })
    await flushPromises()
    const { aoSelecionar } = abrirEpub.mock.calls[0][0]

    aoSelecionar({ texto: 'um trecho', ancora: '{}', percentual: 0, rotulo: '' })
    await flushPromises()
    await leitor.get('[aria-label="Copiar"]').trigger('click')
    expect(writeText).toHaveBeenCalledWith('um trecho')
    expect(leitor.find('.selecao').exists()).toBe(false)

    aoSelecionar({ texto: 'um trecho', ancora: '{}', percentual: 0, rotulo: '' })
    await flushPromises()
    await leitor.get('[aria-label="Pesquisar na Web"]').trigger('click')
    expect(window.open).toHaveBeenCalledWith('https://www.google.com/search?q=um%20trecho', '_blank', 'noopener')
    expect(motor.limparSelecao).toHaveBeenCalledTimes(2)
    expect(salvamentos()).toHaveLength(0)
    leitor.unmount()
  })

  it('desfazer a seleção esconde as cores', async () => {
    abrirEpub.mockResolvedValue(motorFalso())
    const leitor = mount(Leitor, { props: { livro } })
    await flushPromises()
    const { aoSelecionar } = abrirEpub.mock.calls[0][0]
    aoSelecionar({ texto: 'x', ancora: '{}', percentual: 0, rotulo: '' })
    await flushPromises()
    expect(leitor.find('.selecao').exists()).toBe(true)
    aoSelecionar(null)
    await flushPromises()
    expect(leitor.find('.selecao').exists()).toBe(false)
    leitor.unmount()
  })

  it('edita a nota e a cor ao tocar na marcação, e apaga', async () => {
    stubProgresso(undefined, [{ id: 'm1', color: 'azul', note: '', quote: 'q', anchor: '{}', label: '', percent: 0.1, created_at: 'x' }])
    const motor = motorFalso()
    abrirEpub.mockResolvedValue(motor)
    const leitor = mount(Leitor, { props: { livro } })
    await flushPromises()
    expect(motor.marcar.mock.lastCall[0]).toHaveLength(1)

    abrirEpub.mock.calls[0][0].aoTocarMarcacao('m1')
    await flushPromises()
    await leitor.get('[aria-label="Mudar para rosa"]').trigger('click')
    await leitor.get('textarea').setValue('minha nota')
    await leitor.findAll('.edicao .acoes button').find((b) => b.text() === 'Concluir').trigger('click')
    // A cor e a nota sobem uma de cada vez, pela fila
    await vi.waitFor(() => {
      expect(JSON.parse(salvamentos().at(-1)[1].body)).toMatchObject({ id: 'm1', color: 'rosa', note: 'minha nota' })
    })

    abrirEpub.mock.calls[0][0].aoTocarMarcacao('m1')
    await flushPromises()
    await leitor.findAll('.edicao .acoes button').find((b) => b.text() === 'Apagar').trigger('click')
    await flushPromises()
    expect(motor.marcar.mock.lastCall[0]).toHaveLength(0)
    await vi.waitFor(() => {
      expect(fetch.mock.calls.some(([url, opcoes]) => opcoes?.method === 'DELETE' && url.endsWith('/annotations/m1'))).toBe(true)
    })
    leitor.unmount()
  })

  it('lista as marcações e vai até o trecho', async () => {
    const marca = { id: 'm1', color: 'azul', note: 'nota', quote: 'citação', anchor: '{"x":1}', label: 'Cap', percent: 0.42, created_at: 'x' }
    stubProgresso(undefined, [marca])
    const motor = motorFalso()
    abrirEpub.mockResolvedValue(motor)
    const leitor = mount(Leitor, { props: { livro } })
    await flushPromises()
    await leitor.findAll('header button').find((b) => b.attributes('aria-label') === 'Sumário').trigger('click')
    await leitor.findAll('.abas button').find((b) => b.text() === 'Marcações').trigger('click')
    expect(leitor.get('.marcacoes').text()).toContain('citação')
    expect(leitor.get('.marcacoes').text()).toContain('nota')
    expect(leitor.get('.marcacoes').text()).toContain('Cap · 42%')
    await leitor.get('.marcacoes button').trigger('click')
    expect(motor.irParaAncora).toHaveBeenCalledWith('{"x":1}')
    expect(leitor.find('.sumario').exists()).toBe(false)
    leitor.unmount()
  })
})
