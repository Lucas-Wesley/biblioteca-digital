<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import BuscarLivros from './BuscarLivros.vue'
import Icone from './Icone.vue'
import Leitor from './Leitor.vue'
import SeletorTema from './SeletorTema.vue'
import { carregarLivros, guardarLivros, livrosGuardados, sincronizar, tentarRedeDeNovo } from './dados.js'
import { lerMetadadosPdf } from './motores/pdf.js'
import { baixarLivro, livrosBaixados, removerDownload } from './offline.js'

const versao = ref('')
const carregou = ref(false)
const semConexao = ref(false)
const livros = ref([])
const idAberto = ref(lerHash())
const menuAberto = ref(false)
const vista = ref('inicio')
const enviando = ref(false)
const adicionados = ref(0)
const falhas = ref([])
const baixados = ref(new Set())
const baixando = ref({})

// Com a abertura por aqui, o botão Voltar do app equivale ao do celular.
let abertoPorClique = false

const livrosOrdenados = computed(() =>
  [...livros.value].sort((a, b) => a.title.localeCompare(b.title, 'pt-BR')),
)
// Fora de casa só abre o que foi baixado; mostrar o resto seria prometer o que não abre.
const livrosVisiveis = computed(() =>
  semConexao.value || vista.value === 'baixados'
    ? livrosOrdenados.value.filter((livro) => baixados.value.has(livro.id))
    : livrosOrdenados.value,
)
const continuar = computed(() => {
  if (vista.value !== 'inicio') return null
  const emAndamento = livrosVisiveis.value.filter((livro) => livro.read_at && livro.percent > 0 && livro.percent < 1)
  return emAndamento.sort((a, b) => new Date(b.read_at) - new Date(a.read_at))[0] ?? null
})
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
  atualizar()
}

function urlDaCapa(livro) {
  return `/api/books/${encodeURIComponent(livro.id)}/cover`
}

function mostrar(novaVista) {
  vista.value = novaVista
  menuAberto.value = false
}

async function atualizar() {
  const resultado = await carregarLivros()
  livros.value = resultado.livros
  semConexao.value = resultado.semConexao
  baixados.value = await livrosBaixados()
  carregou.value = true
}

async function lerVersao() {
  try {
    const resposta = await fetch('/api/health', { signal: AbortSignal.timeout(4000) })
    versao.value = (await resposta.json()).version
  } catch {
    versao.value = ''
  }
}

function aoVoltarARede() {
  tentarRedeDeNovo()
  sincronizar()
  atualizar()
  lerVersao()
}

function aoMudarVisibilidade() {
  if (document.visibilityState !== 'visible') return
  tentarRedeDeNovo()
  sincronizar()
}

onMounted(async () => {
  window.addEventListener('hashchange', aoMudarHash)
  window.addEventListener('online', aoVoltarARede)
  document.addEventListener('visibilitychange', aoMudarVisibilidade)
  // Mostra na hora a última lista vista; a resposta do servidor pode demorar ou nem vir.
  livros.value = livrosGuardados()
  baixados.value = await livrosBaixados()
  await Promise.all([atualizar(), lerVersao()])
})

onBeforeUnmount(() => {
  window.removeEventListener('hashchange', aoMudarHash)
  window.removeEventListener('online', aoVoltarARede)
  document.removeEventListener('visibilitychange', aoMudarVisibilidade)
})

async function alternarDownload(livro) {
  if (baixando.value[livro.id] !== undefined) return
  if (baixados.value.has(livro.id)) {
    await removerDownload(livro.id)
    baixados.value.delete(livro.id)
    baixados.value = new Set(baixados.value)
    return
  }
  falhas.value = []
  baixando.value = { ...baixando.value, [livro.id]: 0 }
  try {
    await baixarLivro(livro, (fracao) => {
      baixando.value = { ...baixando.value, [livro.id]: fracao }
    })
    baixados.value = new Set(baixados.value).add(livro.id)
  } catch (erro) {
    console.warn('Não foi possível baixar', erro)
    falhas.value = [`${livro.title}: não foi possível baixar o livro.`]
  } finally {
    const { [livro.id]: _, ...resto } = baixando.value
    baixando.value = resto
  }
}

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
    guardarLivros(livros.value)
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
</script>

