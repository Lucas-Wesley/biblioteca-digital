<script setup>
import { computed, ref, watch } from 'vue'
import CameraDeFotos from './CameraDeFotos.vue'
import Icone from './Icone.vue'
import LeitorDeCodigo from './LeitorDeCodigo.vue'
import {
  SEMANA, NOMES_DA_SEMANA, ajustarPlano, buscarNoCatalogo, capitulosDoLivro, capitulosParaPlano, criarPlano, dataComDia,
  juntarSumario, lerSumarioEmLotes, origemDoRitmo, paginasPorDia, porDiaParaTerminar, previsao, ritmoDeLeitura, tempoDeLeitura,
} from './planos.js'

// Criar ou ajustar um plano de leitura (R35). O livro vem da biblioteca (capítulos e páginas saem
// do próprio arquivo) ou é físico (dados pela busca nas fontes abertas, ou à mão).
const props = defineProps({
  livros: { type: Array, required: true },
  plano: { type: Object, default: null },
  hoje: { type: String, required: true },
  registros: { type: Array, default: () => [] },
})
const emit = defineEmits(['salvo', 'cancelar'])

const p = props.plano
const origem = ref(p ? (p.book_id ? 'biblioteca' : 'fisico') : 'biblioteca')
const livroId = ref(p?.book_id ?? '')
const dados = ref({ title: p?.title ?? '', author: p?.author ?? '', publisher: p?.publisher ?? '', isbn: p?.isbn ?? '' })
const capa = ref({ url: '', previa: '' })
const sumario = ref(p?.chapters ?? [])
const capitulos = ref(p?.unit === 'capitulos' ? p.total : p?.chapters?.length || null)
const paginas = ref(p?.unit === 'paginas' ? p.total : null)
const unidade = ref(p?.unit ?? 'capitulos')
const comeco = ref(p?.first ?? 1)
const porDia = ref(p?.per_day ?? 1)
const semana = ref(p?.weekdays ?? '0123456')
const inicio = ref(p?.start_day ?? props.hoje)
const prazo = ref('')
const estimadas = ref(false)

const busca = ref('')
const resultados = ref(null)
const buscando = ref(false)
const erroBusca = ref('')
const camera = ref(false)
const lendoLivro = ref(false)
const avisoLivro = ref('')
const salvando = ref(false)
const erro = ref('')
// Sumário do livro físico pela foto (R36).
const fotografando = ref(false)
const lendoSumario = ref(false)
const erroSumario = ref('')
const notaSumario = ref('')
const progressoSumario = ref('')

const livrosOrdenados = computed(() => [...props.livros].sort((a, b) => a.title.localeCompare(b.title, 'pt-BR')))
const total = computed(() => Number(unidade.value === 'capitulos' ? capitulos.value : paginas.value) || 0)
const capitulosValidos = computed(() => sumario.value.filter((c) => c.title?.trim()))
const nomes = computed(() => (unidade.value === 'capitulos' ? capitulosValidos.value : []))
const config = computed(() => ({
  total: total.value,
  first: Number(comeco.value) || 1,
  per_day: Number(porDia.value) || 0,
  weekdays: semana.value,
  start_day: inicio.value,
}))
const resultadoPrevisto = computed(() => previsao(config.value))
// Quanto tempo por dia a meta pede (R37): as páginas de um dia vezes o ritmo de leitura.
const ritmo = computed(() => ritmoDeLeitura(props.registros, livroId.value))
const paginasDoDia = computed(() =>
  paginasPorDia({ ...config.value, unit: unidade.value, chapters: unidade.value === 'capitulos' ? sumario.value : [] }),
)
const tempoPorDia = computed(() => tempoDeLeitura(paginasDoDia.value, ritmo.value))
const unidadeNoPlural = computed(() => (unidade.value === 'capitulos' ? 'capítulos' : 'páginas'))
const mudouAUnidade = computed(() => p && p.unit !== unidade.value && p.goals.some((m) => m.state === 'lida'))

