import { reactive, watch } from 'vue'

// Ficam em cada aparelho: o tamanho de letra bom no celular não é o mesmo do computador.
const CHAVE = 'biblioteca-preferencias'

export const FONTE = { minimo: 80, maximo: 200, passo: 10 }
export const ZOOM = { minimo: 100, maximo: 300, passo: 25 }

// As mesmas cores de style.css, aqui para chegarem ao texto dentro do iframe do livro.
export const TEMAS = {
  claro: { rotulo: 'Claro', fundo: '#fbfaf8', texto: '#1b1b1a', link: '#33608c' },
  sepia: { rotulo: 'Sépia', fundo: '#f4eee3', texto: '#3b3128', link: '#355d84' },
  escuro: { rotulo: 'Escuro', fundo: '#131312', texto: '#e7e5e0', link: '#8eb1d6' },
}

// Ajustes que cada livro guarda para si: mudar a fonte de um livro não mexe nos outros.
export const AJUSTES_DO_LIVRO = ['tema', 'fonte', 'familia', 'entrelinhas', 'alinhamento', 'margem', 'zoom']

// Estilos prontos: um toque aplica fonte, fundo, cor, tamanho e espaçamento de uma vez.
// "Acervo" reproduz a leitura do app Acervo (Literata, 17,6 px, entrelinha 1,72, fundo do
// design system, claro ou escuro como o aparelho). É também o padrão de um livro novo.
export const ESTILOS = {
  acervo: {
    rotulo: 'Acervo',
    ajustes: () => ({
      tema: temaDoSistema(),
      fonte: 110,
      familia: 'literata',
      entrelinhas: 'confortavel',
      alinhamento: 'esquerda',
      margem: 'pequena',
      zoom: 100,
    }),
  },
}

function temaDoSistema() {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'escuro' : 'claro'
}

function carregar() {
  const padrao = {
    // Tema das telas do app; dentro de um livro vale o tema do livro.
    tema: temaDoSistema(),
    // Ajustes de leitura por id do livro (os campos de AJUSTES_DO_LIVRO).
    livros: {},
    // Livros em PDF lidos no modo texto, por id: cada PDF tem um jeito, e a escolha é por livro.
    textoPdf: {},
  }
  try {
    const salvo = JSON.parse(localStorage.getItem(CHAVE)) ?? {}
    // Ajustes antigos, que valiam para todos os livros, não passam para os livros: cada um
    // começa no estilo Acervo.
    for (const chave of AJUSTES_DO_LIVRO) if (chave !== 'tema') delete salvo[chave]
    return { ...padrao, ...salvo }
  } catch {
    return padrao
  }
}

export const preferencias = reactive(carregar())

/** Ajustes do livro: o estilo Acervo com o que foi mudado neste livro por cima. */
export function ajustesDoLivro(id) {
  return { ...ESTILOS.acervo.ajustes(), ...preferencias.livros?.[id] }
}

/** Guarda os ajustes inteiros do livro, para não mudarem se o padrão mudar depois. */
export function guardarAjustes(id, ajustes) {
  const proprios = Object.fromEntries(AJUSTES_DO_LIVRO.map((chave) => [chave, ajustes[chave]]))
  preferencias.livros = { ...preferencias.livros, [id]: proprios }
}

export function mostrarTema(tema) {
  document.documentElement.dataset.theme = tema
  // A barra do Android acompanha o fundo, para nada competir com o texto.
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', TEMAS[tema]?.fundo ?? '#fbfaf8')
}

watch(() => preferencias.tema, mostrarTema, { immediate: true })

watch(preferencias, () => {
  try {
    localStorage.setItem(CHAVE, JSON.stringify(preferencias))
  } catch {
    // Sem armazenamento (janela privada, por exemplo), vale só nesta sessão.
  }
})
