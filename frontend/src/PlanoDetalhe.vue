<script setup>
import { computed, ref } from 'vue'
import Icone from './Icone.vue'
import MarcaMeta from './MarcaMeta.vue'
import { somarDias } from './estatisticas.js'
import {
  NOMES_DA_SEMANA, SEMANA, apagarPlano, dataLonga, detalheDaMeta, nomeDaUnidade, nomeDoDia, reorganizar, resumo, rotuloDaMeta,
  lidas, situacao, urlDaCapa,
} from './planos.js'

// Um plano: o resumo, o calendário do cronograma e a lista de todas as metas, do início ao fim.
const props = defineProps({
  plano: { type: Object, required: true },
  hoje: { type: String, required: true },
  semConexao: { type: Boolean, default: false },
})
const emit = defineEmits(['voltar', 'editar', 'apagado', 'atualizado', 'marcar', 'abrir-livro'])

const formatoMes = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', month: 'long', year: 'numeric' })
const comoData = (dia) => new Date(`${dia}T12:00:00Z`)

const r = computed(() => resumo(props.plano, props.hoje))
const primeiroDia = computed(() => props.plano.goals[0]?.day ?? props.plano.start_day)
const mesInicial = () => {
  const dia = props.hoje >= primeiroDia.value && props.hoje <= r.value.fim ? props.hoje : primeiroDia.value
  return dia.slice(0, 7)
}
const mes = ref(mesInicial())
const diaEscolhido = ref(props.hoje >= primeiroDia.value && props.hoje <= r.value.fim ? props.hoje : primeiroDia.value)
const ocupado = ref(false)
const erro = ref('')
const mostrarTodas = ref(false)

const ritmo = computed(() => {
  const p = props.plano
  const dias = p.weekdays.length === 7
    ? 'todos os dias'
    : p.weekdays === '12345' ? 'de segunda a sexta'
    : [...p.weekdays].map((d) => NOMES_DA_SEMANA[Number(d)]).join(', ')
  return `${p.per_day} ${nomeDaUnidade(p, p.per_day)} por dia, ${dias}`
})

const metasPorDia = computed(() => {
  const mapa = new Map()
  for (const meta of props.plano.goals) {
    if (!mapa.has(meta.day)) mapa.set(meta.day, [])
    mapa.get(meta.day).push(meta)
  }
  return mapa
})

// A cor do dia no calendário: a pior situação entre as metas dele.
function situacaoDoDia(dia) {
  const metas = metasPorDia.value.get(dia)
  if (!metas) return ''
  const s = metas.map((m) => situacao(m, props.hoje))
  for (const pior of ['atrasada', 'nao-lida', 'hoje', 'futura']) if (s.includes(pior)) return pior
  return 'lida'
}

const NOMES_DA_SITUACAO = { lida: 'lida', 'nao-lida': 'não lida', atrasada: 'atrasada', hoje: 'para hoje', futura: 'a fazer' }

const calendario = computed(() => {
  const primeiro = `${mes.value}-01`
  const dias = []
  for (let dia = primeiro; dia.startsWith(mes.value); dia = somarDias(dia, 1)) {
    dias.push({ dia, numero: Number(dia.slice(8)), situacao: situacaoDoDia(dia) })
  }
  return { recuo: comoData(primeiro).getUTCDay(), dias, titulo: formatoMes.format(comoData(primeiro)) }
})

const podeVoltar = computed(() => mes.value > primeiroDia.value.slice(0, 7))
const podeAvancar = computed(() => mes.value < r.value.fim.slice(0, 7))

function mudarMes(n) {
  const [ano, m] = mes.value.split('-').map(Number)
  mes.value = new Date(Date.UTC(ano, m - 1 + n, 1, 12)).toISOString().slice(0, 7)
}

function rotuloDoDia(d) {
  const metas = metasPorDia.value.get(d.dia)
  if (!metas) return `${nomeDoDia(d.dia)}: sem meta`
  return `${nomeDoDia(d.dia)}: ${metas.map((m) => rotuloDaMeta(props.plano, m)).join(' e ')}, ${NOMES_DA_SITUACAO[d.situacao]}`
}

// A lista completa pode ser longa (um livro em páginas): mostra a partir de uma semana atrás.
const metasDaLista = computed(() => {
  if (mostrarTodas.value) return props.plano.goals
  const corte = somarDias(props.hoje, -7)
  return props.plano.goals.filter((m) => m.day >= corte || (m.state !== 'lida' && m.day < props.hoje))
})
const escondidas = computed(() => props.plano.goals.length - metasDaLista.value.length)

async function reorganizarAgora() {
  ocupado.value = true
  erro.value = ''
  try {
    emit('atualizado', await reorganizar(props.plano.id, props.hoje))
  } catch (e) {
    erro.value = e.message
  } finally {
    ocupado.value = false
  }
}

