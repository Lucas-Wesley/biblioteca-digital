<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import Icone from './Icone.vue'
import MetasDeHoje from './MetasDeHoje.vue'
import PlanoDetalhe from './PlanoDetalhe.vue'
import PlanoFormulario from './PlanoFormulario.vue'
import { diaDe, lerRegistros } from './leitura.js'
import {
  ancorasDaMeta, estadoDoPlano, guardarPlanos, lerPlanos, lidas, marcarMeta, metaParaLer, nomeDaUnidade, nomeDoDia, resumo, rotuloDaMeta, urlDaCapa,
} from './planos.js'

// Planos de leitura (R35): a lista de planos, as metas de hoje e o caminho para criar, ver e ajustar.
// planoInicial: o plano a abrir direto (vindo da meta de hoje no Início).
const props = defineProps({ livros: { type: Array, required: true }, planoInicial: { type: String, default: '' } })
const emit = defineEmits(['abrir'])

const planos = ref([])
const semConexao = ref(false)
const carregou = ref(false)
const hoje = ref(diaDe(new Date()))
const modo = ref(props.planoInicial ? 'detalhe' : 'lista')
const idAberto = ref(props.planoInicial || null)
const abrindoMeta = ref('')
const erroAoAbrir = ref('')
// Os registros das Estatísticas dão o ritmo de leitura para estimar o tempo das metas (R37).
const registros = ref([])

// A situação do plano numa etiqueta do design system: atraso em vermelho, hoje em azul, feito em verde.
const CORES_DO_ESTADO = { atrasado: 'vermelho', 'falta-marcar': 'vermelho', hoje: 'azul', feito: 'verde' }
const corDoEstado = (tipo) => CORES_DO_ESTADO[tipo] ?? ''

const aberto = computed(() => planos.value.find((p) => p.id === idAberto.value) ?? null)
const comResumo = computed(() => planos.value.map((plano) => ({ plano, r: resumo(plano, hoje.value) })))
const emAndamento = computed(() => comResumo.value.filter((x) => !x.r.concluido))
const concluidos = computed(() => comResumo.value.filter((x) => x.r.concluido))

async function carregar() {
  hoje.value = diaDe(new Date())
  const resultado = await lerPlanos()
  planos.value = resultado.planos
  semConexao.value = resultado.semConexao
  carregou.value = true
  lerRegistros().then((r) => (registros.value = r.registros)).catch(() => {})
}

// A cópia no aparelho acompanha a lista: o leitor acha nela a meta do livro, mesmo sem rede.
watch(planos, (lista) => carregou.value && guardarPlanos(lista), { deep: true })

function abrir(plano) {
  idAberto.value = plano.id
  modo.value = 'detalhe'
  window.scrollTo?.(0, 0)
}

function marcar(plano, meta, estado) {
  marcarMeta(planos.value, plano, meta, estado)
}

function aoSalvar(plano) {
  const i = planos.value.findIndex((p) => p.id === plano.id)
  if (i >= 0) planos.value[i] = plano
  else planos.value.push(plano)
  abrir(plano)
}

// Mudou no próprio plano aberto (reorganizar, capítulos fora do plano): fica onde está na tela.
function aoAtualizar(plano) {
  const i = planos.value.findIndex((p) => p.id === plano.id)
  if (i >= 0) planos.value[i] = plano
}

function aoApagar(id) {
  planos.value = planos.value.filter((p) => p.id !== id)
  modo.value = 'lista'
}

// O play: abre o livro digital no começo da meta para ler (a primeira ainda não lida).
async function lerMeta(plano) {
  erroAoAbrir.value = ''
  const livro = props.livros.find((l) => l.id === plano.book_id)
  if (!livro) {
    erroAoAbrir.value = `"${plano.title}" não está mais na biblioteca.`
    return
  }
  const meta = metaParaLer(plano)
  let ancora = ''
  abrindoMeta.value = plano.id
  try {
    if (meta) ancora = (await ancorasDaMeta(plano, meta)).inicio
  } catch {
    // Sem achar o ponto (fora de casa, por exemplo), o livro abre onde parou.
  } finally {
    abrindoMeta.value = ''
  }
  emit('abrir', livro, ancora, plano.id)
}

