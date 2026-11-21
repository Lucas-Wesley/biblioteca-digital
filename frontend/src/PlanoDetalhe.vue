<script setup>
import { computed, ref } from 'vue'
import Icone from './Icone.vue'
import MarcaMeta from './MarcaMeta.vue'
import { somarDias } from './estatisticas.js'
import {
  NOMES_DA_SEMANA, SEMANA, apagarPlano, paginasPorDia, ritmoDeLeitura, tempoDaMeta, tempoDeLeitura, estadoDoPlano, metaParaLer, dataLonga, detalheDaMeta, nomeDaUnidade, nomeDoDia, reorganizar, resumo, rotuloDaMeta,
  lidas, situacao, urlDaCapa, ajustarPlano, parteForaDoPlano,
} from './planos.js'

// Um plano: o resumo, o calendário do cronograma e a lista de todas as metas, do início ao fim.
const props = defineProps({
  plano: { type: Object, required: true },
  hoje: { type: String, required: true },
  semConexao: { type: Boolean, default: false },
  registros: { type: Array, default: () => [] },
})
const emit = defineEmits(['voltar', 'editar', 'apagado', 'atualizado', 'marcar', 'ler-meta'])

const formatoMes = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', month: 'long', year: 'numeric' })
const comoData = (dia) => new Date(`${dia}T12:00:00Z`)

const r = computed(() => resumo(props.plano, props.hoje))
// A situação numa etiqueta do design system: atraso em vermelho, hoje em azul, feito em verde.
const CORES_DO_ESTADO = { atrasado: 'vermelho', 'falta-marcar': 'vermelho', hoje: 'azul', feito: 'verde', concluido: 'verde' }
const corDoEstado = computed(() => CORES_DO_ESTADO[estadoDoPlano(props.plano, props.hoje).tipo] ?? '')
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

// O tempo estimado de cada meta e de um dia médio (R37), pelo ritmo das Estatísticas.
const ritmoDeLeituraDoPlano = computed(() => ritmoDeLeitura(props.registros, props.plano.book_id))
const tempoPorDia = computed(() => tempoDeLeitura(paginasPorDia(props.plano), ritmoDeLeituraDoPlano.value))
function detalhe(meta) {
  return [detalheDaMeta(props.plano, meta), tempoDaMeta(props.plano, meta, ritmoDeLeituraDoPlano.value)].filter(Boolean).join(' · ')
}

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

// Capítulos que entram no plano (R41): tirar ou pôr um refaz o cronograma de hoje em diante e
// guarda o que já foi lido, como "Ajustar".
const capitulos = computed(() => (props.plano.unit === 'capitulos' ? props.plano.chapters ?? [] : []))
const capitulosDentro = computed(() => capitulos.value.filter((c) => !c.skip).length)
const sugestao = (c, i) => parteForaDoPlano(c.title, i, capitulos.value.length)

async function mudarCapitulos(chapters, evento) {
  ocupado.value = true
  erro.value = ''
  const p = props.plano
  try {
    emit('atualizado', await ajustarPlano(p.id, {
      title: p.title, author: p.author, publisher: p.publisher, isbn: p.isbn, book_id: p.book_id, unit: p.unit, total: p.total,
      first: p.first, per_day: p.per_day, weekdays: p.weekdays, start_day: p.start_day, chapters, today: props.hoje,
    }))
  } catch (e) {
    erro.value = e.message
    if (evento) evento.target.checked = !evento.target.checked
  } finally {
    ocupado.value = false
  }
}

function alternarCapitulo(i, evento) {
  mudarCapitulos(capitulos.value.map((c, j) => ({ ...c, skip: (j === i ? !evento.target.checked : c.skip) || undefined })), evento)
}