async function apagar() {
  if (!confirm(`Apagar o plano de "${props.plano.title}"? As metas e as marcações saem junto.`)) return
  ocupado.value = true
  erro.value = ''
  try {
    await apagarPlano(props.plano.id)
    emit('apagado', props.plano.id)
  } catch (e) {
    erro.value = e.message
    ocupado.value = false
  }
}
</script>

<template>
  <div class="detalhe">
    <button type="button" class="voltar" @click="emit('voltar')"><Icone nome="voltar" />Planos</button>

    <header class="cabeca-plano">
      <span class="capa">
        <img v-if="urlDaCapa(plano)" :src="urlDaCapa(plano)" alt="" />
        <span v-else class="titulo-na-capa" aria-hidden="true">{{ plano.title }}</span>
      </span>
      <div class="info">
        <h1>{{ plano.title }}</h1>
        <p v-if="plano.author" class="autor">{{ plano.author }}</p>
        <p class="ritmo">{{ ritmo }}</p>
        <span class="andamento" aria-hidden="true"><span :style="{ width: `${r.fracao * 100}%` }"></span></span>
        <p class="numeros">
          {{ r.lidas }} de {{ r.noPlano }} {{ nomeDaUnidade(plano, r.noPlano) }} {{ lidas(plano) }}
          · {{ r.concluido ? 'concluído' : `termina em ${nomeDoDia(r.fim)}` }}
        </p>
        <p v-if="plano.book_id" class="numeros">No leitor: {{ Math.round(plano.percent * 100) }}% do livro</p>
        <div class="acoes-topo">
          <button v-if="plano.book_id" type="button" class="principal" @click="emit('abrir-livro', plano.book_id)">Abrir o livro</button>
          <button type="button" class="secundario" :disabled="semConexao" @click="emit('editar')">Ajustar</button>
        </div>
      </div>
    </header>

    <div v-if="r.atrasadas" class="atraso" role="status">
      <p>
        <strong>{{ r.atrasadas === 1 ? '1 meta ficou para trás.' : `${r.atrasadas} metas ficaram para trás.` }}</strong>
        Marque o que você leu, ou leve o que falta para hoje em diante.
      </p>
      <button type="button" class="secundario" :disabled="ocupado || semConexao" @click="reorganizarAgora">Reorganizar a partir de hoje</button>
    </div>
    <p v-if="erro" class="falha" role="alert">{{ erro }}</p>

    <section class="secao" aria-labelledby="t-calendario">
      <div class="cabeca">
        <h2 id="t-calendario" class="rotulo">Calendário</h2>
        <div class="mes">
          <button type="button" class="seta" aria-label="Mês anterior" :disabled="!podeVoltar" @click="mudarMes(-1)"><Icone nome="voltar" /></button>
          <span class="nome-mes">{{ calendario.titulo }}</span>
          <button type="button" class="seta" aria-label="Próximo mês" :disabled="!podeAvancar" @click="mudarMes(1)"><Icone nome="avancar" /></button>
        </div>
      </div>
      <div class="calendario">
        <span v-for="(letra, i) in SEMANA" :key="`s${i}`" class="semana" aria-hidden="true">{{ letra }}</span>
        <span v-for="i in calendario.recuo" :key="`r${i}`" aria-hidden="true"></span>
        <button
          v-for="d in calendario.dias"
          :key="d.dia"
          type="button"
          class="dia"
          :class="[d.situacao === 'hoje' ? 'futura' : d.situacao, { hoje: d.dia === hoje, escolhido: d.dia === diaEscolhido }]"
          :aria-label="rotuloDoDia(d)"
          :aria-pressed="d.dia === diaEscolhido"
          @click="diaEscolhido = d.dia"
        >{{ d.numero }}</button>
      </div>
      <p class="legenda" aria-hidden="true">
        <span class="amostra lida"></span>lida
        <span class="amostra futura"></span>a fazer
        <span class="amostra atrasada"></span>atrasada
        <span class="amostra nao-lida"></span>não lida
      </p>

      <div class="do-dia">
        <p class="data-escolhida">{{ nomeDoDia(diaEscolhido) }}<template v-if="diaEscolhido === hoje"> · hoje</template></p>
        <ul v-if="metasPorDia.get(diaEscolhido)" class="metas">
          <li v-for="meta in metasPorDia.get(diaEscolhido)" :key="meta.id">
            <span class="texto-meta">
              <span class="rotulo-meta">{{ rotuloDaMeta(plano, meta) }}</span>
              <span v-if="detalheDaMeta(plano, meta)" class="detalhe-meta">{{ detalheDaMeta(plano, meta) }}</span>
            </span>
            <MarcaMeta :estado="meta.state" :rotulo="rotuloDaMeta(plano, meta)" @mudar="emit('marcar', meta, $event)" />
          </li>
        </ul>
        <p v-else class="suave">Sem meta neste dia.</p>
      </div>
    </section>

    <section class="secao" aria-labelledby="t-cronograma">
      <h2 id="t-cronograma" class="rotulo">Cronograma</h2>
      <p class="suave">Do {{ dataLonga(primeiroDia) }} ao {{ dataLonga(r.fim) }}.</p>
      <button v-if="escondidas" type="button" class="link" @click="mostrarTodas = true">{{ escondidas === 1 ? 'Mostrar a meta anterior' : `Mostrar as ${escondidas} metas anteriores` }}</button>
      <ul class="metas lista">
        <li v-for="meta in metasDaLista" :key="meta.id" :class="situacao(meta, hoje)">
          <span class="quando">{{ nomeDoDia(meta.day) }}</span>
          <span class="texto-meta">
            <span class="rotulo-meta">{{ rotuloDaMeta(plano, meta) }}</span>
            <span v-if="detalheDaMeta(plano, meta)" class="detalhe-meta">{{ detalheDaMeta(plano, meta) }}</span>
            <span v-if="situacao(meta, hoje) === 'atrasada'" class="selo">atrasada</span>
            <span v-else-if="meta.day === hoje" class="selo hoje">hoje</span>
          </span>
          <MarcaMeta :estado="meta.state" :rotulo="rotuloDaMeta(plano, meta)" @mudar="emit('marcar', meta, $event)" />
        </li>
      </ul>
    </section>

    <button type="button" class="apagar" :disabled="ocupado || semConexao" @click="apagar">Apagar o plano</button>
  </div>