// Livro da biblioteca: o título, o autor, os capítulos e as páginas saem do arquivo.
async function carregarLivro(id, primeiraVez = false) {
  avisoLivro.value = ''
  const livro = props.livros.find((l) => l.id === id)
  if (!livro) return
  if (!primeiraVez) {
    dados.value = { title: livro.title, author: livro.author ?? '', publisher: '', isbn: '' }
  }
  lendoLivro.value = true
  try {
    const b = await capitulosDoLivro(id)
    if (!b.indexed) {
      avisoLivro.value = `Não deu para ler os capítulos: ${b.error}. Informe as quantidades à mão.`
      return
    }
    const lista = capitulosParaPlano(b.chapters)
    if (!primeiraVez || p?.unit !== 'capitulos') {
      sumario.value = lista
      capitulos.value = lista.length || null
    }
    if (!primeiraVez || p?.unit !== 'paginas') paginas.value = b.pages || null
    estimadas.value = livro.format !== 'pdf'
  } catch (e) {
    avisoLivro.value = `Não deu para ler os capítulos (${e.message}). Informe as quantidades à mão.`
  } finally {
    lendoLivro.value = false
  }
}

// Ao abrir um plano para ajustar, os capítulos do livro são relidos sem apagar o que foi escolhido.
let primeiraCarga = false
watch(livroId, (id) => {
  if (!primeiraCarga) {
    comeco.value = 1
    carregarLivro(id)
  }
})
if (p?.book_id) {
  primeiraCarga = true
  carregarLivro(p.book_id, true).finally(() => (primeiraCarga = false))
}

watch(origem, (o) => {
  if (o === 'fisico') {
    livroId.value = ''
    sumario.value = []
    estimadas.value = false
  }
})

// No livro físico, a lista do sumário manda na quantidade de capítulos.
watch(capitulosValidos, (lista) => {
  if (origem.value === 'fisico' && lista.length) capitulos.value = lista.length
})

// Cada leitura soma à lista que já existe (o sumário pode vir em partes, em dias diferentes); para
// recomeçar, "Limpar a lista". Mais de 8 fotos vão em lotes (R37).
async function lerFotos(fotos) {
  fotografando.value = false
  if (!fotos.length) return
  lendoSumario.value = true
  erroSumario.value = ''
  notaSumario.value = ''
  const antes = capitulosValidos.value.length
  const notas = []
  let achados = 0
  try {
    await lerSumarioEmLotes(fotos, {
      aoAvancar: ({ de, ate, total }) => {
        progressoSumario.value = total > ate || de > 1 ? ` Fotos ${de} a ${ate} de ${total}.` : ''
      },
      aoLote: (chapters, note) => {
        if (note) notas.push(note)
        achados += chapters.length
        if (!chapters.length) return
        const tinha = sumario.value.length
        sumario.value = juntarSumario(sumario.value.filter((c) => c.title?.trim()), chapters)
        if (!tinha) comeco.value = 1
      },
    })
    const novos = capitulosValidos.value.length - antes
    notaSumario.value = [antes && novos ? `${novos} ${novos === 1 ? 'capítulo somado' : 'capítulos somados'} à lista.` : '', ...notas].filter(Boolean).join(' ')
    if (!novos) erroSumario.value = achados ? 'Nenhum capítulo novo nas fotos: todos já estão na lista.' : notas.join(' ') || 'Nenhum capítulo encontrado nas fotos.'
  } catch (e) {
    erroSumario.value = capitulosValidos.value.length > antes ? `${e.message} Os capítulos dos lotes anteriores ficaram na lista.` : e.message
  } finally {
    lendoSumario.value = false
    progressoSumario.value = ''
  }
}

function limparSumario() {
  sumario.value = []
  notaSumario.value = ''
  erroSumario.value = ''
}

function aoEscolherDaGaleria(evento) {
  const fotos = [...evento.target.files]
  evento.target.value = ''
  lerFotos(fotos)
}

function adicionarCapitulo() {
  sumario.value = [...sumario.value, { title: '', first_page: null }]
}

