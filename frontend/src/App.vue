<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import Leitor from './Leitor.vue'
import { lerMetadadosPdf } from './motores/pdf.js'
import { preferencias } from './preferencias.js'

const versao = ref('')
const apiOk = ref(null)
const livros = ref([])
const idAberto = ref(lerHash())
const menuAberto = ref(false)
const enviando = ref(false)
const adicionados = ref(0)
const falhas = ref([])

// Com a abertura por aqui, o botão Voltar do app equivale ao do celular.
let abertoPorClique = false

const livrosOrdenados = computed(() =>
  [...livros.value].sort((a, b) => a.title.localeCompare(b.title, 'pt-BR')),
)
const livroAberto = computed(() => livros.value.find((livro) => livro.id === idAberto.value))

function lerHash() {
  const achado = location.hash.match(/^#\/livro\/(.+)$/)
  return achado ? decodeURIComponent(achado[1]) : null
}

function aoMudarHash() {
  idAberto.value = lerHash()
}

function abrir(livro) {
  abertoPorClique = true
  idAberto.value = livro.id
  location.hash = `#/livro/${encodeURIComponent(livro.id)}`
}

function fechar() {
  idAberto.value = null
  if (abertoPorClique) history.back()
  else location.hash = ''
  abertoPorClique = false
}

onMounted(async () => {
  window.addEventListener('hashchange', aoMudarHash)
  try {
    const [saude, listaLivros] = await Promise.all([fetch('/api/health'), fetch('/api/books')])
    apiOk.value = saude.ok
    versao.value = (await saude.json()).version
    if (listaLivros.ok) livros.value = await listaLivros.json()
  } catch {
    apiOk.value = false
  }
})

onBeforeUnmount(() => window.removeEventListener('hashchange', aoMudarHash))

async function montarFormulario(arquivo) {
  const formulario = new FormData()
  if (arquivo.name.toLowerCase().endsWith('.pdf')) {
    try {
      const { titulo, autor, capa } = await lerMetadadosPdf(arquivo)
      formulario.append('title', titulo)
      formulario.append('author', autor)
      if (capa) formulario.append('cover', capa, 'capa.jpg')
    } catch (erro) {
      // Sem metadados o PDF ainda entra, com o título vindo do nome do arquivo.
      console.warn('Não foi possível ler os metadados do PDF', erro)
    }
  }
  formulario.append('file', arquivo)
  return formulario
}

async function enviarArquivo(arquivo) {
  try {
    const resposta = await fetch('/api/books', { method: 'POST', body: await montarFormulario(arquivo) })
    const corpo = await resposta.json()
    if (!resposta.ok) throw new Error(corpo.error)
    livros.value.push(corpo)
    adicionados.value++
  } catch (erro) {
    falhas.value.push(`${arquivo.name}: ${erro.message}`)
  }
}

async function enviar(evento) {
  const arquivos = [...evento.target.files]
  // Limpa o campo para o mesmo arquivo poder ser escolhido de novo.
  evento.target.value = ''
  menuAberto.value = false
  enviando.value = true
  adicionados.value = 0
  falhas.value = []
  for (const arquivo of arquivos) await enviarArquivo(arquivo)
  enviando.value = false
}

function alternarTema() {
  preferencias.tema = preferencias.tema === 'escuro' ? 'claro' : 'escuro'
}
</script>

<template>
  <Leitor v-if="livroAberto" :key="livroAberto.id" :livro="livroAberto" @fechar="fechar" />
  <div v-else class="app">
    <header class="barra">
      <button type="button" aria-label="Abrir menu" :aria-expanded="menuAberto" @click="menuAberto = !menuAberto">☰</button>
      <span>Biblioteca Digital</span>
    </header>

    <div v-if="menuAberto" class="fundo-menu" @click="menuAberto = false"></div>

    <aside class="menu" :class="{ aberto: menuAberto }">
      <p class="marca">Biblioteca Digital</p>
      <nav aria-label="Menu principal">
        <ul>
          <li>
            <button type="button" class="item" aria-current="page" @click="menuAberto = false">Início</button>
          </li>
          <li>
            <label class="item" :class="{ ocupado: enviando }">
              {{ enviando ? 'Enviando…' : 'Enviar arquivo' }}
              <input
                type="file"
                accept=".epub,.pdf,application/epub+zip,application/pdf"
                multiple
                :disabled="enviando"
                @change="enviar"
              />
            </label>
          </li>
        </ul>
      </nav>
      <div class="rodape">
        <button type="button" class="item" @click="alternarTema">
          {{ preferencias.tema === 'escuro' ? 'Tema claro' : 'Tema escuro' }}
        </button>
        <p v-if="apiOk === false" class="estado">API indisponível</p>
        <p v-else-if="apiOk" class="estado">API ok · versão {{ versao.slice(0, 7) }}</p>
      </div>
    </aside>

    <main>
      <h1>Início</h1>

      <div class="envio" aria-live="polite">
        <p v-if="adicionados">
          {{ adicionados === 1 ? '1 livro adicionado.' : `${adicionados} livros adicionados.` }}
        </p>
        <p v-for="falha in falhas" :key="falha" class="falha">{{ falha }}</p>
      </div>

      <ul v-if="livros.length" class="livros">
        <li v-for="livro in livrosOrdenados" :key="livro.id">
          <button type="button" @click="abrir(livro)">
            <span class="capa">
              <img v-if="livro.has_cover" :src="`/api/books/${encodeURIComponent(livro.id)}/cover`" alt="" />
              <span v-if="livro.format === 'pdf'" class="formato">PDF</span>
            </span>
            <span class="titulo">{{ livro.title }}</span>
            <span v-if="livro.author" class="autor">{{ livro.author }}</span>
          </button>
        </li>
      </ul>
      <p v-else-if="apiOk">Nenhum livro ainda. Use "Enviar arquivo" no menu para adicionar um EPUB ou PDF.</p>
    </main>
  </div>
</template>

<style scoped>
.app {
  display: grid;
  grid-template-columns: 15rem minmax(0, 1fr);
  min-height: 100dvh;
}

.barra {
  display: none;
}

.menu {
  position: sticky;
  top: 0;
  display: flex;
  flex-direction: column;
  height: 100dvh;
  padding: 1rem 0.75rem;
  background: var(--superficie);
}

.marca {
  margin: 0 0.75rem 1rem;
  font-weight: 600;
}

.menu ul {
  display: grid;
  gap: 0.25rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.item {
  position: relative;
  display: flex;
  align-items: center;
  width: 100%;
  min-height: 44px;
  padding: 0 0.75rem;
  font: inherit;
  text-align: left;
  background: transparent;
  border: 0;
  border-radius: 6px;
  cursor: pointer;
}

.item:hover {
  background: var(--superficie-forte);
}

.item[aria-current='page'] {
  font-weight: 600;
  background: var(--superficie-forte);
}

.item.ocupado {
  opacity: 0.7;
  cursor: progress;
}

.item:focus-within {
  outline: 2px solid var(--destaque);
  outline-offset: 2px;
}

.item input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
}

.rodape {
  margin-top: auto;
}

.estado {
  margin: 0.5rem 0.75rem 0;
  color: var(--texto-suave);
  font-size: 0.75rem;
}

main {
  width: 100%;
  max-width: 72rem;
  padding: 1.5rem;
}

h1 {
  margin: 0 0 1rem;
  font-size: 1.5rem;
}

.envio p {
  margin: 0.5rem 0;
}

.falha {
  color: var(--perigo);
}

.livros {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr));
  gap: 1.5rem 1rem;
  margin: 1rem 0 0;
  padding: 0;
  list-style: none;
}

