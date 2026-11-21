<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import Ajustes from './Ajustes.vue'
import BuscaNosLivros from './BuscaNosLivros.vue'
import BuscarLivros from './BuscarLivros.vue'
import Estatisticas from './Estatisticas.vue'
import Icone from './Icone.vue'
import Leitor from './Leitor.vue'
import MetasDeHoje from './MetasDeHoje.vue'
import Planos from './Planos.vue'
import { carregarLivros, guardarLivros, livrosGuardados, sincronizar, tentarRedeDeNovo } from './dados.js'
import { lerMetadadosPdf } from './motores/pdf.js'
import { diaDe, lerRegistros } from './leitura.js'
import { lerPlanos, planosGuardados } from './planos.js'
import { baixarLivro, livrosBaixados, removerDownload } from './offline.js'
import { TEMAS_DO_APP, preferencias, proximoTemaDoApp } from './preferencias.js'

const versao = ref('')
const carregou = ref(false)
const semConexao = ref(false)
const livros = ref([])
const idAberto = ref(lerHash())
const ancoraAberta = ref(lerAncora())
const planoDaLeitura = ref('')
const menuAberto = ref(false)
const vista = ref('inicio')
const enviando = ref(false)
const adicionados = ref(0)
const falhas = ref([])
const baixados = ref(new Set())
const baixando = ref({})
// As metas de hoje vêm primeiro no Início, antes do "Continuar lendo" (R38).
const planos = ref([])
const registros = ref([])
const hoje = ref(diaDe(new Date()))
const planoInicial = ref('')

// A navegação (design system v4, R42): na lateral, no computador; no celular, as principais na
// barra do pé e todas na gaveta, que o "Menu" da barra abre.
const NAVEGACAO = [
  { vista: 'inicio', nome: 'Início', icone: 'inicio' },
  { vista: 'baixados', nome: 'Baixados', icone: 'baixado' },
  { vista: 'buscar', nome: 'Buscar livros', icone: 'pesquisar' },
  { vista: 'nos-livros', nome: 'Buscar nos meus livros', icone: 'busca-texto' },
  { vista: 'planos', nome: 'Planos de leitura', icone: 'calendario' },
  { vista: 'estatisticas', nome: 'Estatísticas', icone: 'grafico' },
]
const ABAS_DO_CELULAR = [
  { vista: 'inicio', nome: 'Início', icone: 'inicio' },
  { vista: 'planos', nome: 'Planos', icone: 'calendario' },
  { vista: 'estatisticas', nome: 'Números', icone: 'grafico' },
  { vista: 'ajustes', nome: 'Ajustes', icone: 'ajustes' },
]
const trocarTema = () => (preferencias.tema = proximoTemaDoApp(preferencias.tema))

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
const temMetas = computed(() => vista.value === 'inicio' && planos.value.some((p) => p.goals?.some((m) => m.state !== 'lida')))
const temLateral = computed(() => temMetas.value || Boolean(continuar.value))
const livroAberto = computed(() => livros.value.find((livro) => livro.id === idAberto.value))

