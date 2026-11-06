import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import BuscarLivros from './BuscarLivros.vue'

const sites = [
  { id: 1, name: 'SciELO Livros', url: 'https://books.scielo.org', note: 'Acadêmicos', created_at: '' },
  { id: 2, name: 'Wikisource em português', url: 'https://pt.wikisource.org', note: '', created_at: '' },
]

function resposta(corpo, status = 200) {
  return { ok: status < 400, status, json: async () => corpo }
}

beforeEach(() => localStorage.clear())
afterEach(() => vi.unstubAllGlobals())

describe('BuscarLivros', () => {
  it('lista os sites com link que abre em outra aba', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => resposta(sites)))
    const pagina = mount(BuscarLivros)
    await flushPromises()
    const links = pagina.findAll('.links a')
    expect(links).toHaveLength(2)
    expect(links[0].attributes('href')).toBe('https://books.scielo.org')
    expect(links[0].attributes('target')).toBe('_blank')
    expect(links[0].attributes('rel')).toContain('noopener')
    expect(links[0].text()).toContain('Acadêmicos')
    expect(pagina.find('form').exists()).toBe(false)
  })

  it('ADD abre o formulário e o site novo entra na lista', async () => {
    const fetch = vi.fn(async (_url, opcoes) =>
      opcoes?.method === 'POST'
        ? resposta({ id: 3, name: 'Acervo', url: 'https://acervo.org', note: '', created_at: '' }, 201)
        : resposta(sites),
    )
    vi.stubGlobal('fetch', fetch)
    const pagina = mount(BuscarLivros)
    await flushPromises()
    await pagina.get('button.add').trigger('click')
    await pagina.get('input[type="url"]').setValue('https://acervo.org')
    await pagina.get('form').trigger('submit')
    await flushPromises()

    expect(JSON.parse(fetch.mock.calls[1][1].body).url).toBe('https://acervo.org')
    expect(pagina.findAll('.links a').map((a) => a.text())).toEqual([
      expect.stringContaining('Acervo'),
      expect.stringContaining('SciELO'),
      expect.stringContaining('Wikisource'),
    ])
    expect(pagina.find('form').exists()).toBe(false)
  })

  it('mostra o erro do servidor ao adicionar', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url, opcoes) =>
      opcoes?.method === 'POST' ? resposta({ error: 'esse endereço já está na lista' }, 409) : resposta(sites),
    ))
    const pagina = mount(BuscarLivros)
    await flushPromises()
    await pagina.get('button.add').trigger('click')
    await pagina.get('input[type="url"]').setValue('https://books.scielo.org')
    await pagina.get('form').trigger('submit')
    await flushPromises()
    expect(pagina.get('[role="alert"]').text()).toBe('esse endereço já está na lista')
    expect(pagina.find('form').exists()).toBe(true)
  })

  it('sem conexão, mostra a última lista vista', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => resposta(sites)))
    mount(BuscarLivros).unmount()
    await flushPromises()

    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline') }))
    const pagina = mount(BuscarLivros)
    await flushPromises()
    expect(pagina.text()).toContain('Sem conexão')
    expect(pagina.findAll('.links a')).toHaveLength(2)
  })
})
