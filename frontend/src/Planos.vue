<script setup>
import { computed, onMounted, ref } from 'vue'
import MarcaMeta from './MarcaMeta.vue'
import PlanoDetalhe from './PlanoDetalhe.vue'
import PlanoFormulario from './PlanoFormulario.vue'
import { diaDe } from './leitura.js'
import { lerPlanos, lidas, marcarMeta, nomeDaUnidade, nomeDoDia, resumo, rotuloDaMeta, urlDaCapa } from './planos.js'

// Planos de leitura (R35): a lista de planos, as metas de hoje e o caminho para criar, ver e ajustar.
const props = defineProps({ livros: { type: Array, required: true } })
const emit = defineEmits(['abrir'])

const planos = ref([])
const semConexao = ref(false)
const carregou = ref(false)
const hoje = ref(diaDe(new Date()))
const modo = ref('lista')
const idAberto = ref(null)

const aberto = computed(() => planos.value.find((p) => p.id === idAberto.value) ?? null)
const comResumo = computed(() => planos.value.map((plano) => ({ plano, r: resumo(plano, hoje.value) })))
const emAndamento = computed(() => comResumo.value.filter((x) => !x.r.concluido))
const concluidos = computed(() => comResumo.value.filter((x) => x.r.concluido))

// As metas de hoje, de todos os planos, para marcar sem abrir cada um.
const deHoje = computed(() =>
  comResumo.value.flatMap(({ plano, r }) => r.hoje.map((meta) => ({ plano, meta, atrasadas: r.atrasadas }))),
)
const atrasadasNoTotal = computed(() => emAndamento.value.reduce((n, x) => n + x.r.atrasadas, 0))

async function carregar() {
  hoje.value = diaDe(new Date())
  const resultado = await lerPlanos()
  planos.value = resultado.planos
  semConexao.value = resultado.semConexao
  carregou.value = true
}

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

function aoApagar(id) {
  planos.value = planos.value.filter((p) => p.id !== id)
  modo.value = 'lista'
}

function abrirLivro(id) {
  const livro = props.livros.find((l) => l.id === id)
  if (livro) emit('abrir', livro)
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
    @salvo="aoSalvar"
    @cancelar="modo = aberto && modo === 'editar' ? 'detalhe' : 'lista'"
  />

  <PlanoDetalhe
    v-else-if="modo === 'detalhe' && aberto"
    :plano="aberto"
    :hoje="hoje"
    :sem-conexao="semConexao"
    @voltar="modo = 'lista'"
    @editar="modo = 'editar'"
    @apagado="aoApagar"
    @atualizado="aoSalvar"
    @marcar="(meta, estado) => marcar(aberto, meta, estado)"
    @abrir-livro="abrirLivro"
  />

  <template v-else>
    <div class="cabecalho">
      <h1>Planos de leitura</h1>
      <button type="button" class="novo" :disabled="semConexao" @click="modo = 'novo'">Novo plano</button>
    </div>

    <p v-if="semConexao" class="aviso">Sem conexão com a sua rede: mostrando a última versão vista. O que você marcar sobe quando voltar.</p>

    <template v-if="carregou && !planos.length">
      <p class="vazio">
        Nenhum plano ainda. Um plano divide o livro em metas por dia, por capítulos ou por páginas, e mostra quando você termina.
        Serve para os livros da biblioteca e também para os físicos.
      </p>
    </template>

    <template v-else-if="carregou">
      <section class="secao" aria-labelledby="t-hoje">
        <h2 id="t-hoje" class="rotulo">Hoje</h2>
        <ul v-if="deHoje.length" class="metas">
          <li v-for="{ plano, meta } in deHoje" :key="meta.id">
            <button type="button" class="texto-meta" @click="abrir(plano)">
              <span class="nome-livro">{{ plano.title }}</span>
              <span class="rotulo-meta">{{ rotuloDaMeta(plano, meta) }}</span>
            </button>
            <MarcaMeta :estado="meta.state" :rotulo="`${plano.title}: ${rotuloDaMeta(plano, meta)}`" @mudar="marcar(plano, meta, $event)" />
          </li>
        </ul>
        <p v-else class="vazio">Nenhuma meta para hoje.</p>
        <p v-if="atrasadasNoTotal" class="atraso">
          {{ atrasadasNoTotal === 1 ? '1 meta ficou para trás' : `${atrasadasNoTotal} metas ficaram para trás` }}. Abra o plano para marcar ou reorganizar.
        </p>
      </section>

      <section v-if="emAndamento.length" class="secao" aria-labelledby="t-andamento">
        <h2 id="t-andamento" class="rotulo">Em andamento</h2>
        <ul class="planos">
          <li v-for="{ plano, r } in emAndamento" :key="plano.id">
            <button type="button" class="plano" @click="abrir(plano)">
              <span class="capa">
                <img v-if="urlDaCapa(plano)" :src="urlDaCapa(plano)" alt="" />
                <span v-else class="titulo-na-capa" aria-hidden="true">{{ plano.title }}</span>
              </span>
              <span class="dados">
                <span class="titulo">{{ plano.title }}</span>
                <span v-if="plano.author" class="suave">{{ plano.author }}</span>
                <span class="andamento" aria-hidden="true"><span :style="{ width: `${r.fracao * 100}%` }"></span></span>
                <span class="suave">{{ r.lidas }} de {{ r.noPlano }} {{ nomeDaUnidade(plano, r.noPlano) }} · termina em {{ nomeDoDia(r.fim) }}</span>
                <span v-if="r.proxima" class="suave">Próxima: {{ rotuloDaMeta(plano, r.proxima) }}, {{ r.proxima.day === hoje ? 'hoje' : nomeDoDia(r.proxima.day) }}</span>
                <span v-if="r.atrasadas" class="selo">{{ r.atrasadas === 1 ? '1 atrasada' : `${r.atrasadas} atrasadas` }}</span>
              </span>
            </button>
          </li>
        </ul>
      </section>

      <section v-if="concluidos.length" class="secao" aria-labelledby="t-concluidos">
        <h2 id="t-concluidos" class="rotulo">Concluídos</h2>
        <ul class="planos">
          <li v-for="{ plano, r } in concluidos" :key="plano.id">
            <button type="button" class="plano" @click="abrir(plano)">
              <span class="capa">
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
    </template>
  </template>
</template>

<style scoped>
.cabecalho {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  max-width: 48rem;
  margin-bottom: 1.5rem;
}

h1 {
  margin: 0;
  font-size: 1.75rem;
  font-weight: 700;
  letter-spacing: -0.022em;
}

.novo {
  min-height: 38px;
  padding: 0 1rem;
  font: inherit;
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--destaque-texto);
  background: var(--destaque);
  border: 0;
  border-radius: var(--raio-p);
  cursor: pointer;
}

