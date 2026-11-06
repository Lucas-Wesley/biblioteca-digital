import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { lerMetadadosPdf } from './motores/pdf.js'
import { tentarRedeDeNovo } from './dados.js'
import { baixarLivro, livrosBaixados, removerDownload } from './offline.js'
import { preferencias } from './preferencias.js'
import App from './App.vue'

vi.mock('./Leitor.vue', () => ({
  default: {
    props: ['livro'],
    emits: ['fechar'],
    template: `<div class="leitor-falso"><button @click="$emit('fechar')">{{ livro.id }}</button></div>`,
  },
}))
vi.mock('./motores/pdf.js', () => ({ lerMetadadosPdf: vi.fn() }))
vi.mock('./offline.js', () => ({
  baixarLivro: vi.fn(async () => {}),
  removerDownload: vi.fn(async () => {}),
  livrosBaixados: vi.fn(async () => new Set()),
}))

beforeEach(() => {
  localStorage.clear()
  tentarRedeDeNovo()
  livrosBaixados.mockResolvedValue(new Set())
})

afterEach(() => {
  vi.unstubAllGlobals()
  location.hash = ''
})

function stubApi(livros) {
  vi.stubGlobal('fetch', vi.fn(async (url) => ({
    ok: true,
    status: 200,
    json: async () => (url === '/api/health' ? { status: 'ok', version: 'abcdef1234' } : livros),
  })))
}

async function escolherArquivos(app, arquivos) {
  const campo = app.get('input[type="file"]')
  Object.defineProperty(campo.element, 'files', { value: arquivos, configurable: true })
  await campo.trigger('change')
}

