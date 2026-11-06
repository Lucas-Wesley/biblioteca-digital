<script setup>
import { onMounted, ref } from 'vue'
import Icone from './Icone.vue'

// Guarda a última lista no aparelho, para a página abrir também fora de casa.
const CHAVE_LINKS = 'biblioteca-links'

const links = ref(lerGuardados())
const semConexao = ref(false)
const formularioAberto = ref(false)
const novo = ref({ url: '', name: '', note: '' })
const salvando = ref(false)
const erro = ref('')

function lerGuardados() {
  try {
    return JSON.parse(localStorage.getItem(CHAVE_LINKS)) ?? []
  } catch {
    return []
  }
}

function guardar() {
  try {
    localStorage.setItem(CHAVE_LINKS, JSON.stringify(links.value))
  } catch {
    // Sem espaço no aparelho a página só não abre offline.
  }
}

function dominio(url) {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

async function carregar() {
  try {
    const resposta = await fetch('/api/links', { signal: AbortSignal.timeout(4000) })
    if (!resposta.ok) throw new Error(resposta.status)
    links.value = await resposta.json()
    semConexao.value = false
    guardar()
  } catch {
    semConexao.value = true
  }
}

async function adicionar() {
  salvando.value = true
  erro.value = ''
  try {
    const resposta = await fetch('/api/links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(novo.value),
    })
    const corpo = await resposta.json()
    if (!resposta.ok) throw new Error(corpo.error)
    links.value = [...links.value, corpo].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
    guardar()
    novo.value = { url: '', name: '', note: '' }
    formularioAberto.value = false
  } catch (falha) {
    erro.value = falha instanceof TypeError ? 'Sem conexão com a sua rede.' : falha.message
  } finally {
    salvando.value = false
  }
}

async function remover(link) {
  if (!confirm(`Remover ${link.name} da lista?`)) return
  try {
    const resposta = await fetch(`/api/links/${link.id}`, { method: 'DELETE' })
    if (!resposta.ok && resposta.status !== 404) throw new Error()
    links.value = links.value.filter((item) => item.id !== link.id)
    guardar()
  } catch {
    erro.value = `Não foi possível remover ${link.name}.`
  }
}

onMounted(carregar)
</script>

<template>
  <div class="cabecalho">
    <h1>Buscar livros</h1>
    <button type="button" class="add" :aria-expanded="formularioAberto" @click="formularioAberto = !formularioAberto">ADD</button>
  </div>

  <p v-if="semConexao" class="suave">Sem conexão com a sua rede. Mostrando a última lista vista.</p>

  <form v-if="formularioAberto" class="formulario" @submit.prevent="adicionar">
    <label>
      <span>Endereço</span>
      <input v-model="novo.url" type="url" required placeholder="https://" autocomplete="off" />
    </label>
    <label>
      <span>Nome <span class="suave">(opcional)</span></span>
      <input v-model="novo.name" type="text" maxlength="200" />
    </label>
    <label>
      <span>Observação <span class="suave">(opcional)</span></span>
      <input v-model="novo.note" type="text" maxlength="500" />
    </label>
    <div class="acoes">
      <button type="submit" class="salvar" :disabled="salvando">{{ salvando ? 'Salvando…' : 'Salvar' }}</button>
      <button type="button" class="cancelar" @click="formularioAberto = false">Cancelar</button>
    </div>
  </form>

  <p v-if="erro" class="falha" role="alert">{{ erro }}</p>

  <ul v-if="links.length" class="links">
    <li v-for="link in links" :key="link.id">
      <a :href="link.url" target="_blank" rel="noopener noreferrer">
        <span class="nome">{{ link.name }}</span>
        <span class="suave">{{ dominio(link.url) }}</span>
        <span v-if="link.note" class="nota">{{ link.note }}</span>
      </a>
      <button type="button" class="remover" :aria-label="`Remover ${link.name}`" title="Remover da lista" @click="remover(link)">
        <Icone nome="fechar" />
      </button>
    </li>
  </ul>
  <p v-else-if="!semConexao" class="suave">Nenhum site na lista. Use ADD para incluir um.</p>
</template>

<style scoped>
.cabecalho {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
  max-width: 44rem;
  margin-bottom: 1.5rem;
}

h1 {
  margin: 0;
  font-size: 2rem;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.add {
  min-height: 32px;
  padding: 0 0.75rem;
  color: var(--texto-suave);
  font: inherit;
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  background: transparent;
  border: 1px solid var(--linha);
  border-radius: 8px;
  cursor: pointer;
}

.add:hover,
.add[aria-expanded='true'] {
  color: var(--texto);
  background: var(--superficie);
}

.suave {
  color: var(--texto-suave);
  font-size: 0.8125rem;
}

.formulario {
  display: grid;
  gap: 0.75rem;
  max-width: 34rem;
  margin-bottom: 1.5rem;
  padding: 1rem;
  background: var(--superficie);
  border-radius: 12px;
}

.formulario label {
  display: grid;
  gap: 0.25rem;
  font-size: 0.875rem;
  font-weight: 500;
}

.formulario input {
  min-height: 40px;
  padding: 0 0.625rem;
  color: var(--texto);
  font: inherit;
  font-weight: 400;
  background: var(--fundo);
  border: 1px solid var(--linha);
  border-radius: 8px;
}

.acoes {
  display: flex;
  gap: 0.5rem;
}

.acoes button {
  min-height: 40px;
  padding: 0 1rem;
  font: inherit;
  border-radius: 8px;
  cursor: pointer;
}

.salvar {
  color: var(--destaque-texto);
  background: var(--destaque);
  border: 0;
}

.cancelar {
  color: var(--texto);
  background: transparent;
  border: 1px solid var(--linha);
}

.falha {
  color: var(--perigo);
}

.links {
  display: grid;
  max-width: 44rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.links li {
  display: flex;
  align-items: center;
  border-bottom: 1px solid var(--linha);
}

.links a {
  display: grid;
  flex: 1;
  gap: 0.125rem;
  min-width: 0;
  padding: 0.875rem 0;
  color: inherit;
  text-decoration: none;
}

.links a:hover .nome {
  text-decoration: underline;
}

.nome {
  font-weight: 500;
}

.nota {
  font-size: 0.875rem;
}

.remover {
  display: grid;
  flex: none;
  place-items: center;
  width: 44px;
  height: 44px;
  padding: 0;
  color: var(--texto-suave);
  background: transparent;
  border: 0;
  opacity: 0.5;
  cursor: pointer;
}

.remover:hover,
.remover:focus-visible {
  opacity: 1;
}

.remover :deep(svg) {
  width: 16px;
  height: 16px;
}
</style>