function tirarCapitulo(i) {
  sumario.value = sumario.value.filter((_, j) => j !== i)
}

// A página final de cada capítulo é a anterior ao começo do próximo (o livro físico não diz).
function comPaginasFinais(lista) {
  return lista.map((c, i) => {
    const inicio = Number(c.first_page) || 0
    const proximo = Number(lista[i + 1]?.first_page) || 0
    const fim = c.anchor ? c.last_page : proximo > inicio && inicio ? proximo - 1 : 0
    return { title: c.title.trim(), first_page: inicio || undefined, last_page: fim || undefined, anchor: c.anchor || undefined }
  })
}

watch(unidade, () => {
  if (p?.unit === unidade.value) {
    comeco.value = p.first
    porDia.value = p.per_day
  } else {
    comeco.value = 1
    porDia.value = unidade.value === 'paginas' ? 20 : 1
  }
})

async function buscar(texto = busca.value) {
  if (!texto.trim()) return
  buscando.value = true
  erroBusca.value = ''
  resultados.value = null
  try {
    resultados.value = await buscarNoCatalogo(texto.trim())
  } catch (e) {
    erroBusca.value = e.message
  } finally {
    buscando.value = false
  }
}

function aoLerCodigo(isbn) {
  camera.value = false
  busca.value = isbn
  buscar(isbn)
}

function escolher(r) {
  dados.value = { title: r.title, author: r.author, publisher: r.publisher, isbn: r.isbn }
  capa.value = { url: r.cover_url, previa: r.cover_url }
  if (r.pages) paginas.value = r.pages
  resultados.value = null
}

function alternarDia(i) {
  const d = String(i)
  const dias = semana.value.includes(d) ? semana.value.replace(d, '') : semana.value + d
  if (dias) semana.value = [...dias].sort().join('')
}

function aplicarPrazo() {
  if (!prazo.value || prazo.value < inicio.value) return
  const ritmo = porDiaParaTerminar(config.value, prazo.value)
  if (ritmo) porDia.value = ritmo
}

async function salvar() {
  erro.value = ''
  if (mudouAUnidade.value && !confirm('Trocar a unidade recomeça o cronograma: as metas já marcadas como lidas saem. Continuar?')) return
  salvando.value = true
  const corpo = {
    ...dados.value,
    book_id: origem.value === 'biblioteca' ? livroId.value : '',
    cover_url: capa.value.url,
    unit: unidade.value,
    ...config.value,
    chapters: unidade.value === 'paginas' || capitulosValidos.value.length === total.value ? comPaginasFinais(capitulosValidos.value) : [],
    today: props.hoje,
  }
  try {
    const salvo = p ? await ajustarPlano(p.id, corpo) : await criarPlano(corpo)
    emit('salvo', salvo)
  } catch (e) {
    erro.value = e.message
  } finally {
    salvando.value = false
  }
}
</script>

