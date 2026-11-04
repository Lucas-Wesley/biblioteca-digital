import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import App from './App.vue'

afterEach(() => vi.unstubAllGlobals())

describe('App', () => {
  it('mostra o Hello World e a versão da API', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ status: 'ok', version: 'abcdef1234' }),
    })))
    const app = mount(App)
    await flushPromises()
    expect(app.get('h1').text()).toBe('Hello World')
    expect(app.text()).toContain('versão abcdef1')
  })

  it('avisa quando a API está indisponível', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    const app = mount(App)
    await flushPromises()
    expect(app.text()).toContain('API indisponível')
  })
})