</template>

<style scoped>
.detalhe {
  max-width: 48rem;
}

.voltar {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  min-height: 36px;
  margin: 0 0 1rem -0.375rem;
  padding: 0 0.5rem 0 0.25rem;
  font: inherit;
  font-size: 0.875rem;
  color: var(--texto-suave);
  background: transparent;
  border: 0;
  border-radius: var(--raio-p);
  cursor: pointer;
}

.voltar:hover {
  color: var(--texto);
  background: var(--superficie);
}

.voltar :deep(svg) {
  width: 18px;
  height: 18px;
}

.cabeca-plano {
  display: flex;
  gap: 1.5rem;
  align-items: flex-start;
  margin-bottom: 1.75rem;
}

.capa {
  flex: none;
  width: 7.5rem;
  aspect-ratio: 2 / 3;
  overflow: hidden;
  background: var(--superficie);
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
  padding: 0.5rem;
  color: var(--texto-suave);
  font-family: var(--leitura);
  font-size: 0.875rem;
  text-align: center;
}

.info {
  display: grid;
  flex: 1;
  gap: 0.25rem;
  min-width: 0;
}

.info p {
  margin: 0;
}

h1 {
  margin: 0;
  font-size: 1.6rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.2;
}

.autor {
  color: var(--texto-suave);
}

.ritmo {
  margin-top: 0.5rem !important;
  font-size: 0.9375rem;
}

.numeros {
  color: var(--texto-suave);
  font-size: 0.8125rem;
  font-variant-numeric: tabular-nums;
}

.andamento {
  display: block;
  height: 4px;
  margin: 0.625rem 0 0.25rem;
  overflow: hidden;
  background: var(--superficie-forte);
  border-radius: 2px;
}

.andamento span {
  display: block;
  height: 100%;
  background: var(--marca);
}

.acoes-topo {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 0.75rem;
}

.principal,
.secundario,
.apagar {
  min-height: 38px;
  padding: 0 0.875rem;
  font: inherit;
  font-size: 0.875rem;
  border-radius: var(--raio-p);
  cursor: pointer;
}

.principal {
  font-weight: 600;
  color: var(--destaque-texto);
  background: var(--destaque);
  border: 0;
}

.secundario {
  color: var(--texto);
  background: transparent;
  border: 1px solid var(--superficie-forte);
}

.secundario:hover:not(:disabled) {
  background: var(--superficie);
}

button:disabled {
  opacity: 0.5;
  cursor: default;
}

.atraso {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1.5rem;
  padding: 0.875rem 1rem;
  background: var(--vermelho-fundo);
  border-radius: var(--raio);
}

.atraso p {
  flex: 1 1 18rem;
  margin: 0;
  font-size: 0.9rem;
}

.atraso strong {
  font-weight: 600;
}

.falha {
  color: var(--perigo);
}

.secao {
  margin-bottom: 2.25rem;
}

.cabeca {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.5rem;
}

.cabeca .rotulo,
.secao > .rotulo {
  margin: 0 0 0.5rem;
}