<template>
  <form class="formulario" @submit.prevent="salvar">
    <h1>{{ plano ? 'Ajustar plano' : 'Novo plano de leitura' }}</h1>

    <section class="bloco" aria-labelledby="t-livro">
      <h2 id="t-livro" class="titulo-bloco">O livro</h2>
      <div class="filtros" role="group" aria-label="Onde está o livro">
        <button type="button" :aria-pressed="origem === 'biblioteca'" @click="origem = 'biblioteca'">Na biblioteca</button>
        <button type="button" :aria-pressed="origem === 'fisico'" @click="origem = 'fisico'">Físico ou de fora</button>
      </div>

      <label v-if="origem === 'biblioteca'" class="campo">
        <span>Livro</span>
        <select v-model="livroId" required aria-label="Livro da biblioteca">
          <option value="" disabled>Escolha um livro</option>
          <option v-for="l in livrosOrdenados" :key="l.id" :value="l.id">{{ l.title }}{{ l.author ? ` · ${l.author}` : '' }}</option>
        </select>
      </label>
      <p v-if="lendoLivro" class="suave">Lendo os capítulos do livro…</p>
      <p v-if="avisoLivro" class="aviso-campo">{{ avisoLivro }}</p>

      <template v-if="origem === 'fisico'">
        <div class="busca">
          <input
            v-model="busca"
            type="search"
            placeholder="Título, autor ou ISBN"
            aria-label="Buscar o livro pelo título, autor ou ISBN"
            @keydown.enter.prevent="buscar()"
          />
          <button type="button" class="secundario" :disabled="buscando" @click="buscar()">{{ buscando ? 'Buscando…' : 'Buscar' }}</button>
          <button type="button" class="secundario" @click="camera = !camera">{{ camera ? 'Fechar câmera' : 'Ler código' }}</button>
        </div>
        <LeitorDeCodigo v-if="camera" @lido="aoLerCodigo" @fechar="camera = false" />
        <p v-if="erroBusca" class="aviso-campo" role="alert">{{ erroBusca }}</p>
        <p v-if="resultados && !resultados.length" class="suave">Nada encontrado nas fontes. Preencha os dados abaixo à mão.</p>
        <ul v-if="resultados?.length" class="resultados" aria-label="Resultados da busca">
          <li v-for="(r, i) in resultados" :key="`${r.isbn}-${i}`">
            <button type="button" @click="escolher(r)">
              <span class="mini-capa"><img v-if="r.cover_url" :src="r.cover_url" alt="" loading="lazy" referrerpolicy="no-referrer" /></span>
              <span class="dados-resultado">
                <span class="nome">{{ r.title }}</span>
                <span class="suave">{{ [r.author, r.publisher, r.year].filter(Boolean).join(' · ') }}</span>
                <span class="suave">{{ [r.pages ? `${r.pages} páginas` : '', r.isbn ? `ISBN ${r.isbn}` : '', r.source].filter(Boolean).join(' · ') }}</span>
              </span>
            </button>
          </li>
        </ul>

        <div class="escolhido">
          <span v-if="capa.previa" class="mini-capa grande"><img :src="capa.previa" alt="" referrerpolicy="no-referrer" /></span>
          <div class="campos">
            <label class="campo"><span>Título</span><input v-model="dados.title" type="text" required maxlength="300" /></label>
            <label class="campo"><span>Autor</span><input v-model="dados.author" type="text" maxlength="300" /></label>
            <div class="lado-a-lado">
              <label class="campo"><span>Editora</span><input v-model="dados.publisher" type="text" maxlength="300" /></label>
              <label class="campo"><span>ISBN</span><input v-model="dados.isbn" type="text" inputmode="numeric" maxlength="20" /></label>
            </div>
          </div>
        </div>

        <div class="sumario-fisico">
          <h3 class="subtitulo">Sumário</h3>
          <p class="suave">Fotografe o sumário do livro e o Claude separa os capítulos com as páginas. Pode mandar em partes: cada leitura soma à lista. Confira antes de salvar.</p>
          <CameraDeFotos v-if="fotografando" @pronto="lerFotos" @fechar="fotografando = false" />
          <div v-else class="botoes-foto">
            <button type="button" class="secundario com-icone" :disabled="lendoSumario" @click="fotografando = true"><Icone nome="camera" />Fotografar o sumário</button>
            <label class="secundario com-icone" :class="{ desligado: lendoSumario }">
              <Icone nome="imagem" />Da galeria
              <input type="file" accept="image/*" multiple :disabled="lendoSumario" aria-label="Fotos do sumário da galeria" @change="aoEscolherDaGaleria" />
            </label>
          </div>
          <p v-if="lendoSumario" class="lendo" role="status">O Claude está lendo o sumário… leva uns 10 a 30 segundos.{{ progressoSumario }}</p>
          <p v-if="erroSumario" class="aviso-campo" role="alert">{{ erroSumario }}</p>
          <p v-else-if="notaSumario" class="suave">{{ notaSumario }}</p>

          <ol v-if="sumario.length" class="lista-capitulos" aria-label="Capítulos do sumário">
            <li v-for="(c, i) in sumario" :key="i">
              <span class="numero-cap">{{ i + 1 }}</span>
              <input v-model="c.title" type="text" maxlength="300" :aria-label="`Título do capítulo ${i + 1}`" placeholder="Título" />
              <input v-model.number="c.first_page" type="number" min="1" inputmode="numeric" class="pagina" :aria-label="`Página do capítulo ${i + 1}`" placeholder="pág." />
              <button type="button" class="tirar" :aria-label="`Tirar o capítulo ${i + 1}`" @click="tirarCapitulo(i)">×</button>
            </li>
          </ol>
          <div class="acoes-lista">
            <button type="button" class="link" @click="adicionarCapitulo">+ Adicionar capítulo à mão</button>
            <button v-if="sumario.length" type="button" class="link" :disabled="lendoSumario" @click="limparSumario">Limpar a lista</button>
          </div>
        </div>
      </template>
    </section>

    <section class="bloco" aria-labelledby="t-meta">
      <h2 id="t-meta" class="titulo-bloco">A meta</h2>
      <div class="filtros" role="group" aria-label="Medir a meta por">
        <button type="button" :aria-pressed="unidade === 'capitulos'" @click="unidade = 'capitulos'">Por capítulos</button>
        <button type="button" :aria-pressed="unidade === 'paginas'" @click="unidade = 'paginas'">Por páginas</button>
      </div>

      <div class="lado-a-lado">
        <label v-if="unidade === 'capitulos'" class="campo">
          <span>Capítulos no livro</span>
          <input v-model.number="capitulos" type="number" min="1" max="100000" required :readonly="nomes.length > 0" />
        </label>
        <label v-else class="campo">
          <span>Páginas no livro</span>
          <input v-model.number="paginas" type="number" min="1" max="100000" required />
        </label>
        <label v-if="nomes.length" class="campo">
          <span>Começar do capítulo</span>
          <select v-model.number="comeco">
            <option v-for="(c, i) in nomes" :key="i" :value="i + 1">{{ i + 1 }}. {{ c.title }}</option>
          </select>
        </label>
        <label v-else class="campo">
          <span>Começar {{ unidade === 'capitulos' ? 'do capítulo' : 'da página' }}</span>
          <input v-model.number="comeco" type="number" min="1" :max="total || undefined" required />
        </label>
      </div>
      <p v-if="nomes.length && origem === 'biblioteca'" class="suave">
        {{ nomes.length }} capítulos no sumário do arquivo, de "{{ nomes[0].title }}" a "{{ nomes.at(-1).title }}".
        Se não bater com o livro, meça por páginas.
      </p>
      <p v-if="unidade === 'paginas' && estimadas" class="suave">EPUB não tem página fixa: são as páginas do app (as mesmas das Estatísticas), de 1.500 caracteres cada.</p>

      <div class="lado-a-lado">
        <label class="campo">
          <span>{{ unidadeNoPlural === 'capítulos' ? 'Capítulos' : 'Páginas' }} por dia</span>
          <input v-model.number="porDia" type="number" min="1" :max="total || undefined" required />
        </label>
        <label class="campo">
          <span>Começa em</span>
          <input v-model="inicio" type="date" required />
        </label>
      </div>

      <fieldset class="campo semana">
        <legend>Dias de leitura</legend>
        <div class="dias">
          <button
            v-for="(letra, i) in SEMANA"
            :key="i"
            type="button"
            :aria-pressed="semana.includes(String(i))"
            :aria-label="NOMES_DA_SEMANA[i]"
            @click="alternarDia(i)"
          >{{ letra }}</button>
        </div>
      </fieldset>

      <label class="campo prazo">
        <span>Ou: quero terminar até</span>
        <input v-model="prazo" type="date" :min="inicio" @change="aplicarPrazo" />
      </label>

      <p v-if="resultadoPrevisto" class="previsao" aria-live="polite">
        <strong>{{ resultadoPrevisto.dias }} {{ resultadoPrevisto.dias === 1 ? 'dia' : 'dias' }} de leitura</strong>
        · termina {{ dataComDia(resultadoPrevisto.fim) }}
      </p>
      <p v-if="resultadoPrevisto && tempoPorDia" class="suave tempo-previsto">
        <strong>{{ tempoPorDia }} por dia</strong><template v-if="unidade === 'capitulos'"> (umas {{ Math.round(paginasDoDia) }} páginas)</template>,
        {{ origemDoRitmo(ritmo) }}.
      </p>
      <p v-else-if="resultadoPrevisto && unidade === 'capitulos'" class="suave tempo-previsto">
        Com as páginas dos capítulos no sumário, dá para estimar o tempo de leitura por dia.
      </p>
      <p v-if="mudouAUnidade" class="aviso-campo">Trocar a unidade recomeça o cronograma e tira as marcações de lido.</p>
    </section>

    <p v-if="erro" class="aviso-campo" role="alert">{{ erro }}</p>
    <div class="acoes">
      <button type="submit" class="salvar" :disabled="salvando || lendoLivro">{{ salvando ? 'Salvando…' : plano ? 'Salvar e refazer o cronograma' : 'Criar o cronograma' }}</button>
      <button type="button" class="secundario" @click="emit('cancelar')">Cancelar</button>
    </div>
  </form>