// #/livro/<id>, ou #/livro/<id>?em=<âncora> para abrir num ponto do livro (a busca, R32).
function lerHash() {
  const achado = location.hash.match(/^#\/livro\/([^?]+)/)
  return achado ? decodeURIComponent(achado[1]) : null
}

function lerAncora() {
  const achado = location.hash.match(/^#\/livro\/[^?]+\?em=(.+)$/)
  return achado ? decodeURIComponent(achado[1]) : ''
}

function aoMudarHash() {
  idAberto.value = lerHash()
  ancoraAberta.value = lerAncora()
}

function abrir(livro, ancora = '', planoId = '') {
  abertoPorClique = true
  planoDaLeitura.value = planoId
  idAberto.value = livro.id ?? livro
  ancoraAberta.value = ancora
  location.hash = `#/livro/${encodeURIComponent(idAberto.value)}${ancora ? `?em=${encodeURIComponent(ancora)}` : ''}`
}

function fechar() {
  idAberto.value = null
  ancoraAberta.value = ''
  if (abertoPorClique) history.back()
  else location.hash = ''
  abertoPorClique = false
  atualizar()
  carregarPlanos()
}

function urlDaCapa(livro) {
  return `/api/books/${encodeURIComponent(livro.id)}/cover`
}

// A tela de onde se foi para Ajustes: vai junto com a sugestão, para dar contexto.
const NOMES_DAS_VISTAS = { inicio: 'Início', baixados: 'Baixados', buscar: 'Buscar livros', 'nos-livros': 'Buscar nos meus livros', estatisticas: 'Estatísticas', planos: 'Planos de leitura' }
const telaAnterior = ref('')

function mostrar(novaVista) {
  planoInicial.value = ''
  if (novaVista === 'inicio') carregarPlanos()
  if (novaVista === 'ajustes' && vista.value !== 'ajustes') telaAnterior.value = NOMES_DAS_VISTAS[vista.value] ?? vista.value
  vista.value = novaVista
  menuAberto.value = false
}

async function carregarPlanos() {
  hoje.value = diaDe(new Date())
  try {
    planos.value = (await lerPlanos()).planos
  } catch {
    planos.value = planosGuardados()
  }
  lerRegistros().then((r) => (registros.value = r.registros)).catch(() => {})
}

// Tocar na meta leva ao plano dela, na tela de Planos.
function verPlano(plano) {
  mostrar('planos')
  planoInicial.value = plano.id
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
  planos.value = planosGuardados()
  carregarPlanos()
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
  <Leitor v-if="livroAberto" :key="livroAberto.id" :livro="livroAberto" :ancora="ancoraAberta" :plano-id="planoDaLeitura" @fechar="fechar" />
  <div v-else class="moldura">
    <aside class="menu" :class="{ aberto: menuAberto }" aria-label="Menu">
      <p class="marca-app">
        <span class="marca-icone"><Icone nome="marca" :tamanho="18" /></span>
        <span class="marca-texto">
          <span class="marca-sobre">Homelab</span>
          <span class="marca-nome">Biblioteca</span>
        </span>
      </p>
      <nav aria-label="Menu principal">
        <button
          v-for="item in NAVEGACAO"
          :key="item.vista"
          type="button"
          class="nav-item"
          :class="{ ativo: vista === item.vista }"
          :aria-current="vista === item.vista ? 'page' : undefined"
          @click="mostrar(item.vista)"
        ><Icone :nome="item.icone" :tamanho="18" />{{ item.nome }}</button>
        <label class="nav-item enviar" :class="{ ocupado: enviando }">
          <Icone nome="enviar" :tamanho="18" />
          {{ enviando ? 'Enviando…' : 'Enviar arquivo' }}
          <input
            type="file"
            accept=".epub,.pdf,application/epub+zip,application/pdf"
            multiple
            :disabled="enviando"
            @change="enviar"
          />
        </label>
        <button
          type="button"
          class="nav-item"
          :class="{ ativo: vista === 'ajustes' }"
          :aria-current="vista === 'ajustes' ? 'page' : undefined"
          @click="mostrar('ajustes')"
        ><Icone nome="ajustes" :tamanho="18" />Ajustes</button>
      </nav>
      <div class="rodape">
        <span v-if="semConexao" class="estado">Sem conexão com a sua rede</span>
        <span v-else class="estado">{{ versao ? `versão ${versao.slice(0, 7)}` : '' }}</span>
        <button
          type="button"
          class="botao discreto icone"
          :title="TEMAS_DO_APP[preferencias.tema].rotulo"
          :aria-label="TEMAS_DO_APP[preferencias.tema].rotulo"
          @click="trocarTema"
        ><Icone :nome="TEMAS_DO_APP[preferencias.tema].icone" /></button>
      </div>
    </aside>
    <div v-if="menuAberto" class="veu" @click="menuAberto = false"></div>

    <main class="pagina">
      <BuscarLivros v-if="vista === 'buscar'" />
      <BuscaNosLivros v-else-if="vista === 'nos-livros'" @abrir="abrir" />
      <Planos v-else-if="vista === 'planos'" :key="planoInicial" :livros="livros" :plano-inicial="planoInicial" @abrir="abrir" />
      <Estatisticas v-else-if="vista === 'estatisticas'" :livros="livros" />
      <Ajustes v-else-if="vista === 'ajustes'" :tela="telaAnterior" />
      <template v-else>
        <div class="topo-pagina">
          <h1>{{ vista === 'baixados' ? 'Baixados' : 'Início' }}</h1>
          <div class="acoes">
            <span v-if="livrosVisiveis.length" class="pequeno">{{ livrosVisiveis.length === 1 ? '1 livro' : `${livrosVisiveis.length} livros` }}</span>
          </div>
        </div>

        <p v-if="semConexao" class="aviso neutro sem-conexao">Sem conexão com a sua rede. Mostrando os livros baixados; o progresso e as marcações sobem quando você voltar.</p>

        <div v-if="adicionados || falhas.length" class="envio" aria-live="polite">
          <p v-if="adicionados" class="aviso neutro">
            {{ adicionados === 1 ? '1 livro adicionado.' : `${adicionados} livros adicionados.` }}
          </p>
          <p v-for="falha in falhas" :key="falha" class="aviso falha">{{ falha }}</p>
        </div>
        <div v-else class="envio" aria-live="polite"></div>

        <div class="colunas-com-lateral" :class="{ 'com-lateral': temLateral }">
          <div v-if="temLateral" class="lateral">
            <MetasDeHoje
              v-if="temMetas"
              :planos="planos"
              :livros="livros"
              :hoje="hoje"
              :registros="registros"
              titulo="Meta de hoje"
              @abrir-plano="verPlano"
              @abrir="abrir"
            />

            <section v-if="continuar" class="quadro continuar" aria-label="Continuar lendo">
              <div class="quadro-topo">
                <h2 class="rotulo-secao">Continuar lendo</h2>
                <span class="pequeno">{{ Math.round(continuar.percent * 100) }}%</span>
              </div>
              <button type="button" @click="abrir(continuar)">
                <span class="capa-livro pequena">
                  <img v-if="continuar.has_cover" :src="urlDaCapa(continuar)" alt="" />
                </span>
                <span class="dados">
                  <span class="titulo-grande">{{ continuar.title }}</span>
                  <span v-if="continuar.author" class="autor">{{ continuar.author }}</span>
                  <span class="progresso" aria-hidden="true"><span :style="{ width: `${continuar.percent * 100}%` }"></span></span>
                </span>
              </button>
            </section>
          </div>

          <section class="estante" aria-label="Livros">
            <ul v-if="livrosVisiveis.length" class="livros">
              <li v-for="livro in livrosVisiveis" :key="livro.id">
                <button type="button" class="abrir" @click="abrir(livro)">
                  <span class="capa-livro">
                    <img v-if="livro.has_cover" :src="urlDaCapa(livro)" alt="" />
                    <span v-else class="titulo-na-capa" aria-hidden="true">{{ livro.title }}</span>
                    <span v-if="livro.format === 'pdf'" class="formato">PDF</span>
                    <span v-if="livro.percent > 0" class="sobre-capa" aria-hidden="true"><span :style="{ width: `${livro.percent * 100}%` }"></span></span>
                  </span>
                  <span class="titulo">{{ livro.title }}</span>
                  <span v-if="livro.author" class="autor">{{ livro.author }}</span>
                </button>
                <button
                  type="button"
                  class="baixar"
                  :class="{ feito: baixados.has(livro.id) }"
                  :aria-label="baixados.has(livro.id) ? `Remover download: ${livro.title}` : `Baixar: ${livro.title}`"
                  :title="baixados.has(livro.id) ? 'Baixado. Toque para remover do aparelho.' : 'Baixar para ler sem conexão'"
                  @click="alternarDownload(livro)"
                >
                  <span v-if="baixando[livro.id] !== undefined" class="baixando">{{ Math.round(baixando[livro.id] * 100) }}%</span>
                  <Icone v-else :nome="baixados.has(livro.id) ? 'baixado' : 'baixar'" :tamanho="18" />
                </button>
              </li>
            </ul>
            <template v-else-if="carregou">
              <p v-if="semConexao || vista === 'baixados'" class="vazio">Nenhum livro baixado. Em casa, toque no ícone abaixo da capa para baixar.</p>
              <p v-else class="vazio">Nenhum livro ainda. Use "Enviar arquivo" no menu para adicionar um EPUB ou PDF.</p>
            </template>
          </section>
        </div>
      </template>
    </main>

    <nav class="abas-celular" aria-label="Seções">
      <button type="button" :aria-label="menuAberto ? 'Fechar menu' : 'Abrir menu'" :aria-expanded="menuAberto" @click="menuAberto = !menuAberto">
        <Icone :nome="menuAberto ? 'fechar' : 'menu'" :tamanho="20" />
        <span aria-hidden="true">Menu</span>
      </button>
      <button
        v-for="aba in ABAS_DO_CELULAR"
        :key="aba.vista"
        type="button"
        :class="{ ativa: vista === aba.vista }"
        :aria-current="vista === aba.vista ? 'page' : undefined"
        @click="mostrar(aba.vista)"
      >
        <Icone :nome="aba.icone" :tamanho="20" />
        <span>{{ aba.nome }}</span>
      </button>
    </nav>
  </div>
</template>

<style scoped>
/* Sem barra no topo (design system v4): a marca abre a lateral e o tema fica no pé dela. */
.moldura {
  display: flex;
  min-height: 100dvh;
}

.menu {
  position: sticky;
  top: 0;
  flex: none;
  display: flex;
  flex-direction: column;
  width: calc(var(--nav) + env(safe-area-inset-left));
  height: 100dvh;
  /* Celular deitado (R40): a tela é baixa, então a lateral rola, e o recorte da câmera fica de lado. */
  overflow-y: auto;
  padding: var(--e4) var(--e3) var(--e3) calc(var(--e3) + env(safe-area-inset-left));
  border-right: 1px solid var(--borda);
  background: var(--superficie);
}

.menu nav {
  display: grid;
  gap: 2px;
}

.marca-app {
  display: flex;
  align-items: center;
  gap: var(--e3);
  margin: 0 0 var(--e4);
  padding: var(--e2);
}

.marca-texto {
  display: grid;
  line-height: 1.2;
}

.marca-sobre {
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--texto-fraco);
}

.marca-nome {
  font-family: var(--fonte-titulo);
  font-size: 18px;
  font-weight: 500;
}

.nav-item svg {
  flex: none;
}

.nav-item.ocupado {
  opacity: 0.7;
  cursor: progress;
}

.enviar {
  position: relative;
}

.enviar:has(input:focus-visible) {
  outline: 2px solid var(--foco);
  outline-offset: 2px;
}

.enviar input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
}

.rodape {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--e2);
  margin-top: auto;
  padding: var(--e3) 0 0 var(--e2);
  color: var(--texto-fraco);
  font-size: 12px;
}