.novo:disabled {
  opacity: 0.5;
  cursor: default;
}

.aviso,
.vazio {
  max-width: 40rem;
  color: var(--texto-suave);
  font-size: 0.9375rem;
}

.aviso {
  margin: -0.75rem 0 1.5rem;
}

.secao {
  max-width: 48rem;
  margin-bottom: 2.25rem;
}

.secao > .rotulo {
  margin: 0 0 0.75rem;
}

.metas {
  margin: 0;
  padding: 0;
  list-style: none;
  border-top: 1px solid var(--linha);
}

.metas li {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  padding: 0.625rem 0;
  border-bottom: 1px solid var(--linha);
}

.texto-meta {
  display: grid;
  flex: 1;
  gap: 0.125rem;
  min-width: 0;
  padding: 0;
  text-align: left;
  background: transparent;
  border: 0;
  cursor: pointer;
}

.nome-livro {
  color: var(--texto-suave);
  font-size: 0.8125rem;
}

.rotulo-meta {
  font-size: 0.9375rem;
  font-weight: 500;
  overflow-wrap: anywhere;
}

.atraso {
  margin: 0.75rem 0 0;
  color: var(--vermelho);
  font-size: 0.875rem;
}

.planos {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(20rem, 1fr));
  gap: 0.75rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.plano {
  display: flex;
  gap: 1rem;
  width: 100%;
  height: 100%;
  padding: 0.875rem;
  text-align: left;
  background: var(--superficie);
  border: 0;
  border-radius: var(--raio-g);
  cursor: pointer;
  transition: background 0.15s ease;
}

.plano:hover {
  background: var(--superficie-forte);
}

.capa {
  flex: none;
  width: 4.5rem;
  aspect-ratio: 2 / 3;
  align-self: flex-start;
  overflow: hidden;
  background: var(--fundo);
  border-radius: 4px;
  box-shadow: 0 0 0 1px var(--linha), 0 4px 14px rgb(0 0 0 / 10%);
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
  padding: 0.375rem;
  color: var(--texto-suave);
  font-family: var(--leitura);
  font-size: 0.6875rem;
  line-height: 1.25;
  text-align: center;
}

.dados {
  display: grid;
  flex: 1;
  gap: 0.2rem;
  align-content: start;
  min-width: 0;
}

.titulo {
  font-weight: 600;
  line-height: 1.3;
}

.suave {
  color: var(--texto-suave);
  font-size: 0.8125rem;
}

.andamento {
  display: block;
  height: 3px;
  margin: 0.375rem 0 0.125rem;
  overflow: hidden;
  background: var(--superficie-forte);
  border-radius: 2px;
}

.andamento span {
  display: block;
  height: 100%;
  background: var(--marca);
}

.selo {
  justify-self: start;
  margin-top: 0.25rem;
  padding: 0.0625rem 0.375rem;
  color: var(--vermelho);
  font-size: 0.6875rem;
  font-weight: 600;
  background: var(--vermelho-fundo);
  border-radius: 4px;
}

@media (max-width: 47.99rem) {
  h1 {
    font-size: 1.5rem;
  }

  .planos {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
