import { describe, expect, it, vi } from 'vitest'
import { palavraEm, selecaoPorToqueDisponivel } from './selecao-toque.js'

describe('seleção por toque', () => {
  it('acha a palavra em volta do toque, com acentos e sem pontuação', () => {
    const texto = 'Pobre Minas! Rubião voltou.'
    expect(palavraEm(texto, 2)).toEqual([0, 5])
    expect(palavraEm(texto, 8)).toEqual([6, 11])
    expect(palavraEm(texto, 15)).toEqual([13, 19])
  })

  it('um toque em espaço ou pontuação não seleciona', () => {
    expect(palavraEm('duas palavras', 4)).toBeNull()
    expect(palavraEm('fim!', 3)).toBeNull()
  })

  it('só assume no toque, e com a API de destaque disponível', () => {
    const com = (coarse, highlights, caret) => ({
      matchMedia: vi.fn(() => ({ matches: coarse })),
      CSS: highlights ? { highlights: new Map() } : {},
      document: caret ? { caretRangeFromPoint: () => null } : {},
    })
    expect(selecaoPorToqueDisponivel(com(true, true, true))).toBe(true)
    expect(selecaoPorToqueDisponivel(com(false, true, true))).toBe(false)
    expect(selecaoPorToqueDisponivel(com(true, false, true))).toBe(false)
    expect(selecaoPorToqueDisponivel(com(true, true, false))).toBe(false)
  })
})