.pagina {
  flex: 1;
  min-width: 0;
  margin: 0 auto;
}

.envio:empty {
  display: none;
}

.envio,
.sem-conexao {
  display: grid;
  gap: var(--e2);
  max-width: var(--leitura);
  margin: 0 0 var(--e4);
}

.envio p {
  margin: 0;
}

.continuar button {
  display: flex;
  gap: var(--e3);
  align-items: center;
  width: 100%;
  padding: 0;
  text-align: left;
  background: transparent;
  border: 0;
  cursor: pointer;
}

.continuar button:hover .titulo-grande {
  color: var(--link);
}

.capa-livro.pequena {
  flex: none;
  width: 48px;
}

.dados {
  display: grid;
  flex: 1;
  gap: 2px;
  min-width: 0;
}

.titulo-grande {
  font-size: 14.5px;
  font-weight: 600;
  line-height: 1.35;
  transition: color var(--transicao);
}

.dados .progresso {
  margin-top: var(--e2);
}

/* Estante: capas numa grade densa, título e autor embaixo, o baixar ao lado do título. */
.livros {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(124px, 1fr));
  gap: var(--e5) var(--e4);
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
  gap: 2px;
  align-content: start;
  width: 100%;
  padding: 0;
  text-align: left;
  background: transparent;
  border: 0;
  cursor: pointer;
}

