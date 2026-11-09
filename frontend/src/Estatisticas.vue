<script setup>
import { computed, onMounted, ref } from 'vue'
import Icone from './Icone.vue'
import { MINIMO_DO_DIA, calcular, duracao, paginas, somarDias } from './estatisticas.js'
import { diaDe, lerRegistros } from './leitura.js'

// Estatísticas de leitura (R31): tempo, páginas, dias de leitura e médias, de todos os aparelhos.
const props = defineProps({ livros: { type: Array, required: true } })

const DIAS_NO_GRAFICO = 30
const SEMANA = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']

const registros = ref([])
const semConexao = ref(false)
const carregou = ref(false)
const hoje = ref(diaDe(new Date()))
const medida = ref('minutos')
const diaEscolhido = ref(hoje.value)
const mes = ref(hoje.value.slice(0, 7))

const dados = computed(() => calcular(registros.value, props.livros, hoje.value))
const temLeitura = computed(() => registros.value.some((r) => r.seconds > 0))

const formatoDia = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' })
const formatoCurto = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', day: 'numeric', month: 'short' })
const formatoMes = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', month: 'long', year: 'numeric' })
const comoData = (dia) => new Date(`${dia}T12:00:00Z`)
const nomeDoDia = (dia) => formatoDia.format(comoData(dia)).replace(/\./g, '')

function valor(dia) {
  const d = dados.value.porDia.get(dia)
  if (!d) return 0
  return medida.value === 'minutos' ? d.segundos / 60 : d.paginas
}

const barras = computed(() => {
  const dias = Array.from({ length: DIAS_NO_GRAFICO }, (_, i) => somarDias(hoje.value, i - DIAS_NO_GRAFICO + 1))
  const valores = dias.map(valor)
  const maior = Math.max(...valores, medida.value === 'minutos' ? 30 : 10)
  // O topo do eixo é um número redondo: 30, 60, 90 minutos; 10, 20, 50 páginas…
  const passo = medida.value === 'minutos' ? 30 : 10
  const topo = Math.ceil(maior / passo) * passo
  return { topo, itens: dias.map((dia, i) => ({ dia, valor: valores[i], altura: (valores[i] / topo) * 100 })) }
})

function textoDoDia(dia) {
  const d = dados.value.porDia.get(dia)
  if (!d || d.segundos < 1) return 'sem leitura'
  return `${duracao(d.segundos)} · ${paginas(d.paginas)}`
}

function rotuloDaBarra(item) {
  return `${nomeDoDia(item.dia)}: ${textoDoDia(item.dia)}`
}

// O calendário do mês, começando no domingo. Cada dia ganha um tom de azul pelos minutos lidos.
const calendario = computed(() => {
  const primeiro = `${mes.value}-01`
  const recuo = comoData(primeiro).getUTCDay()
  const dias = []
  for (let dia = primeiro; dia.startsWith(mes.value); dia = somarDias(dia, 1)) {
    const segundos = dados.value.porDia.get(dia)?.segundos ?? 0
    const nivel = segundos < MINIMO_DO_DIA ? 0 : segundos < 15 * 60 ? 1 : segundos < 30 * 60 ? 2 : segundos < 60 * 60 ? 3 : 4
    dias.push({ dia, numero: Number(dia.slice(8)), nivel, futuro: dia > hoje.value })
  }
  return { recuo, dias, titulo: formatoMes.format(comoData(primeiro)) }
})

const podeAvancar = computed(() => mes.value < hoje.value.slice(0, 7))

function mudarMes(n) {
  const [ano, m] = mes.value.split('-').map(Number)
  const data = new Date(Date.UTC(ano, m - 1 + n, 1, 12))
  mes.value = data.toISOString().slice(0, 7)
}

async function carregar() {
  hoje.value = diaDe(new Date())
  const resultado = await lerRegistros()
  registros.value = resultado.registros
  semConexao.value = resultado.semConexao
  carregou.value = true
}

onMounted(carregar)
</script>

