// Girar a tela no leitor (R40). Por padrão o leitor segue o celular; "Em pé" e "Deitado" travam a
// tela pela Screen Orientation API. No Chrome do Android a trava costuma pedir tela cheia (no app
// instalado às vezes não pede): tenta travar direto e, se não der, entra em tela cheia e tenta de
// novo. Entrar em tela cheia só vale a partir de um toque, então quem chama faz isso num toque.

export const ORIENTACOES = [
  { valor: 'auto', rotulo: 'Automático' },
  { valor: 'em-pe', rotulo: 'Em pé' },
  { valor: 'deitado', rotulo: 'Deitado' },
]

const TIPOS = { 'em-pe': 'portrait', deitado: 'landscape' }

// Se a tela cheia foi aberta aqui (para travar), "Automático" ou sair do leitor fecha.
let telaCheiaNossa = false

const orientacao = () => globalThis.screen?.orientation

// podeGirar: o aparelho tem a trava de orientação e é de toque. No computador o Chrome também
// tem a função, mas sempre recusa; no iPhone ela não existe.
export function podeGirar() {
  const o = orientacao()
  const toque = globalThis.matchMedia?.('(pointer: coarse)').matches ?? false
  return Boolean(o && typeof o.lock === 'function' && toque)
}

// temGesto: o navegador ainda considera que houve um toque há pouco (sem isso, a tela cheia é
// recusada). Sem a API de ativação, tenta assim mesmo.
export function temGesto() {
  const ativacao = globalThis.navigator?.userActivation
  return ativacao ? ativacao.isActive : true
}

async function entrarEmTelaCheia() {
  const doc = globalThis.document
  if (doc.fullscreenElement || !doc.fullscreenEnabled) return false
  await doc.documentElement.requestFullscreen({ navigationUI: 'hide' })
  telaCheiaNossa = true
  return true
}

export async function sairDaTelaCheiaNossa() {
  const doc = globalThis.document
  const era = telaCheiaNossa
  telaCheiaNossa = false
  if (era && doc.fullscreenElement) await doc.exitFullscreen().catch(() => {})
}

// soltar: volta a seguir o celular e fecha a tela cheia que foi aberta para travar.
export async function soltar() {
  try {
    orientacao()?.unlock?.()
  } catch {
    // Sem trava ativa, ou sem a API: nada a soltar.
  }
  await sairDaTelaCheiaNossa()
}

// aplicarOrientacao devolve { ok: true } ou { ok: false, motivo }, com motivo
// 'sem-suporte' (o aparelho não trava), 'sem-gesto' (falta um toque) ou 'falhou'.
export async function aplicarOrientacao(escolha) {
  if (escolha === 'auto' || !TIPOS[escolha]) {
    await soltar()
    return { ok: true }
  }
  const o = orientacao()
  if (!o || typeof o.lock !== 'function') return { ok: false, motivo: 'sem-suporte' }
  try {
    await o.lock(TIPOS[escolha])
    return { ok: true }
  } catch (primeira) {
    // Já em tela cheia, ou sem como entrar nela: não há o que tentar de novo.
    const doc = globalThis.document
    if (doc?.fullscreenElement || !doc?.fullscreenEnabled) return { ok: false, motivo: motivoDe(primeira) }
  }
  // A trava pede tela cheia: entra (precisa de um toque recente) e tenta de novo.
  if (!temGesto()) return { ok: false, motivo: 'sem-gesto' }
  let entrou = false
  try {
    entrou = await entrarEmTelaCheia()
    await o.lock(TIPOS[escolha])
    return { ok: true }
  } catch (falha) {
    if (entrou) await sairDaTelaCheiaNossa()
    return { ok: false, motivo: entrou ? motivoDe(falha) : 'sem-gesto' }
  }
}

function motivoDe(falha) {
  if (falha?.name === 'NotSupportedError') return 'sem-suporte'
  return 'falhou'
}