.mes {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.nome-mes {
  min-width: 8.5rem;
  font-size: 0.875rem;
  font-weight: 500;
  text-align: center;
}

.nome-mes::first-letter {
  text-transform: uppercase;
}

.seta {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  padding: 0;
  color: var(--texto-suave);
  background: transparent;
  border: 0;
  border-radius: 999px;
  cursor: pointer;
}

.seta:hover:not(:disabled) {
  color: var(--texto);
  background: var(--superficie);
}

.seta :deep(svg) {
  width: 18px;
  height: 18px;
}

.calendario {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 3rem));
  gap: 4px;
}

.semana {
  color: var(--texto-fraco);
  font-size: 0.6875rem;
  font-weight: 600;
  text-align: center;
}

/* Cada dia com meta ganha a cor da situação: azul lida, contorno a fazer, vermelho atrasada. */
.dia {
  aspect-ratio: 1;
  padding: 0;
  font: inherit;
  font-size: 0.8125rem;
  font-variant-numeric: tabular-nums;
  color: var(--texto-fraco);
  background: transparent;
  border: 0;
  border-radius: var(--raio-p);
  cursor: pointer;
}

.dia.futura {
  color: var(--texto);
  box-shadow: inset 0 0 0 1.5px var(--marca);
}

.dia.lida {
  color: var(--marca-texto);
  font-weight: 600;
  background: var(--marca);
}

.dia.atrasada {
  color: var(--vermelho);
  font-weight: 600;
  box-shadow: inset 0 0 0 1.5px var(--vermelho);
}

.dia.nao-lida {
  color: var(--vermelho);
  background: var(--vermelho-fundo);
}

.dia.hoje {
  text-decoration: underline;
  text-underline-offset: 3px;
}

.dia.escolhido {
  outline: 2px solid var(--texto);
  outline-offset: 1px;
}

.legenda {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.25rem 0.375rem;
  margin: 0.75rem 0 0;
  color: var(--texto-fraco);
  font-size: 0.75rem;
}

.amostra {
  display: inline-block;
  width: 12px;
  height: 12px;
  margin-left: 0.375rem;
  border-radius: 3px;
}

.amostra:first-child {
  margin-left: 0;
}

.amostra.lida {
  background: var(--marca);
}

.amostra.futura {
  box-shadow: inset 0 0 0 1.5px var(--marca);
}

.amostra.atrasada {
  box-shadow: inset 0 0 0 1.5px var(--vermelho);
}

.amostra.nao-lida {
  background: var(--vermelho-fundo);
  box-shadow: inset 0 0 0 1px var(--vermelho);
}

.do-dia {
  margin-top: 1.25rem;
  padding: 0.875rem 1rem;
  background: var(--superficie);
  border-radius: var(--raio);
}

.data-escolhida {
  margin: 0 0 0.375rem;
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--texto-suave);
}

.metas {
  margin: 0;
  padding: 0;
  list-style: none;
}

.metas li {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  padding: 0.5rem 0;
}

.lista {
  border-top: 1px solid var(--linha);
}

.lista li {
  padding: 0.625rem 0;
  border-bottom: 1px solid var(--linha);
}

.lista li.lida .rotulo-meta {
  color: var(--texto-suave);
}

.quando {
  flex: none;
  width: 6.5rem;
  color: var(--texto-suave);
  font-size: 0.8125rem;
  font-variant-numeric: tabular-nums;
}

.texto-meta {
  display: flex;
  flex: 1;
  flex-wrap: wrap;
  gap: 0.125rem 0.5rem;
  align-items: baseline;
  min-width: 0;
}

.rotulo-meta {
  font-size: 0.9375rem;
  overflow-wrap: anywhere;
}

.detalhe-meta {
  color: var(--texto-fraco);
  font-size: 0.75rem;
}

.selo {
  padding: 0.0625rem 0.375rem;
  color: var(--vermelho);
  font-size: 0.6875rem;
  font-weight: 600;
  background: var(--vermelho-fundo);
  border-radius: 4px;
}

.selo.hoje {
  color: var(--marca);
  background: var(--marca-fundo);
}

.suave {
  margin: 0 0 0.75rem;
  color: var(--texto-suave);
  font-size: 0.8125rem;
}

.do-dia .suave {
  margin: 0;
}

.link {
  margin-bottom: 0.5rem;
  padding: 0;
  font: inherit;
  font-size: 0.8125rem;
  color: var(--marca);
  background: transparent;
  border: 0;
  cursor: pointer;
}

.apagar {
  color: var(--perigo);
  background: transparent;
  border: 1px solid var(--linha);
}

@media (max-width: 47.99rem) {
  .cabeca-plano {
    gap: 1rem;
  }

  .capa {
    width: 5.5rem;
  }

  h1 {
    font-size: 1.35rem;
  }

  .calendario {
    grid-template-columns: repeat(7, minmax(0, 1fr));
  }

  .lista li {
    flex-wrap: wrap;
  }

  .quando {
    width: auto;
    flex-basis: 100%;
  }
}
</style>
