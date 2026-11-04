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

  it('avisa quando a API está indisponível', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    const app = mount(App)
    await flushPromises()
    expect(app.text()).toContain('API indisponível')
  })
})