function textoDoPlay(plano) {
  const meta = metaParaLer(plano)
  return meta ? `Ler a meta: ${rotuloDaMeta(plano, meta)}` : `Abrir ${plano.title}`
}

onMounted(carregar)
</script>

<template>
  <PlanoFormulario
    v-if="modo === 'novo' || (modo === 'editar' && aberto)"
    :key="modo + (aberto?.id ?? '')"
    :livros="livros"
    :plano="modo === 'editar' ? aberto : null"
    :hoje="hoje"
    :registros="registros"
    @salvo="aoSalvar"
    @cancelar="modo = aberto && modo === 'editar' ? 'detalhe' : 'lista'"
  />

  <PlanoDetalhe
    v-else-if="modo === 'detalhe' && aberto"
    :plano="aberto"
    :hoje="hoje"
    :sem-conexao="semConexao"
    :registros="registros"
    @voltar="modo = 'lista'"
    @editar="modo = 'editar'"
    @apagado="aoApagar"
    @atualizado="aoAtualizar"
    @marcar="(meta, estado) => marcar(aberto, meta, estado)"
    @ler-meta="lerMeta(aberto)"
  />

  <template v-else>
    <div class="topo-pagina">
      <h1>Planos de leitura</h1>
      <button type="button" class="botao primario" :disabled="semConexao" @click="modo = 'novo'"><Icone nome="mais" />Novo plano</button>
    </div>

    <p v-if="erroAoAbrir" class="aviso falha" role="alert">{{ erroAoAbrir }}</p>
    <p v-if="semConexao" class="aviso neutro">Sem conexão com a sua rede: mostrando a última versão vista. O que você marcar sobe quando voltar.</p>

    <template v-if="carregou && !planos.length">
      <p class="explicacao">
        Nenhum plano ainda. Um plano divide o livro em metas por dia, por capítulos ou por páginas, e mostra quando você termina.
        Serve para os livros da biblioteca e também para os físicos.
      </p>
    </template>

    <div v-else-if="carregou" class="colunas-com-lateral com-lateral">
      <div class="lateral">
        <MetasDeHoje :planos="planos" :livros="livros" :hoje="hoje" :registros="registros" @abrir-plano="abrir" @abrir="(...args) => emit('abrir', ...args)" />
      </div>

      <div class="principal">
        <section v-if="emAndamento.length" class="grupo" aria-labelledby="t-andamento">
          <h2 id="t-andamento" class="rotulo-secao">Em andamento <span class="contagem">{{ emAndamento.length }}</span></h2>
          <ul class="planos">
            <li v-for="{ plano, r } in emAndamento" :key="plano.id" class="com-play">
              <button type="button" class="plano" @click="abrir(plano)">
                <span class="capa-livro">
                  <img v-if="urlDaCapa(plano)" :src="urlDaCapa(plano)" alt="" />
                  <span v-else class="titulo-na-capa" aria-hidden="true">{{ plano.title }}</span>
                </span>
                <span class="dados">
                  <span class="titulo">{{ plano.title }}</span>
                  <span v-if="plano.author" class="suave">{{ plano.author }}</span>
                  <span class="linha-valor">
                    <span class="estado etiqueta" :class="corDoEstado(estadoDoPlano(plano, hoje).tipo)">{{ estadoDoPlano(plano, hoje).texto }}</span>
                    <span class="pequeno">{{ Math.round(r.fracao * 100) }}%</span>
                  </span>
                  <span class="progresso" aria-hidden="true"><span :style="{ width: `${r.fracao * 100}%` }"></span></span>
                  <span class="suave">{{ r.lidas }} de {{ r.noPlano }} {{ nomeDaUnidade(plano, r.noPlano) }} · termina em {{ nomeDoDia(r.fim) }}</span>
                  <span v-if="r.proxima" class="suave">Próxima: {{ rotuloDaMeta(plano, r.proxima) }}, {{ r.proxima.day === hoje ? 'hoje' : nomeDoDia(r.proxima.day) }}</span>
                </span>
              </button>
              <button
                v-if="plano.book_id"
                type="button"
                class="botao icone play"
                :aria-label="textoDoPlay(plano)"
                :title="textoDoPlay(plano)"
                :disabled="abrindoMeta === plano.id"
                @click="lerMeta(plano)"
              ><Icone nome="play" :tamanho="14" /></button>
            </li>
          </ul>
        </section>

        <section v-if="concluidos.length" class="grupo" aria-labelledby="t-concluidos">
          <h2 id="t-concluidos" class="rotulo-secao">Concluídos <span class="contagem">{{ concluidos.length }}</span></h2>
          <ul class="planos">
            <li v-for="{ plano, r } in concluidos" :key="plano.id">
              <button type="button" class="plano" @click="abrir(plano)">
                <span class="capa-livro">
                  <img v-if="urlDaCapa(plano)" :src="urlDaCapa(plano)" alt="" />
                  <span v-else class="titulo-na-capa" aria-hidden="true">{{ plano.title }}</span>
                </span>
                <span class="dados">
                  <span class="titulo">{{ plano.title }}</span>
                  <span v-if="plano.author" class="suave">{{ plano.author }}</span>
                  <span class="suave">{{ r.noPlano }} {{ nomeDaUnidade(plano, r.noPlano) }} {{ lidas(plano) }}</span>
                </span>
              </button>
            </li>
          </ul>
        </section>
      </div>
    </div>
  </template>