</template>

<style scoped>
.formulario {
  display: grid;
  gap: 1.75rem;
  max-width: 38rem;
}

h1 {
  margin: 0;
  font-size: 1.75rem;
  font-weight: 700;
  letter-spacing: -0.022em;
}

.bloco {
  display: grid;
  gap: 0.875rem;
}

.titulo-bloco {
  margin: 0;
  font-size: 1.125rem;
  font-weight: 650;
}

.filtros {
  display: flex;
  gap: 0.25rem;
}

.filtros button {
  min-height: 34px;
  padding: 0 0.875rem;
  font: inherit;
  font-size: 0.875rem;
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

.campo {
  display: grid;
  gap: 0.3rem;
  min-width: 0;
  margin: 0;
  padding: 0;
  font-size: 0.875rem;
  font-weight: 500;
  border: 0;
}

.campo legend {
  margin-bottom: 0.3rem;
  padding: 0;
}

input,
select {
  width: 100%;
  min-height: 42px;
  padding: 0 0.625rem;
  color: var(--texto);
  font: inherit;
  font-weight: 400;
  background: var(--fundo);
  border: 1px solid var(--superficie-forte);
  border-radius: var(--raio-p);
}

input[readonly] {
  color: var(--texto-suave);
  background: var(--superficie);
}

.lado-a-lado {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
}

.busca {
  display: flex;
  gap: 0.5rem;
}

.busca input {
  flex: 1;
  min-width: 0;
}

.secundario {
  flex: none;
  min-height: 42px;
  padding: 0 0.875rem;
  font: inherit;
  font-size: 0.875rem;
  color: var(--texto);
  background: transparent;
  border: 1px solid var(--superficie-forte);
  border-radius: var(--raio-p);
  cursor: pointer;
}

.secundario:hover:not(:disabled) {
  background: var(--superficie);
}

.resultados {
  display: grid;
  margin: 0;
  padding: 0;
  list-style: none;
  border-top: 1px solid var(--linha);
}

.resultados button {
  display: flex;
  gap: 0.75rem;
  width: 100%;
  padding: 0.625rem 0.25rem;
  text-align: left;
  background: transparent;
  border: 0;
  border-bottom: 1px solid var(--linha);
  cursor: pointer;
}

.resultados button:hover {
  background: var(--superficie);
}

.mini-capa {
  flex: none;
  width: 2.75rem;
  aspect-ratio: 2 / 3;
  overflow: hidden;
  background: var(--superficie);
  border-radius: 3px;
  box-shadow: 0 0 0 1px var(--linha);
}

.mini-capa.grande {
  width: 5rem;
}

.mini-capa img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.dados-resultado {
  display: grid;
  gap: 0.125rem;
  min-width: 0;
}

.nome {
  font-weight: 500;
}

.suave {
  margin: 0;
  color: var(--texto-suave);
  font-size: 0.8125rem;
}

.aviso-campo {
  margin: 0;
  color: var(--perigo);
  font-size: 0.875rem;
}

.escolhido {
  display: flex;
  gap: 1rem;
  align-items: flex-start;
}

.campos {
  display: grid;
  flex: 1;
  gap: 0.75rem;
  min-width: 0;
}

.acoes-lista {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem 1rem;
  justify-content: space-between;
}

.tempo-previsto {
  margin-top: -0.25rem;
}

.sumario-fisico {
  display: grid;
  gap: 0.625rem;
  padding-top: 0.5rem;
}

.subtitulo {
  margin: 0;
  font-size: 0.9375rem;
  font-weight: 650;
}

.botoes-foto {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.com-icone {
  position: relative;
  display: inline-flex;
  gap: 0.375rem;
  align-items: center;
}

.com-icone :deep(svg) {
  width: 18px;
  height: 18px;
}

.com-icone input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
}

.com-icone:has(input:focus-visible) {
  outline: 2px solid var(--marca);
  outline-offset: 2px;
}

.desligado {
  opacity: 0.5;
  pointer-events: none;
}

.lendo {
  margin: 0;
  padding: 0.625rem 0.875rem;
  font-size: 0.875rem;
  background: var(--marca-fundo);
  border-radius: var(--raio);
}

.lista-capitulos {
  display: grid;
  gap: 0.375rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.lista-capitulos li {
  display: flex;
  gap: 0.375rem;
  align-items: center;
}

.numero-cap {
  flex: none;
  width: 1.5rem;
  color: var(--texto-fraco);
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.lista-capitulos input {
  min-height: 38px;
}

.lista-capitulos input:not(.pagina) {
  flex: 1;
  min-width: 0;
}

.lista-capitulos .pagina {
  flex: none;
  width: 4.75rem;
}

.tirar {
  flex: none;
  width: 34px;
  height: 34px;
  padding: 0;
  font: inherit;
  font-size: 1.1rem;
  color: var(--texto-suave);
  background: transparent;
  border: 0;
  border-radius: 50%;
  cursor: pointer;
}

.tirar:hover {
  background: var(--superficie);
}

.link {
  justify-self: start;
  padding: 0;
  font: inherit;
  font-size: 0.875rem;
  color: var(--marca);
  background: transparent;
  border: 0;
  cursor: pointer;
}

.dias {
  display: flex;
  gap: 0.375rem;
}

.dias button {
  width: 40px;
  height: 40px;
  padding: 0;
  font: inherit;
  font-size: 0.875rem;
  color: var(--texto-suave);
  background: transparent;
  border: 1px solid var(--superficie-forte);
  border-radius: 999px;
  cursor: pointer;
}

.dias button[aria-pressed='true'] {
  color: var(--marca-texto);
  font-weight: 600;
  background: var(--marca);
  border-color: var(--marca);
}

.prazo {
  max-width: calc(50% - 0.375rem);
}

.previsao {
  margin: 0;
  padding: 0.75rem 1rem;
  font-size: 0.9375rem;
  background: var(--marca-fundo);
  border-radius: var(--raio);
}

.previsao strong {
  font-weight: 600;
}

.acoes {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.salvar {
  min-height: 42px;
  padding: 0 1.125rem;
  font: inherit;
  font-weight: 600;
  color: var(--destaque-texto);
  background: var(--destaque);
  border: 0;
  border-radius: var(--raio-p);
  cursor: pointer;
}

.salvar:disabled {
  opacity: 0.6;
  cursor: progress;
}

@media (max-width: 47.99rem) {
  .busca {
    flex-wrap: wrap;
  }

  .busca input {
    flex-basis: 100%;
  }

  .prazo {
    max-width: none;
  }
}
</style>