const incluirTodos = () => mudarCapitulos(capitulos.value.map((c) => ({ ...c, skip: undefined })))

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
    <button type="button" class="voltar-ajustes voltar" @click="emit('voltar')"><Icone nome="voltar" />Planos</button>

    <div class="topo-pagina">
      <h1>{{ plano.title }}</h1>
      <div class="acoes">
        <button type="button" class="botao" :disabled="semConexao" @click="emit('editar')">Ajustar</button>
        <button v-if="plano.book_id" type="button" class="botao primario ler" @click="emit('ler-meta')">
          <Icone nome="play" :tamanho="14" /><span>{{ metaParaLer(plano) ? `Ler a meta: ${rotuloDaMeta(plano, metaParaLer(plano))}` : 'Abrir o livro' }}</span>
        </button>
      </div>
    </div>

    <div class="colunas-com-lateral com-lateral">
      <aside class="lateral" aria-label="Progresso do plano">
        <section class="quadro resumo-plano">
          <div class="quadro-topo">
            <h2 class="rotulo-secao">Progresso</h2>
            <span class="pequeno">{{ Math.round(r.fracao * 100) }}%</span>
          </div>
          <div class="cabeca-plano">
            <span class="capa-livro">
              <img v-if="urlDaCapa(plano)" :src="urlDaCapa(plano)" alt="" />
              <span v-else class="titulo-na-capa" aria-hidden="true">{{ plano.title }}</span>
            </span>
            <div class="info">
              <p v-if="plano.author" class="autor">{{ plano.author }}</p>
              <p class="estado etiqueta" :class="corDoEstado">{{ estadoDoPlano(plano, hoje).texto }}</p>
            </div>
          </div>
          <span class="progresso" aria-hidden="true"><span :style="{ width: `${r.fracao * 100}%` }"></span></span>
          <p class="numeros">
            {{ r.lidas }} de {{ r.noPlano }} {{ nomeDaUnidade(plano, r.noPlano) }} {{ lidas(plano) }}
            · {{ r.concluido ? 'concluído' : `termina em ${nomeDoDia(r.fim)}` }}
          </p>
          <p v-if="plano.book_id" class="numeros">No leitor: {{ Math.round(plano.percent * 100) }}% do livro</p>
          <p class="ritmo">{{ ritmo }}<template v-if="tempoPorDia"> · {{ tempoPorDia }} por dia</template></p>
        </section>
      </aside>

      <div class="principal">
        <div v-if="r.atrasadas" class="atraso" role="status">
          <p>
            <strong>{{ r.atrasadas === 1 ? '1 meta ficou para trás.' : `${r.atrasadas} metas ficaram para trás.` }}</strong>
            Marque o que você leu, ou leve o que falta para hoje em diante.
          </p>
          <button type="button" class="botao" :disabled="ocupado || semConexao" @click="reorganizarAgora">Reorganizar a partir de hoje</button>
        </div>
        <p v-if="erro" class="aviso" role="alert">{{ erro }}</p>

        <section class="quadro" aria-labelledby="t-calendario">
          <div class="quadro-topo">
            <h2 id="t-calendario" class="rotulo-secao">Calendário</h2>
            <div class="mes">
              <button type="button" class="botao discreto icone" aria-label="Mês anterior" :disabled="!podeVoltar" @click="mudarMes(-1)"><Icone nome="voltar" /></button>
              <span class="nome-mes">{{ calendario.titulo }}</span>
              <button type="button" class="botao discreto icone" aria-label="Próximo mês" :disabled="!podeAvancar" @click="mudarMes(1)"><Icone nome="avancar" /></button>
            </div>
          </div>
          <div class="calendario-e-dia">
            <div>
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
            </div>

            <div class="do-dia">
              <p class="data-escolhida">{{ nomeDoDia(diaEscolhido) }}<template v-if="diaEscolhido === hoje"> · hoje</template></p>
              <ul v-if="metasPorDia.get(diaEscolhido)" class="metas">
                <li v-for="meta in metasPorDia.get(diaEscolhido)" :key="meta.id">
                  <span class="texto-meta">
                    <span class="rotulo-meta">{{ rotuloDaMeta(plano, meta) }}</span>
                    <span v-if="detalhe(meta)" class="detalhe-meta">{{ detalhe(meta) }}</span>
                  </span>
                  <MarcaMeta :estado="meta.state" :rotulo="rotuloDaMeta(plano, meta)" @mudar="emit('marcar', meta, $event)" />
                </li>
              </ul>
              <p v-else class="suave">Sem meta neste dia.</p>
            </div>
          </div>
        </section>

        <section class="quadro" aria-labelledby="t-cronograma">
          <div class="quadro-topo">
            <h2 id="t-cronograma" class="rotulo-secao">Cronograma</h2>
            <span class="pequeno">Do {{ dataLonga(primeiroDia) }} ao {{ dataLonga(r.fim) }}</span>
          </div>
          <button v-if="escondidas" type="button" class="link" @click="mostrarTodas = true">{{ escondidas === 1 ? 'Mostrar a meta anterior' : `Mostrar as ${escondidas} metas anteriores` }}</button>
          <ul class="metas lista">
            <li v-for="meta in metasDaLista" :key="meta.id" :class="situacao(meta, hoje)">
              <span class="quando">{{ nomeDoDia(meta.day) }}</span>
              <span class="texto-meta">
                <span class="rotulo-meta">{{ rotuloDaMeta(plano, meta) }}</span>
                <span v-if="detalhe(meta)" class="detalhe-meta">{{ detalhe(meta) }}</span>
                <span v-if="situacao(meta, hoje) === 'atrasada'" class="etiqueta vermelho">atrasada</span>
                <span v-else-if="meta.day === hoje" class="etiqueta azul">hoje</span>
              </span>
              <MarcaMeta :estado="meta.state" :rotulo="rotuloDaMeta(plano, meta)" @mudar="emit('marcar', meta, $event)" />
            </li>
          </ul>
        </section>

        <section v-if="capitulos.length" class="quadro" aria-labelledby="t-capitulos">
          <details class="capitulos" :open="capitulosDentro < capitulos.length">
            <summary>
              <h2 id="t-capitulos" class="rotulo-secao">Capítulos</h2>
              <span class="pequeno">{{ capitulosDentro }} de {{ capitulos.length }} {{ capitulos.length === 1 ? 'capítulo entra' : 'capítulos entram' }} no plano</span>
            </summary>
            <p class="suave">Notas, índice e afins podem ficar fora: tirar ou pôr um capítulo refaz o cronograma de hoje em diante e guarda o que você já leu.</p>
            <ol class="lista-capitulos" aria-label="Capítulos que entram no plano">
              <li v-for="(c, i) in capitulos" :key="i" :class="{ fora: c.skip }">
                <label>
                  <input
                    type="checkbox"
                    :checked="!c.skip"
                    :disabled="ocupado || semConexao"
                    :aria-label="`${c.title || `Capítulo ${i + 1}`} entra no plano`"
                    @change="alternarCapitulo(i, $event)"
                  />
                  <span class="numero-cap">{{ i + 1 }}</span>
                  <span class="titulo-cap">{{ c.title || `Capítulo ${i + 1}` }}</span>
                  <span v-if="c.skip" class="selo-fora">fora do plano<template v-if="sugestao(c, i)"> · parece {{ sugestao(c, i) }}</template></span>
                </label>
              </li>
            </ol>
            <button v-if="capitulosDentro < capitulos.length" type="button" class="link" :disabled="ocupado || semConexao" @click="incluirTodos">Incluir todos no plano</button>
          </details>
        </section>

        <div class="linha-acoes">
          <button type="button" class="botao discreto perigo" :disabled="ocupado || semConexao" @click="apagar">Apagar o plano</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.voltar {
  padding: 0;
  background: transparent;
  border: 0;
  cursor: pointer;
}