</template>

<style scoped>
.topo-pagina > .botao:last-child {
  margin-left: auto;
}

.explicacao {
  max-width: var(--leitura);
  color: var(--texto-suave);
  line-height: 1.55;
}

.aviso {
  max-width: var(--leitura);
  margin: 0 0 var(--e4);
}

.principal {
  display: grid;
  gap: var(--e5);
}

.grupo > .rotulo-secao {
  margin-bottom: var(--e3);
}

.contagem {
  margin-left: var(--e1);
  color: var(--texto-fraco);
  font-variant-numeric: tabular-nums;
}

.planos {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: var(--e3);
  margin: 0;
  padding: 0;
  list-style: none;
}

.plano {
  display: flex;
  gap: var(--e3);
  width: 100%;
  height: 100%;
  padding: var(--e3);
  text-align: left;
  background: var(--fundo);
  border: 1px solid var(--borda);
  border-radius: var(--raio);
  cursor: pointer;
  transition: border-color var(--transicao), background var(--transicao);
}

.plano:hover {
  background: var(--superficie);
  border-color: var(--borda-forte);
}

.plano .capa-livro {
  flex: none;
  align-self: flex-start;
  width: 56px;
}

.dados {
  display: grid;
  flex: 1;
  gap: 3px;
  align-content: start;
  min-width: 0;
}

.titulo {
  font-size: 14.5px;
  font-weight: 600;
  line-height: 1.3;
}

.suave {
  font-size: 13px;
}

.linha-valor {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--e2);
  margin-top: var(--e1);
}

.estado.etiqueta {
  height: auto;
  min-height: 20px;
  padding-block: 1px;
  white-space: normal;
}

.dados .progresso {
  margin-bottom: var(--e1);
}

/* O play fica no canto do cartão, fora do botão que abre o plano. */
.com-play {
  position: relative;
}

.com-play .plano {
  padding-right: 56px;
}

.com-play .play {
  position: absolute;
  top: var(--e3);
  right: var(--e3);
}

.play:disabled {
  cursor: progress;
}

@media (max-width: 699px) {
  .planos {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
