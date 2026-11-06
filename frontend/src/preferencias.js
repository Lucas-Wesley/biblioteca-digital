import { reactive, watch } from 'vue'

// Ficam em cada aparelho: o tamanho de letra bom no celular não é o mesmo do computador.
const CHAVE = 'biblioteca-preferencias'

export const FONTE = { minimo: 80, maximo: 200, passo: 10 }
export const ZOOM = { minimo: 100, maximo: 300, passo: 25 }

// As mesmas cores de style.css, aqui para chegarem ao texto dentro do iframe do livro.
export const TEMAS = {
  claro: { rotulo: 'Claro', fundo: '#ffffff', texto: '#1d1d1f', link: '#0066cc' },
  sepia: { rotulo: 'Sépia', fundo: '#f6f0e2', texto: '#3f3324', link: '#8a5a1e' },
  escuro: { rotulo: 'Escuro', fundo: '#131315', texto: '#d9d9de', link: '#6eb1ff' },
}

function temaDoSistema() {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'escuro' : 'claro'
}

function carregar() {
  const padrao = {
    tema: temaDoSistema(),
    fonte: 100,
    familia: 'literata',
    entrelinhas: 'normal',
    alinhamento: 'esquerda',
    margem: 'media',
    zoom: 100,
    // Livros em PDF lidos no modo texto, por id: cada PDF tem um jeito, e a escolha é por livro.
    textoPdf: {},
  }
  try {
    return { ...padrao, ...JSON.parse(localStorage.getItem(CHAVE)) }
  } catch {
    return padrao
  }
}

export const preferencias = reactive(carregar())

watch(
  () => preferencias.tema,
  (tema) => {
    document.documentElement.dataset.theme = tema
    // A barra do Android acompanha o fundo, para nada competir com o texto.
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', TEMAS[tema]?.fundo ?? '#ffffff')
  },
  { immediate: true },
)

watch(preferencias, () => {
  try {
    localStorage.setItem(CHAVE, JSON.stringify(preferencias))
  } catch {
    // Sem armazenamento (janela privada, por exemplo), vale só nesta sessão.
  }
})