.livros button {
  display: grid;
  gap: 0.25rem;
  align-content: start;
  width: 100%;
  height: 100%;
  padding: 0;
  text-align: left;
  background: transparent;
  border: 0;
  cursor: pointer;
}

.capa {
  position: relative;
  display: block;
  margin-bottom: 0.25rem;
  aspect-ratio: 2 / 3;
  overflow: hidden;
  background: var(--superficie-forte);
  border-radius: 4px;
  box-shadow: 0 1px 4px rgb(0 0 0 / 25%);
}

.capa img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.formato {
  position: absolute;
  right: 0.25rem;
  bottom: 0.25rem;
  padding: 0.125rem 0.375rem;
  color: var(--destaque-texto);
  font-size: 0.6875rem;
  font-weight: 600;
  background: var(--destaque);
  border-radius: 3px;
}

.titulo {
  overflow-wrap: anywhere;
  font-size: 0.9375rem;
}

.autor {
  color: var(--texto-suave);
  font-size: 0.8125rem;
}

@media (max-width: 47.99rem) {
  .app {
    display: block;
  }

  .barra {
    position: sticky;
    top: 0;
    z-index: 1;
    display: flex;
    gap: 0.5rem;
    align-items: center;
    padding: 0.25rem 0.5rem;
    font-weight: 600;
    background: var(--superficie);
  }

  .barra button {
    width: 44px;
    height: 44px;
    font-size: 1.25rem;
    background: transparent;
    border: 0;
    cursor: pointer;
  }

  .fundo-menu {
    position: fixed;
    inset: 0;
    z-index: 2;
    background: rgb(0 0 0 / 35%);
  }

  /* visibility tira o menu fechado do Tab, mas o campo de arquivo segue acessível aberto. */
  .menu {
    position: fixed;
    inset: 0 auto 0 0;
    z-index: 3;
    width: min(17rem, 85vw);
    visibility: hidden;
    transform: translateX(-100%);
  }

  .menu.aberto {
    visibility: visible;
    transform: none;
  }

  main {
    padding: 1rem;
  }
}
</style>