<template>
  <h1>Estatísticas</h1>

  <p v-if="semConexao" class="aviso">Sem conexão com a sua rede: mostrando o que este aparelho tem. As leituras dos outros aparelhos aparecem quando você voltar.</p>

  <p v-if="carregou && !temLeitura" class="vazio">Ainda não há leituras registradas. O tempo e as páginas começam a contar quando você abre um livro.</p>

  <template v-else-if="carregou">
    <section class="numeros" aria-label="Resumo">
      <div class="numero">
        <p class="rotulo">Hoje</p>
        <p class="valor">{{ duracao(dados.hoje.segundos) }}</p>
        <p class="detalhe">{{ paginas(dados.hoje.paginas) }}</p>
      </div>
      <div class="numero">
        <p class="rotulo">Últimos 7 dias</p>
        <p class="valor">{{ duracao(dados.semana.segundos) }}</p>
        <p class="detalhe">{{ paginas(dados.semana.paginas) }}</p>
      </div>
      <div class="numero">
        <p class="rotulo">Dias seguidos</p>
        <p class="valor">{{ dados.sequencia.atual }}</p>
        <p class="detalhe">a maior sequência foi de {{ dados.sequencia.maior }}</p>
      </div>
      <div class="numero">
        <p class="rotulo">Total</p>
        <p class="valor">{{ duracao(dados.total.segundos) }}</p>
        <p class="detalhe">{{ paginas(dados.total.paginas) }} · {{ dados.total.dias === 1 ? '1 dia de leitura' : `${dados.total.dias} dias de leitura` }}</p>
      </div>
    </section>

    <section class="secao" aria-labelledby="titulo-medias">
      <h2 id="titulo-medias" class="rotulo">Médias</h2>
      <ul class="lista medias">
        <li v-if="dados.media.nosDiasLidos">
          <span>Nos dias em que você leu</span>
          <span class="dado">{{ duracao(dados.media.nosDiasLidos.segundos) }} · {{ paginas(dados.media.nosDiasLidos.paginas) }}</span>
        </li>
        <li v-if="dados.media.porDia">
          <span>Por dia, {{ dados.media.porDia.dias === 30 ? 'nos últimos 30 dias' : `desde a primeira leitura (${dados.media.porDia.dias} ${dados.media.porDia.dias === 1 ? 'dia' : 'dias'})` }}</span>
          <span class="dado">{{ duracao(dados.media.porDia.segundos) }} · {{ paginas(dados.media.porDia.paginas) }}</span>
        </li>
      </ul>
    </section>

    <section class="secao" aria-labelledby="titulo-grafico">
      <div class="cabeca">
        <h2 id="titulo-grafico" class="rotulo">{{ medida === 'minutos' ? 'Minutos' : 'Páginas' }} por dia</h2>
        <div class="filtros" role="group" aria-label="Mostrar">
          <button type="button" :aria-pressed="medida === 'minutos'" @click="medida = 'minutos'">Minutos</button>
          <button type="button" :aria-pressed="medida === 'paginas'" @click="medida = 'paginas'">Páginas</button>
        </div>
      </div>
      <p class="escolhido" aria-live="polite"><strong>{{ nomeDoDia(diaEscolhido) }}</strong> · {{ textoDoDia(diaEscolhido) }}</p>
      <div class="grafico">
        <span class="eixo topo">{{ barras.topo }}</span>
        <span class="eixo zero">0</span>
        <div class="barras">
          <button
            v-for="item in barras.itens"
            :key="item.dia"
            type="button"
            class="barra"
            :class="{ escolhida: item.dia === diaEscolhido }"
            :aria-label="rotuloDaBarra(item)"
            :aria-pressed="item.dia === diaEscolhido"
            @click="diaEscolhido = item.dia"
            @pointerenter="diaEscolhido = item.dia"
          >
            <span v-if="item.valor > 0" class="coluna" :style="{ height: `max(${item.altura}%, 4px)` }"></span>
          </button>
        </div>
      </div>
      <div class="datas" aria-hidden="true">
        <span>{{ formatoCurto.format(comoData(barras.itens[0].dia)).replace('.', '') }}</span>
        <span>hoje</span>
      </div>
    </section>

    <section class="secao" aria-labelledby="titulo-calendario">
      <div class="cabeca">
        <h2 id="titulo-calendario" class="rotulo">Dias de leitura</h2>
        <div class="mes">
          <button type="button" class="seta" aria-label="Mês anterior" @click="mudarMes(-1)"><Icone nome="voltar" /></button>
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
          :class="[`nivel-${d.nivel}`, { hoje: d.dia === hoje, escolhido: d.dia === diaEscolhido }]"
          :disabled="d.futuro"
          :aria-label="`${nomeDoDia(d.dia)}: ${textoDoDia(d.dia)}`"
          @click="diaEscolhido = d.dia"
        >{{ d.numero }}</button>
      </div>
      <p class="legenda" aria-hidden="true">
        menos
        <span class="amostra nivel-1"></span><span class="amostra nivel-2"></span><span class="amostra nivel-3"></span><span class="amostra nivel-4"></span>
        mais de 1h
      </p>
    </section>

    <section v-if="dados.livros.length" class="secao" aria-labelledby="titulo-livros">
      <h2 id="titulo-livros" class="rotulo">Por livro</h2>
      <ul class="lista livros">
        <li v-for="l in dados.livros" :key="l.id">
          <p class="titulo">{{ l.titulo }}</p>
          <p class="meta">
            {{ duracao(l.segundos) }} · {{ paginas(l.paginas) }}<template v-if="l.ritmo"> · {{ Math.round(l.ritmo) }} páginas por hora</template>
          </p>
          <p v-if="l.percent >= 1" class="meta">Terminado</p>
          <p v-else-if="l.faltam" class="meta previsao">{{ Math.round(l.percent * 100) }}% lido · faltam ~{{ duracao(l.faltam) }}</p>
        </li>
      </ul>
    </section>

    <p class="nota">O tempo conta enquanto o livro está aberto na tela e para depois de 5 minutos sem virar a página. No EPUB, uma página vale 1.500 caracteres, como num livro impresso.</p>
  </template>
