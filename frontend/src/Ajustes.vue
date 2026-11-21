<script setup>
import { computed, onMounted, ref } from 'vue'
import Icone from './Icone.vue'
import { apagarSugestao, enviarSugestao, lerSugestoes } from './dados.js'
import { TEMAS_DO_APP, preferencias } from './preferencias.js'

// Sugestões de melhoria do app. O Lucas anota aqui; o Claude Code lê pela API (/api/sugestoes),
// faz a mudança e deixa uma resposta. A tela e a API são iguais em todas as apps do homelab.
const props = defineProps({ tela: { type: String, default: '' } })

const sugestoes = ref([])
const semConexao = ref(false)
const texto = ref('')

// Ajustes em níveis (design system): a primeira tela lista as seções; cada uma abre numa página.
const SECOES = [{ id: 'sugestoes', nome: 'Sugestões de melhoria', descricao: 'Anote o que pode melhorar na Biblioteca; o Claude faz e responde aqui.' }]
const secao = ref('')
const atual = computed(() => SECOES.find((s) => s.id === secao.value))

const NOMES = { pendente: 'Aguardando rede', nova: 'Nova', feita: 'Feita', descartada: 'Descartada' }

async function carregar() {
  const resultado = await lerSugestoes()
  sugestoes.value = resultado.lista
  semConexao.value = resultado.semConexao
}

async function enviar() {
  if (!texto.value.trim()) return
  enviarSugestao(texto.value, props.tela)
  texto.value = ''
  await carregar()
}

async function apagar(sugestao) {
  if (!confirm('Apagar esta sugestão?')) return
  apagarSugestao(sugestao.id)
  await carregar()
}

const data = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }) : '')

onMounted(carregar)
</script>

<template>
  <template v-if="!atual">
    <div class="topo-pagina"><h1>Ajustes</h1></div>
    <section class="tema" aria-labelledby="t-tema">
      <h2 id="t-tema" class="rotulo-secao">Tema</h2>
      <div class="abas" role="group" aria-label="Tema do app">
        <button
          v-for="(tema, chave) in TEMAS_DO_APP"
          :key="chave"
          type="button"
          :class="{ ativa: preferencias.tema === chave }"
          :aria-pressed="preferencias.tema === chave"
          @click="preferencias.tema = chave"
        >{{ tema.curto }}</button>
      </div>
      <p class="pequeno">O livro aberto tem o próprio tema (claro, sépia ou escuro), no "Aa" do leitor.</p>
    </section>
    <nav class="lista-de-ajustes" aria-label="Seções dos ajustes">
      <a v-for="s in SECOES" :key="s.id" href="#" @click.prevent="secao = s.id">
        <span>
          <span class="nome">{{ s.nome }}</span>
          <span class="descricao">{{ s.descricao }}</span>
        </span>
        <Icone nome="avancar" class="seta" />
      </a>
    </nav>
  </template>

  <section v-else class="secao">
    <a href="#" class="voltar-ajustes" @click.prevent="secao = ''"><Icone nome="voltar" /> Ajustes</a>
    <div class="topo-pagina"><h1>{{ atual.nome }}</h1></div>
    <p class="explicacao">Anote o que pode melhorar na Biblioteca. Depois é só pedir ao Claude para ver as sugestões: ele faz as mudanças e responde aqui.</p>
    <p v-if="semConexao" class="aviso neutro">Sem conexão com a sua rede: o que você escrever sobe quando voltar.</p>

    <form class="nova" @submit.prevent="enviar">
      <textarea v-model="texto" class="campo" rows="3" placeholder="O que pode melhorar no app?" aria-label="Sugestão de melhoria" />
      <button class="botao primario" :disabled="!texto.trim()">Enviar sugestão</button>
    </form>

    <ul v-if="sugestoes.length" class="lista">
      <li v-for="s in sugestoes" :key="s.id" class="sugestao" :class="s.estado">
        <div>
          <p class="texto">{{ s.texto }}</p>
          <p v-if="s.resposta" class="resposta">{{ s.resposta }}</p>
          <p class="meta">
            <span class="etiqueta" :class="{ verde: s.estado === 'feita', azul: s.estado === 'nova', ambar: s.estado === 'pendente' }">{{ NOMES[s.estado] || s.estado }}</span>
            {{ data(s.criada_em) }}
          </p>
        </div>
        <button type="button" class="botao discreto icone" aria-label="Apagar sugestão" title="Apagar" @click="apagar(s)"><Icone nome="fechar" /></button>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.tema {
  display: grid;
  justify-items: start;
  gap: var(--e2);
  max-width: var(--leitura);
  margin-bottom: var(--e5);
}

.tema .pequeno {
  margin: 0;
}

.secao {
  max-width: var(--leitura);
}

.explicacao {
  margin: calc(-1 * var(--e3)) 0 var(--e4);
  color: var(--texto-suave);
  line-height: 1.55;
}

.secao > .aviso {
  margin: 0 0 var(--e4);
}

.nova {
  display: grid;
  justify-items: start;
  gap: var(--e2);
  margin-bottom: var(--e5);
}

.sugestao {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: start;
  gap: var(--e2);
  padding: var(--e3) 0;
}

.sugestao p {
  margin: 0;
}

.texto {
  line-height: 1.5;
  white-space: pre-wrap;
}

.sugestao.feita .texto,
.sugestao.descartada .texto {
  color: var(--texto-suave);
}

.resposta {
  margin-top: var(--e2) !important;
  padding-left: var(--e3);
  color: var(--texto-suave);
  font-size: 13.5px;
  line-height: 1.5;
  border-left: 2px solid var(--borda-forte);
}

.meta {
  display: flex;
  align-items: center;
  gap: var(--e2);
  margin-top: var(--e2) !important;
  color: var(--texto-fraco);
  font-size: 12.5px;
}
</style>
