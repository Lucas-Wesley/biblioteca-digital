<script setup>
import { onMounted, ref } from 'vue'
import Icone from './Icone.vue'
import { apagarSugestao, enviarSugestao, lerSugestoes } from './dados.js'

// Sugestões de melhoria do app. O Lucas anota aqui; o Claude Code lê pela API (/api/sugestoes),
// faz a mudança e deixa uma resposta. A tela e a API são iguais em todas as apps do homelab.
const props = defineProps({ tela: { type: String, default: '' } })

const sugestoes = ref([])
const semConexao = ref(false)
const texto = ref('')

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
  <h1>Ajustes</h1>

  <section class="secao">
    <h2 class="rotulo">Sugestões de melhoria</h2>
    <p class="explicacao">Anote o que pode melhorar na Biblioteca. Depois é só pedir ao Claude para ver as sugestões: ele faz as mudanças e responde aqui.</p>
    <p v-if="semConexao" class="explicacao">Sem conexão com a sua rede: o que você escrever sobe quando voltar.</p>

    <form class="nova" @submit.prevent="enviar">
      <textarea v-model="texto" rows="3" placeholder="O que pode melhorar no app?" aria-label="Sugestão de melhoria" />
      <button class="enviar" :disabled="!texto.trim()">Enviar sugestão</button>
    </form>

    <ul v-if="sugestoes.length" class="lista">
      <li v-for="s in sugestoes" :key="s.id" class="sugestao" :class="s.estado">
        <div>
          <p class="texto">{{ s.texto }}</p>
          <p v-if="s.resposta" class="resposta">{{ s.resposta }}</p>
          <p class="meta">
            <span class="chip">{{ NOMES[s.estado] || s.estado }}</span>
            {{ data(s.criada_em) }}
          </p>
        </div>
        <button type="button" class="apagar" aria-label="Apagar sugestão" title="Apagar" @click="apagar(s)"><Icone nome="fechar" /></button>
      </li>
    </ul>
  </section>
</template>

<style scoped>
h1 {
  margin: 0 0 1.5rem;
  font-size: 1.75rem;
  font-weight: 650;
  letter-spacing: -0.025em;
}

.secao {
  max-width: 42rem;
}

.rotulo {
  margin: 0 0 0.5rem;
  color: var(--texto-fraco);
  font-size: 0.8rem;
  font-weight: 600;
}

.explicacao {
  margin: 0 0 0.875rem;
  color: var(--texto-suave);
  font-size: 0.88rem;
  line-height: 1.5;
}

.nova {
  display: grid;
  justify-items: start;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

textarea {
  width: 100%;
  padding: 0.5rem 0.75rem;
  font: inherit;
  line-height: 1.5;
  color: var(--texto);
  background: var(--fundo);
  border: 1px solid var(--linha);
  border-radius: var(--raio-p);
  resize: vertical;
}

textarea:focus {
  border-color: var(--azul);
  outline: none;
}

.enviar {
  min-height: 32px;
  padding: 0 0.75rem;
  font: inherit;
  font-size: 0.87rem;
  font-weight: 500;
  color: var(--destaque-texto);
  background: var(--destaque);
  border: 0;
  border-radius: var(--raio-p);
  cursor: pointer;
}

.enviar:disabled {
  opacity: 0.45;
  cursor: default;
}

.lista {
  margin: 0;
  padding: 0;
  list-style: none;
  border-top: 1px solid var(--linha);
}

.sugestao {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: start;
  gap: 0.5rem;
  padding: 0.875rem 0;
  border-bottom: 1px solid var(--linha);
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
  margin-top: 0.375rem !important;
  padding-left: 0.625rem;
  color: var(--texto-suave);
  font-size: 0.88rem;
  line-height: 1.45;
  border-left: 2px solid var(--azul);
}

.meta {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.375rem !important;
  color: var(--texto-fraco);
  font-size: 0.78rem;
}

.chip {
  padding: 1px 8px;
  color: var(--texto-suave);
  font-size: 0.75rem;
  font-weight: 500;
  background: var(--superficie-forte);
  border-radius: 999px;
}

.feita .chip {
  color: var(--azul);
  background: var(--azul-fundo);
}

.apagar {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  padding: 0;
  color: var(--texto-suave);
  background: transparent;
  border: 0;
  border-radius: 999px;
  cursor: pointer;
}

.apagar:hover {
  color: var(--texto);
  background: var(--superficie);
}

.apagar :deep(svg) {
  width: 18px;
  height: 18px;
}
</style>