.topo-pagina h1 {
  flex: 1 1 260px;
  min-width: 0;
}

.ler {
  max-width: min(100%, 420px);
}

.ler span {
  overflow: hidden;
  text-overflow: ellipsis;
}

.principal {
  display: grid;
  gap: var(--e4);
}

.resumo-plano {
  display: grid;
  gap: var(--e2);
}

.resumo-plano p {
  margin: 0;
}

.resumo-plano .quadro-topo {
  margin-bottom: var(--e1);
}

.cabeca-plano {
  display: flex;
  gap: var(--e3);
  align-items: flex-start;
}

.cabeca-plano .capa-livro {
  flex: none;
  width: 64px;
}

.info {
  display: grid;
  gap: var(--e2);
  justify-items: start;
  min-width: 0;
}

.autor {
  color: var(--texto-suave);
}

.estado.etiqueta {
  height: auto;
  min-height: 20px;
  padding-block: 1px;
  white-space: normal;
}

.numeros {
  color: var(--texto-suave);
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}

.ritmo {
  padding-top: var(--e2);
  font-size: 13px;
  border-top: 1px solid var(--borda);
}

.atraso {
  display: flex;
  flex-wrap: wrap;
  gap: var(--e3);
  align-items: center;
  justify-content: space-between;
  padding: var(--e3) var(--e4);
  color: var(--vermelho);
  background: var(--vermelho-fundo);
  border-radius: var(--raio);
}

.atraso p {
  flex: 1 1 260px;
  margin: 0;
  font-size: 13.5px;
}

.atraso strong {
  font-weight: 600;
}

.principal > .aviso {
  margin: 0;
}

.mes {
  display: flex;
  align-items: center;
  gap: var(--e1);
}

.nome-mes {
  min-width: 128px;
  font-size: 13.5px;
  font-weight: 500;
  text-align: center;
}

.nome-mes::first-letter {
  text-transform: uppercase;
}

/* O calendário e o dia escolhido lado a lado quando cabem. */
.calendario-e-dia {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: var(--e4);
  align-items: start;
}

.calendario {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 40px));
  gap: var(--e1);
}

.semana {
  color: var(--texto-fraco);
  font-size: 11px;
  font-weight: 600;
  text-align: center;
}

