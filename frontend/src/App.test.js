import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import App from './App.vue'

vi.mock('./Leitor.vue', () => ({
  default: { props: ['livro'], template: '<div class="leitor-falso">{{ livro.id }}</div>' },
}))

afterEach(() => vi.unstubAllGlobals())

function stubApi(livros) {
  vi.stubGlobal('fetch', vi.fn(async (url) => ({
    ok: true,
    json: async () => (url === '/api/health' ? { status: 'ok', version: 'abcdef1234' } : livros),
  })))
}

async function escolherArquivos(app, arquivos) {
  const campo = app.get('input[type="file"]')
  Object.defineProperty(campo.element, 'files', { value: arquivos, configurable: true })
  await campo.trigger('change')
}

describe('App', () => {
  it('mostra o Hello World e a versão da API', async () => {
    stubApi([])
    const app = mount(App)
    await flushPromises()
    expect(app.get('h1').text()).toBe('Hello World')
    expect(app.text()).toContain('versão abcdef1')
    expect(app.text()).toContain('Nenhum livro encontrado')
  })

  it('abre o leitor ao escolher um livro', async () => {
    stubApi([{ id: 'quincas-borba.epub', title: 'Quincas Borba' }])
    const app = mount(App)
    await flushPromises()
    await app.get('.livros button').trigger('click')
    expect(app.get('.leitor-falso').text()).toBe('quincas-borba.epub')
  })

  it('mostra autor e capa e ordena pelo título em português', async () => {
    stubApi([
      { id: 'b', title: 'Zadig', author: '', has_cover: false },
      { id: 'a', title: 'Água Viva', author: 'Clarice Lispector', has_cover: true },
    ])
    const app = mount(App)
    await flushPromises()
    const itens = app.findAll('.livros button')
    expect(itens[0].text()).toContain('Água Viva')
    expect(itens[0].text()).toContain('Clarice Lispector')
    expect(itens[0].get('img').attributes('src')).toBe('/api/books/a/cover')
    expect(itens[1].find('img').exists()).toBe(false)
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
    expect(app.get('.livros').text()).toContain('Livro Novo')
    expect(app.text()).toContain('1 livro adicionado')
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

  it('avisa quando a API está indisponível', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    const app = mount(App)
    await flushPromises()
    expect(app.text()).toContain('API indisponível')
  })
})
