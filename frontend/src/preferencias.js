import { reactive, watch } from 'vue'

// Ficam em cada aparelho: o tamanho de letra bom no celular não é o mesmo do computador.
const CHAVE = 'biblioteca-preferencias'

export const FONTE = { minimo: 80, maximo: 200, passo: 10 }
export const ZOOM = { minimo: 100, maximo: 300, passo: 25 }

function temaDoSistema() {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'escuro' : 'claro'
}

function carregar() {
  const padrao = { tema: temaDoSistema(), fonte: 100, margem: 'media', zoom: 100 }
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
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', tema === 'escuro' ? '#14171b' : '#1f3a5f')
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
