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
  <div class="topo-pagina"><h1>Estatísticas</h1></div>

  <p v-if="semConexao" class="aviso neutro">Sem conexão com a sua rede: mostrando o que este aparelho tem. As leituras dos outros aparelhos aparecem quando você voltar.</p>

  <p v-if="carregou && !temLeitura" class="vazio">Ainda não há leituras registradas. O tempo e as páginas começam a contar quando você abre um livro.</p>

  <template v-else-if="carregou">
    <section class="numeros-quadro" aria-label="Resumo">
      <div class="numero-quadro numero">
        <p class="rotulo-secao">Hoje</p>
        <p class="valor-grande">{{ duracao(dados.hoje.segundos) }}</p>
        <p class="pequeno">{{ paginas(dados.hoje.paginas) }}</p>
      </div>
      <div class="numero-quadro numero">
        <p class="rotulo-secao">Últimos 7 dias</p>
        <p class="valor-grande">{{ duracao(dados.semana.segundos) }}</p>
        <p class="pequeno">{{ paginas(dados.semana.paginas) }}</p>
      </div>
      <div class="numero-quadro numero">
        <p class="rotulo-secao">Dias seguidos</p>
        <p class="valor-grande">{{ dados.sequencia.atual }}</p>
        <p class="pequeno">a maior sequência foi de {{ dados.sequencia.maior }}</p>
      </div>
      <div class="numero-quadro numero">
        <p class="rotulo-secao">Total</p>
        <p class="valor-grande">{{ duracao(dados.total.segundos) }}</p>
        <p class="pequeno">{{ paginas(dados.total.paginas) }} · {{ dados.total.dias === 1 ? '1 dia de leitura' : `${dados.total.dias} dias de leitura` }}</p>
      </div>
    </section>

    <div class="duas-colunas">
    <div class="principal">
    <section class="quadro" aria-labelledby="titulo-grafico">
      <div class="quadro-topo">
        <h2 id="titulo-grafico" class="rotulo-secao">{{ medida === 'minutos' ? 'Minutos' : 'Páginas' }} por dia</h2>
        <div class="abas" role="group" aria-label="Mostrar">
          <button type="button" :class="{ ativa: medida === 'minutos' }" :aria-pressed="medida === 'minutos'" @click="medida = 'minutos'">Minutos</button>
          <button type="button" :class="{ ativa: medida === 'paginas' }" :aria-pressed="medida === 'paginas'" @click="medida = 'paginas'">Páginas</button>
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

    <section class="quadro" aria-labelledby="titulo-calendario">
      <div class="quadro-topo">
        <h2 id="titulo-calendario" class="rotulo-secao">Dias de leitura</h2>
        <div class="mes">
          <button type="button" class="botao discreto icone" aria-label="Mês anterior" @click="mudarMes(-1)"><Icone nome="voltar" /></button>
          <span class="nome-mes">{{ calendario.titulo }}</span>
          <button type="button" class="botao discreto icone" aria-label="Próximo mês" :disabled="!podeAvancar" @click="mudarMes(1)"><Icone nome="avancar" /></button>
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

    </div>

    <aside class="lateral">
    <section class="quadro" aria-labelledby="titulo-medias">
      <div class="quadro-topo"><h2 id="titulo-medias" class="rotulo-secao">Médias</h2></div>
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

    <section v-if="dados.livros.length" class="quadro" aria-labelledby="titulo-livros">
      <div class="quadro-topo"><h2 id="titulo-livros" class="rotulo-secao">Por livro</h2></div>
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

    </aside>
    </div>

    <p class="nota">O tempo conta enquanto o livro está aberto na tela e para depois de 5 minutos sem virar a página. No EPUB, uma página vale 1.500 caracteres, como num livro impresso.</p>
  </template>
</template>

<style scoped>
.aviso {
  max-width: var(--leitura);
  margin: 0 0 var(--e4);
}

.vazio {
  text-align: left;
  padding: 0;
  max-width: var(--leitura);
}

.numero-quadro p {
  margin: 0;
}

.principal {
  display: grid;
  gap: var(--e4);
}

.lateral {
  display: grid;
  gap: var(--e4);
}

.lista li {
  padding: var(--e2) 0;
}

.medias li {
  display: flex;
  justify-content: space-between;
  gap: var(--e3);
  font-size: 13.5px;
}

.dado {
  flex: none;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.quadro-topo {
  flex-wrap: wrap;
}

.escolhido {
  margin: 0 0 var(--e3);
  color: var(--texto-suave);
  font-size: 13.5px;
}

.escolhido strong {
  color: var(--texto);
  font-weight: 600;
}

.grafico {
  position: relative;
  padding-left: var(--e6);
}

.eixo {
  position: absolute;
  left: 0;
  color: var(--texto-fraco);
  font-size: 11px;
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
  height: 144px;
  border-top: 1px solid var(--borda);
  border-bottom: 1px solid var(--borda);
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
  border-radius: var(--raio-e) var(--raio-e) 0 0;
  cursor: pointer;
}

.barra.escolhida {
  background: var(--superficie-2);
}

.coluna {
  display: block;
  width: 100%;
  max-width: 24px;
  background: var(--azul);
  border-radius: var(--raio-e) var(--raio-e) 0 0;
}

.datas {
  display: flex;
  justify-content: space-between;
  margin: 6px 0 0 var(--e6);
  color: var(--texto-fraco);
  font-size: 11px;
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

.dia {
  aspect-ratio: 1;
  padding: 0;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  color: var(--texto-suave);
  background: transparent;
  border: 1px solid transparent;
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
  border-color: var(--texto-suave);
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
  gap: var(--e1);
  margin: var(--e3) 0 0;
  color: var(--texto-fraco);
  font-size: 11px;
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
  font-size: 14.5px;
  font-weight: 600;
}

.meta {
  margin-top: 2px !important;
  color: var(--texto-suave);
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}

.previsao {
  color: var(--azul);
}

.nota {
  max-width: var(--leitura);
  margin: var(--e5) 0 0;
  color: var(--texto-fraco);
  font-size: 12.5px;
  line-height: 1.5;
}

@media (max-width: 699px) {
  .calendario {
    grid-template-columns: repeat(7, minmax(0, 1fr));
  }
}
</style>