.abrir .capa-livro {
  margin-bottom: var(--e2);
  transition: border-color var(--transicao);
}

.abrir:hover .capa-livro {
  border-color: var(--borda-forte);
}

.formato {
  position: absolute;
  top: var(--e1);
  right: var(--e1);
  padding: 0 var(--e1);
  color: var(--cinza);
  font-size: 11px;
  font-weight: 600;
  line-height: 18px;
  background: var(--cinza-fundo);
  border-radius: var(--raio-e);
}

/* O progresso de leitura sobre o pé da capa. */
.sobre-capa {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  height: 4px;
  background: var(--superficie-2);
}

.sobre-capa span {
  display: block;
  height: 100%;
  background: var(--verde);
}

.titulo {
  display: -webkit-box;
  padding-right: 28px;
  overflow: hidden;
  font-size: 13.5px;
  font-weight: 600;
  line-height: 1.35;
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.autor {
  padding-right: 28px;
  overflow: hidden;
  color: var(--texto-fraco);
  font-size: 12.5px;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.dados .autor {
  padding-right: 0;
}

/* Logo abaixo da capa, que tem proporção 2:3, ao lado do título e sem cobrir a arte. */
.baixar {
  position: absolute;
  top: calc(150cqw + var(--e2) - 6px);
  right: -8px;
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  padding: 0;
  color: var(--texto-fraco);
  background: transparent;
  border: 0;
  border-radius: var(--raio-p);
  cursor: pointer;
}

.baixar:hover {
  color: var(--texto);
}

.baixar.feito {
  color: var(--verde);
}

.baixando {
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.abas-celular,
.veu {
  display: none;
}

@media (max-width: 899px) {
  .moldura {
    display: block;
  }

  /* A lateral sai da tela e vira gaveta, aberta pelo Menu da barra do pé. */
  .menu {
    position: fixed;
    top: 0;
    bottom: 0;
    left: 0;
    z-index: 40;
    width: min(300px, 85vw);
    height: auto;
    padding-top: calc(var(--e4) + env(safe-area-inset-top));
    padding-bottom: calc(var(--e3) + env(safe-area-inset-bottom));
    transform: translateX(-100%);
    visibility: hidden;
    transition: transform 160ms ease, visibility 160ms;
  }

  .menu.aberto {
    transform: none;
    visibility: visible;
  }

  .veu {
    position: fixed;
    inset: 0;
    z-index: 39;
    display: block;
    background: rgb(0 0 0 / 0.45);
  }

  .pagina {
    padding-top: calc(var(--e4) + env(safe-area-inset-top));
    padding-bottom: calc(var(--e7) + 56px + env(safe-area-inset-bottom));
  }

  .abas-celular {
    position: fixed;
    right: 0;
    bottom: 0;
    left: 0;
    z-index: 30;
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    padding: var(--e1) calc(var(--e2) + env(safe-area-inset-right)) calc(var(--e1) + env(safe-area-inset-bottom)) calc(var(--e2) + env(safe-area-inset-left));
    background: var(--fundo);
    border-top: 1px solid var(--borda);
  }

  .abas-celular button {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 6px 0;
    font-size: 11.5px;
    font-weight: 500;
    color: var(--texto-fraco);
    background: transparent;
    border: 0;
    border-radius: var(--raio-p);
    cursor: pointer;
  }

  .abas-celular button.ativa {
    color: var(--texto);
    background: var(--superficie-2);
  }

  .livros {
    grid-template-columns: repeat(auto-fill, minmax(104px, 1fr));
    gap: var(--e4) var(--e3);
  }
}
</style>