<template>
  <Leitor v-if="livroAberto" :key="livroAberto.id" :livro="livroAberto" @fechar="fechar" />
  <div v-else class="app">
    <header class="barra">
      <button type="button" aria-label="Abrir menu" :aria-expanded="menuAberto" @click="menuAberto = !menuAberto"><Icone nome="menu" /></button>
    </header>

    <div v-if="menuAberto" class="fundo-menu" @click="menuAberto = false"></div>

    <aside class="menu" :class="{ aberto: menuAberto }">
      <p class="nome-app">Biblioteca</p>
      <nav aria-label="Menu principal">
        <ul>
          <li>
            <button type="button" class="item" :aria-current="vista === 'inicio' ? 'page' : undefined" @click="mostrar('inicio')">Início</button>
          </li>
          <li>
            <button type="button" class="item" :aria-current="vista === 'baixados' ? 'page' : undefined" @click="mostrar('baixados')">Baixados</button>
          </li>
          <li>
            <button type="button" class="item" :aria-current="vista === 'buscar' ? 'page' : undefined" @click="mostrar('buscar')">Buscar livros</button>
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
        <SeletorTema />
        <p v-if="semConexao" class="estado">Sem conexão com a sua rede</p>
        <p v-else-if="versao" class="estado">versão {{ versao.slice(0, 7) }}</p>
      </div>
    </aside>

    <main v-if="vista === 'buscar'">
      <BuscarLivros />
    </main>
    <main v-else>
      <h1>{{ vista === 'baixados' ? 'Baixados' : 'Início' }}</h1>

      <p v-if="semConexao" class="aviso">Sem conexão com a sua rede. Mostrando os livros baixados; o progresso e as marcações sobem quando você voltar.</p>

      <div class="envio" aria-live="polite">
        <p v-if="adicionados">
          {{ adicionados === 1 ? '1 livro adicionado.' : `${adicionados} livros adicionados.` }}
        </p>
        <p v-for="falha in falhas" :key="falha" class="falha">{{ falha }}</p>
      </div>

      <section v-if="continuar" class="continuar" aria-label="Continuar lendo">
        <button type="button" @click="abrir(continuar)">
          <span class="capa pequena">
            <img v-if="continuar.has_cover" :src="urlDaCapa(continuar)" alt="" />
          </span>
          <span class="dados">
            <span class="sobretitulo">Continuar lendo</span>
            <span class="titulo-grande">{{ continuar.title }}</span>
            <span v-if="continuar.author" class="autor">{{ continuar.author }}</span>
            <span class="andamento" aria-hidden="true"><span :style="{ width: `${continuar.percent * 100}%` }"></span></span>
            <span class="autor">{{ Math.round(continuar.percent * 100) }}%</span>
          </span>
        </button>
      </section>

      <ul v-if="livrosVisiveis.length" class="livros">
        <li v-for="livro in livrosVisiveis" :key="livro.id">
          <button type="button" class="abrir" @click="abrir(livro)">
            <span class="capa">
              <img v-if="livro.has_cover" :src="urlDaCapa(livro)" alt="" />
              <span v-else class="titulo-na-capa" aria-hidden="true">{{ livro.title }}</span>
              <span v-if="livro.format === 'pdf'" class="formato">PDF</span>
              <span v-if="livro.percent > 0" class="andamento sobre-capa" aria-hidden="true"><span :style="{ width: `${livro.percent * 100}%` }"></span></span>
            </span>
            <span class="titulo">{{ livro.title }}</span>
            <span v-if="livro.author" class="autor">{{ livro.author }}</span>
          </button>
          <button
            type="button"
            class="baixar"
            :aria-label="baixados.has(livro.id) ? `Remover download: ${livro.title}` : `Baixar: ${livro.title}`"
            :title="baixados.has(livro.id) ? 'Baixado. Toque para remover do aparelho.' : 'Baixar para ler sem conexão'"
            @click="alternarDownload(livro)"
          >
            <span v-if="baixando[livro.id] !== undefined" class="baixando">{{ Math.round(baixando[livro.id] * 100) }}%</span>
            <Icone v-else :nome="baixados.has(livro.id) ? 'baixado' : 'baixar'" />
          </button>
        </li>
      </ul>
      <template v-else-if="carregou">
        <p v-if="semConexao || vista === 'baixados'" class="vazio">Nenhum livro baixado. Em casa, toque no ícone abaixo da capa para baixar.</p>
        <p v-else class="vazio">Nenhum livro ainda. Use "Enviar arquivo" no menu para adicionar um EPUB ou PDF.</p>
      </template>
    </main>
  </div>
</template>

<style scoped>
.app {
  display: grid;
  grid-template-columns: 14rem minmax(0, 1fr);
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
  padding: 1.5rem 0.75rem 1rem;
  border-right: 1px solid var(--linha);
}