/* Cada dia com meta ganha a cor da situação: verde lida, contorno a fazer, vermelho atrasada. */
.dia {
  aspect-ratio: 1;
  padding: 0;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  color: var(--texto-fraco);
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--raio-p);
  cursor: pointer;
}

.dia.futura {
  color: var(--texto);
  border-color: var(--borda-forte);
}

.dia.lida {
  color: var(--verde);
  font-weight: 600;
  background: var(--verde-fundo);
}

.dia.atrasada {
  color: var(--vermelho);
  font-weight: 600;
  border-color: var(--vermelho);
}

.dia.nao-lida {
  color: var(--vermelho);
  background: var(--vermelho-fundo);
}

.dia.hoje {
  color: var(--azul);
  font-weight: 600;
}

.dia.escolhido {
  background: var(--ativo);
  border-color: var(--texto-suave);
}

.legenda {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--e1) 6px;
  margin: var(--e3) 0 0;
  color: var(--texto-fraco);
  font-size: 12px;
}

.amostra {
  display: inline-block;
  width: 12px;
  height: 12px;
  margin-left: 6px;
  border: 1px solid transparent;
  border-radius: 3px;
}

.amostra:first-child {
  margin-left: 0;
}

.amostra.lida {
  background: var(--verde-fundo);
  border-color: var(--verde);
}

.amostra.futura {
  border-color: var(--borda-forte);
}

.amostra.atrasada {
  border-color: var(--vermelho);
}

.amostra.nao-lida {
  background: var(--vermelho-fundo);
}

.do-dia {
  padding: var(--e3);
  background: var(--superficie);
  border: 1px solid var(--borda);
  border-radius: var(--raio);
}

.data-escolhida {
  margin: 0 0 var(--e1);
  color: var(--texto-suave);
  font-size: 13px;
  font-weight: 600;
}

.metas {
  margin: 0;
  padding: 0;
  list-style: none;
}

.metas li {
  display: flex;
  gap: var(--e3);
  align-items: center;
  padding: var(--e2) 0;
}

.lista li.lida .rotulo-meta {
  color: var(--texto-suave);
}

.quando {
  flex: none;
  width: 104px;
  color: var(--texto-suave);
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}

.texto-meta {
  display: flex;
  flex: 1;
  flex-wrap: wrap;
  gap: 2px var(--e2);
  align-items: baseline;
  min-width: 0;
}

.rotulo-meta {
  font-size: 14.5px;
  font-weight: 500;
  overflow-wrap: anywhere;
}

.detalhe-meta {
  color: var(--texto-fraco);
  font-size: 12.5px;
}

.suave {
  margin: 0 0 var(--e3);
  font-size: 13px;
}

.do-dia .suave {
  margin: 0;
}

.link {
  margin-bottom: var(--e2);
  padding: 0;
  font-size: 13px;
  font-weight: 500;
  color: var(--link);
  background: transparent;
  border: 0;
  cursor: pointer;
}

.link:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.capitulos summary {
  display: flex;
  flex-wrap: wrap;
  gap: var(--e1) var(--e3);
  align-items: baseline;
  min-height: var(--controle);
  cursor: pointer;
}

.capitulos summary .rotulo-secao {
  display: inline;
}

.capitulos > p {
  margin: var(--e2) 0;
}

.lista-capitulos {
  display: grid;
  margin: 0 0 var(--e2);
  padding: 0;
  list-style: none;
  border-top: 1px solid var(--borda);
}

.lista-capitulos label {
  display: flex;
  gap: var(--e3);
  align-items: center;
  min-height: 40px;
  padding: var(--e1) 0;
  border-bottom: 1px solid var(--borda);
  cursor: pointer;
}

.lista-capitulos input {
  flex: none;
  width: 18px;
  height: 18px;
  margin: 0;
  accent-color: var(--texto);
  cursor: pointer;
}

.numero-cap {
  flex: none;
  width: 24px;
  color: var(--texto-fraco);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.titulo-cap {
  flex: 1;
  min-width: 0;
  font-size: 14px;
  overflow-wrap: anywhere;
}

.fora .titulo-cap,
.fora .numero-cap {
  opacity: 0.5;
}

.selo-fora {
  flex: none;
  max-width: 45%;
  color: var(--texto-suave);
  font-size: 12px;
  text-align: right;
}

@media (max-width: 699px) {
  .calendario {
    grid-template-columns: repeat(7, minmax(0, 1fr));
  }

  .lista li {
    flex-wrap: wrap;
  }

  .quando {
    flex-basis: 100%;
    width: auto;
  }
}
</style>