</template>

<style scoped>
.aviso,
.vazio {
  color: var(--texto-suave);
  font-size: 0.9375rem;
}

.aviso {
  margin: -0.75rem 0 1.5rem;
}

.numeros {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 1.5rem;
  max-width: 48rem;
  margin-bottom: 2.25rem;
}

.numero p {
  margin: 0;
}

.valor {
  margin-top: 0.125rem !important;
  font-size: 1.75rem;
  font-weight: 600;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
}

.detalhe {
  color: var(--texto-suave);
  font-size: 0.8125rem;
}

.secao {
  max-width: 48rem;
  margin-bottom: 2.25rem;
}

.rotulo {
  margin: 0 0 0.5rem;
  color: var(--texto-fraco);
  font-size: 0.8rem;
  font-weight: 600;
}

.cabeca {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.5rem;
}

.cabeca .rotulo {
  margin: 0;
}

.lista {
  margin: 0;
  padding: 0;
  list-style: none;
  border-top: 1px solid var(--linha);
}

.lista li {
  padding: 0.75rem 0;
  border-bottom: 1px solid var(--linha);
}

.medias li {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  font-size: 0.9375rem;
}

.dado {
  flex: none;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}

.filtros {
  display: flex;
  gap: 0.25rem;
}

.filtros button {
  min-height: 30px;
  padding: 0 0.75rem;
  font: inherit;
  font-size: 0.8125rem;
  color: var(--texto-suave);
  background: transparent;
  border: 0;
  border-radius: 999px;
  cursor: pointer;
}

.filtros button[aria-pressed='true'] {
  color: var(--texto);
  font-weight: 600;
  background: var(--superficie-forte);
}