.nome-app {
  margin: 0 0.75rem 1.5rem;
  font-family: var(--leitura);
  font-size: 1.2rem;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.menu ul {
  display: grid;
  gap: 0.125rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.item {
  position: relative;
  display: flex;
  align-items: center;
  width: 100%;
  min-height: 36px;
  padding: 0 0.75rem;
  font: inherit;
  font-size: 0.9rem;
  color: var(--texto-suave);
  text-align: left;
  background: transparent;
  border: 0;
  border-radius: var(--raio-p);
  transition: background 0.15s ease, color 0.15s ease;
  cursor: pointer;
}

.item:hover {
  color: var(--texto);
  background: var(--superficie);
}

.item[aria-current='page'] {
  color: var(--texto);
  font-weight: 600;
  background: var(--superficie);
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
  display: grid;
  gap: 0.75rem;
  margin-top: auto;
  padding-inline: 0.75rem;
}

.estado {
  margin: 0;
  color: var(--texto-suave);
  font-size: 0.6875rem;
}

main {
  width: 100%;
  max-width: 72rem;
  padding: 2.25rem 2.5rem 3rem;
}

h1 {
  margin: 0 0 1.5rem;
  font-size: 1.75rem;
  font-weight: 650;
  letter-spacing: -0.025em;
}

.aviso,
.vazio {
  color: var(--texto-suave);
  font-size: 0.9375rem;
}

.aviso {
  margin: -0.75rem 0 1.5rem;
}

.envio p {
  margin: 0 0 1rem;
}

.falha {
  color: var(--perigo);
}

.continuar {
  margin-bottom: 2.5rem;
}

.continuar button {
  display: flex;
  gap: 1.25rem;
  align-items: center;
  width: 100%;
  max-width: 34rem;
  padding: 0;
  text-align: left;
  background: transparent;
  border: 0;
  cursor: pointer;
}

.dados {
  display: grid;
  flex: 1;
  gap: 0.25rem;
  min-width: 0;
}

.sobretitulo {
  color: var(--texto-fraco);
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.titulo-grande {
  font-family: var(--leitura);
  font-size: 1.2rem;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.andamento {
  display: block;
  height: 3px;
  margin-top: 0.5rem;
  overflow: hidden;
  background: var(--superficie-forte);
  border-radius: 2px;
}

.andamento span {
  display: block;
  height: 100%;
  background: var(--azul);
}

.sobre-capa {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  margin: 0;
  background: rgb(0 0 0 / 25%);
  border-radius: 0;
}

.sobre-capa span {
  background: #ffffff;
}

.livros {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(8rem, 1fr));
  gap: 1.75rem 1.5rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.livros li {
  position: relative;
  container-type: inline-size;
}

.abrir {
  display: grid;
  gap: 0.25rem;
  align-content: start;
  width: 100%;
  padding: 0;
  text-align: left;
  background: transparent;
  border: 0;
  cursor: pointer;
}

.capa {
  position: relative;
  display: block;
  margin-bottom: 0.5rem;
  aspect-ratio: 2 / 3;
  overflow: hidden;
  background: var(--superficie);
  border-radius: 4px;
  box-shadow: 0 0 0 1px var(--linha), 0 4px 14px rgb(0 0 0 / 10%);
}

.capa.pequena {
  flex: none;
  width: 4.5rem;
  margin: 0;
}

.capa img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.titulo-na-capa {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 0.75rem;
  color: var(--texto-suave);
  font-family: 'Literata', Georgia, serif;
  font-size: 0.9375rem;
  line-height: 1.3;
  text-align: center;
}

.formato {
  position: absolute;
  top: 0.375rem;
  right: 0.375rem;
  padding: 0.125rem 0.375rem;
  color: #ffffff;
  font-size: 0.625rem;
  font-weight: 600;
  background: rgb(0 0 0 / 55%);
  border-radius: 4px;
}

.titulo {
  display: -webkit-box;
  padding-right: 1.75rem;
  overflow: hidden;
  font-size: 0.875rem;
  font-weight: 500;
  line-height: 1.35;
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.autor {
  padding-right: 1.75rem;
  color: var(--texto-fraco);
  font-size: 0.78rem;
}

.dados .autor {
  padding-right: 0;
}

/* Logo abaixo da capa, que tem proporção 2:3, ao lado do título e sem cobrir a arte. */
.baixar {
  position: absolute;
  top: calc(150cqw - 2px);
  right: -0.625rem;
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  padding: 0;
  color: var(--texto-suave);
  background: transparent;
  border: 0;
  cursor: pointer;
}

.baixando {
  font-size: 0.6875rem;
  font-variant-numeric: tabular-nums;
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
    align-items: center;
    padding: env(safe-area-inset-top) 0.25rem 0;
    background: var(--vidro);
    -webkit-backdrop-filter: var(--blur);
    backdrop-filter: var(--blur);
  }

  .barra button {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    padding: 0;
    background: transparent;
    border: 0;
    cursor: pointer;
  }

  .fundo-menu {
    position: fixed;
    inset: 0;
    z-index: 2;
    background: rgb(0 0 0 / 20%);
    -webkit-backdrop-filter: blur(4px);
    backdrop-filter: blur(4px);
  }

  /* visibility tira o menu fechado do Tab, mas o campo de arquivo segue acessível aberto. */
  .menu {
    position: fixed;
    inset: 0 auto 0 0;
    z-index: 3;
    width: min(17rem, 85vw);
    background: var(--fundo);
    visibility: hidden;
    transform: translateX(-100%);
  }

  .menu.aberto {
    visibility: visible;
    transform: none;
  }

  main {
    padding: 0.5rem 1rem 2rem;
  }

  h1 {
    margin-bottom: 1rem;
  }

  .livros {
    grid-template-columns: repeat(auto-fill, minmax(6.5rem, 1fr));
    gap: 1.25rem 0.875rem;
  }
}
</style>