describe('App', () => {
  it('mostra o início no menu e a versão da API', async () => {
    stubApi([])
    const app = mount(App)
    await flushPromises()
    expect(app.get('h1').text()).toBe('Início')
    expect(app.get('nav').text()).toContain('Início')
    expect(app.get('nav').text()).toContain('Enviar arquivo')
    expect(app.text()).toContain('versão abcdef1')
    expect(app.text()).toContain('Nenhum livro ainda')
  })

  it('Buscar livros no menu abre a lista de sites', async () => {
    stubApi([])
    const app = mount(App)
    await flushPromises()
    const item = app.findAll('nav button').find((botao) => botao.text() === 'Buscar livros')
    await item.trigger('click')
    expect(app.get('h1').text()).toBe('Buscar livros')
    expect(item.attributes('aria-current')).toBe('page')
    expect(app.find('button.add').text()).toBe('ADD')
  })

  it('abre o leitor ao escolher um livro e fecha pelo Voltar', async () => {
    stubApi([{ id: 'a b', title: 'Quincas Borba', format: 'epub' }])
    const app = mount(App)
    await flushPromises()
    await app.get('.livros .abrir').trigger('click')
    expect(app.get('.leitor-falso').text()).toBe('a b')
    expect(location.hash).toBe('#/livro/a%20b')
    await app.get('.leitor-falso button').trigger('click')
    expect(app.find('.leitor-falso').exists()).toBe(false)
  })

  it('reabre o livro do endereço ao recarregar', async () => {
    location.hash = '#/livro/x'
    stubApi([{ id: 'x', title: 'Livro', format: 'epub' }])
    const app = mount(App)
    await flushPromises()
    expect(app.get('.leitor-falso').text()).toBe('x')
  })

  it('mostra autor, capa e formato e ordena pelo título em português', async () => {
    stubApi([
      { id: 'b', title: 'Zadig', author: '', format: 'pdf', has_cover: false },
      { id: 'a', title: 'Água Viva', author: 'Clarice Lispector', format: 'epub', has_cover: true },
    ])
    const app = mount(App)
    await flushPromises()
    const itens = app.findAll('.livros .abrir')
    expect(itens[0].text()).toContain('Água Viva')
    expect(itens[0].text()).toContain('Clarice Lispector')
    expect(itens[0].get('img').attributes('src')).toBe('/api/books/a/cover')
    expect(itens[1].find('img').exists()).toBe(false)
    expect(itens[1].get('.titulo-na-capa').text()).toBe('Zadig')
    expect(itens[1].get('.formato').text()).toBe('PDF')
  })

  it('envia os arquivos e acrescenta os livros à lista', async () => {
    stubApi([])
    const app = mount(App)
    await flushPromises()
    fetch.mockImplementationOnce(async (url, opcoes) => {
      expect(url).toBe('/api/books')
      expect(opcoes.method).toBe('POST')
      expect(opcoes.body.get('file').name).toBe('novo.epub')
      return { ok: true, json: async () => ({ id: 'n', title: 'Livro Novo', author: '', has_cover: false }) }
    })
    await escolherArquivos(app, [new File(['x'], 'novo.epub')])
    await flushPromises()
    expect(lerMetadadosPdf).not.toHaveBeenCalled()
    expect(app.get('.livros').text()).toContain('Livro Novo')
    expect(app.text()).toContain('1 livro adicionado')
  })

  it('envia o PDF com os metadados lidos no navegador', async () => {
    stubApi([])
    const app = mount(App)
    await flushPromises()
    lerMetadadosPdf.mockResolvedValueOnce({ titulo: 'Título', autor: 'Autora', capa: new Blob(['c']) })
    let corpo
    fetch.mockImplementationOnce(async (_url, opcoes) => {
      corpo = opcoes.body
      return { ok: true, json: async () => ({ id: 'p', title: 'Título', format: 'pdf' }) }
    })
    await escolherArquivos(app, [new File(['x'], 'livro.PDF')])
    await vi.waitFor(() => expect(corpo).toBeDefined())
    expect(corpo.get('title')).toBe('Título')
    expect(corpo.get('author')).toBe('Autora')
    expect(corpo.get('cover')).toBeInstanceOf(Blob)
  })

  it('envia o PDF mesmo sem conseguir ler os metadados', async () => {
    stubApi([])
    const app = mount(App)
    await flushPromises()
    lerMetadadosPdf.mockRejectedValueOnce(new Error('protegido'))
    let corpo
    fetch.mockImplementationOnce(async (_url, opcoes) => {
      corpo = opcoes.body
      return { ok: true, json: async () => ({ id: 'p', title: 'Livro', format: 'pdf' }) }
    })
    await escolherArquivos(app, [new File(['x'], 'livro.pdf')])
    await vi.waitFor(() => expect(corpo).toBeDefined())
    expect(corpo.has('title')).toBe(false)
    expect(corpo.get('file').name).toBe('livro.pdf')
  })

  it('mostra a falha de cada arquivo e continua os próximos', async () => {
    stubApi([])
    const app = mount(App)
    await flushPromises()
    fetch
      .mockImplementationOnce(async () => ({ ok: false, json: async () => ({ error: 'não é EPUB' }) }))
      .mockImplementationOnce(async () => ({ ok: true, json: async () => ({ id: 'n', title: 'Bom', author: '' }) }))
    await escolherArquivos(app, [new File(['x'], 'ruim.epub'), new File(['y'], 'bom.epub')])
    await flushPromises()
    expect(app.get('.falha').text()).toBe('ruim.epub: não é EPUB')
    expect(app.get('.livros').text()).toContain('Bom')
  })

  it('muda o tema pelo menu', async () => {
    stubApi([])
    preferencias.tema = 'claro'
    const app = mount(App)
    await flushPromises()
    await app.get('.menu [aria-label="Escuro"]').trigger('click')
    expect(preferencias.tema).toBe('escuro')
    expect(document.documentElement.dataset.theme).toBe('escuro')
    await app.get('.menu [aria-label="Sépia"]').trigger('click')
    expect(document.documentElement.dataset.theme).toBe('sepia')
    preferencias.tema = 'claro'
  })

  it('destaca o livro em andamento mais recente e mostra o progresso nas capas', async () => {
    stubApi([
      { id: 'a', title: 'Antigo', format: 'epub', percent: 0.2, read_at: '2026-01-01T00:00:00.000Z' },
      { id: 'b', title: 'Recente', format: 'epub', percent: 0.4, read_at: '2026-06-01T00:00:00.000Z' },
      { id: 'c', title: 'Lido', format: 'epub', percent: 1, read_at: '2026-07-01T00:00:00.000Z' },
      { id: 'd', title: 'Novo', format: 'epub', percent: 0 },
    ])
    const app = mount(App)
    await flushPromises()
    expect(app.get('.continuar').text()).toContain('Recente')
    expect(app.get('.continuar').text()).toContain('40%')
    expect(app.findAll('.livros .sobre-capa')).toHaveLength(3)
    await app.get('.continuar button').trigger('click')
    expect(app.get('.leitor-falso').text()).toBe('b')
  })

  it('baixa o livro, mostra o andamento e remove', async () => {
    stubApi([{ id: 'a', title: 'Livro', format: 'epub' }])
    const app = mount(App)
    await flushPromises()
    let terminar
    baixarLivro.mockImplementationOnce((_, aoProgresso) => new Promise((resolve) => {
      aoProgresso(0.5)
      terminar = resolve
    }))
    await app.get('[aria-label="Baixar: Livro"]').trigger('click')
    await flushPromises()
    expect(app.get('.baixando').text()).toBe('50%')
    terminar()
    await flushPromises()

    const remover = app.get('[aria-label="Remover download: Livro"]')
    await remover.trigger('click')
    await flushPromises()
    expect(removerDownload).toHaveBeenCalledWith('a')
    expect(app.find('[aria-label="Baixar: Livro"]').exists()).toBe(true)
  })

  it('avisa quando o download falha', async () => {
    stubApi([{ id: 'a', title: 'Livro', format: 'epub' }])
    const app = mount(App)
    await flushPromises()
    baixarLivro.mockRejectedValueOnce(new Error('sem espaço'))
    await app.get('[aria-label="Baixar: Livro"]').trigger('click')
    await flushPromises()
    expect(app.get('.falha').text()).toBe('Livro: não foi possível baixar o livro.')
    expect(app.find('[aria-label="Baixar: Livro"]').exists()).toBe(true)
  })

  it('a vista Baixados mostra só o que está no aparelho', async () => {
    stubApi([{ id: 'a', title: 'Baixado', format: 'epub' }, { id: 'b', title: 'Na nuvem', format: 'epub' }])
    livrosBaixados.mockResolvedValue(new Set(['a']))
    const app = mount(App)
    await flushPromises()
    await app.findAll('nav button').find((b) => b.text() === 'Baixados').trigger('click')
    expect(app.get('h1').text()).toBe('Baixados')
    expect(app.get('.livros').text()).toContain('Baixado')
    expect(app.get('.livros').text()).not.toContain('Na nuvem')
  })

  it('sem esperar a rede, já mostra a última lista vista', async () => {
    stubApi([{ id: 'a', title: 'Guardado', format: 'epub' }])
    mount(App).unmount()
    await flushPromises()
    const primeiro = mount(App)
    await flushPromises()
    primeiro.unmount()

    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    const app = mount(App)
    await flushPromises()
    expect(app.get('.livros').text()).toContain('Guardado')
  })

  it('sem conexão, mostra só os baixados da última lista vista', async () => {
    stubApi([{ id: 'a', title: 'Baixado', format: 'epub' }, { id: 'b', title: 'Na nuvem', format: 'epub' }])
    const primeiro = mount(App)
    await flushPromises()
    primeiro.unmount()

    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    livrosBaixados.mockResolvedValue(new Set(['a']))
    const app = mount(App)
    await flushPromises()
    expect(app.text()).toContain('Sem conexão com a sua rede')
    expect(app.get('.livros').text()).toContain('Baixado')
    expect(app.get('.livros').text()).not.toContain('Na nuvem')
  })
})