.escolhido {
  margin: 0 0 0.75rem;
  color: var(--texto-suave);
  font-size: 0.875rem;
}

.escolhido strong {
  color: var(--texto);
  font-weight: 600;
}

.grafico {
  position: relative;
  padding-left: 2rem;
}

.eixo {
  position: absolute;
  left: 0;
  color: var(--texto-fraco);
  font-size: 0.6875rem;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}

.eixo.topo {
  top: 0;
}

.eixo.zero {
  bottom: 0;
}

.barras {
  display: flex;
  align-items: stretch;
  gap: 2px;
  height: 9rem;
  border-top: 1px solid var(--linha);
  border-bottom: 1px solid var(--linha);
}

.barra {
  display: flex;
  flex: 1;
  align-items: flex-end;
  justify-content: center;
  min-width: 0;
  padding: 0;
  background: transparent;
  border: 0;
  border-radius: 4px 4px 0 0;
  cursor: pointer;
}

.barra.escolhida {
  background: var(--superficie);
}

.coluna {
  display: block;
  width: 100%;
  max-width: 24px;
  background: var(--azul);
  border-radius: 4px 4px 0 0;
}

.datas {
  display: flex;
  justify-content: space-between;
  margin: 0.375rem 0 0 2rem;
  color: var(--texto-fraco);
  font-size: 0.6875rem;
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

.seta:disabled {
  opacity: 0.35;
  cursor: default;
}

.seta :deep(svg) {
  width: 18px;
  height: 18px;
}

.calendario {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 2.75rem));
  gap: 4px;
}

.semana {
  color: var(--texto-fraco);
  font-size: 0.6875rem;
  font-weight: 600;
  text-align: center;
}

.dia {
  aspect-ratio: 1;
  padding: 0;
  font: inherit;
  font-size: 0.8125rem;
  font-variant-numeric: tabular-nums;
  color: var(--texto-suave);
  background: transparent;
  border: 0;
  border-radius: var(--raio-p);
  cursor: pointer;
}

.dia:disabled {
  color: var(--texto-fraco);
  opacity: 0.5;
  cursor: default;
}

.dia.hoje {
  font-weight: 700;
  box-shadow: inset 0 0 0 1.5px var(--texto-suave);
}

.dia.escolhido {
  outline: 2px solid var(--texto);
  outline-offset: 1px;
}

/* Tons de um só azul, do mais claro ao mais forte; o texto fica legível em todos. */
.nivel-1 {
  background: color-mix(in srgb, var(--azul) 28%, transparent);
}

.nivel-2 {
  background: color-mix(in srgb, var(--azul) 40%, transparent);
}

.nivel-3 {
  background: color-mix(in srgb, var(--azul) 70%, transparent);
}

.nivel-4 {
  background: var(--azul);
}

.dia.nivel-1,
.dia.nivel-2 {
  color: var(--texto);
}

.dia.nivel-3,
.dia.nivel-4 {
  color: var(--fundo);
  font-weight: 600;
}

.legenda {
  display: flex;
  align-items: center;
  gap: 4px;
  margin: 0.625rem 0 0;
  color: var(--texto-fraco);
  font-size: 0.6875rem;
}

.amostra {
  width: 12px;
  height: 12px;
  border-radius: 3px;
}

.livros p {
  margin: 0;
}

.titulo {
  font-family: var(--leitura);
  font-size: 1.05rem;
  font-weight: 600;
}

.meta {
  margin-top: 0.125rem !important;
  color: var(--texto-suave);
  font-size: 0.8125rem;
  font-variant-numeric: tabular-nums;
}

.previsao {
  color: var(--azul);
}

.nota {
  max-width: 48rem;
  color: var(--texto-fraco);
  font-size: 0.78rem;
  line-height: 1.5;
}

@media (max-width: 47.99rem) {
  .numeros {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1.25rem 1rem;
  }

  .valor {
    font-size: 1.5rem;
  }

  .calendario {
    grid-template-columns: repeat(7, minmax(0, 1fr));
  }
}
</style>
