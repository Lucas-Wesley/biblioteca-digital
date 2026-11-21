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
  <div class="topo-pagina">
    <h1>Buscar livros</h1>
    <button type="button" class="botao add" :class="{ primario: !formularioAberto }" :aria-expanded="formularioAberto" @click="formularioAberto = !formularioAberto">ADD</button>
  </div>
  <p class="explicacao">Os sites onde você procura livros, num lugar só. Cada um abre numa aba nova.</p>

  <p v-if="semConexao" class="aviso neutro">Sem conexão com a sua rede. Mostrando a última lista vista.</p>

  <form v-if="formularioAberto" class="quadro formulario" @submit.prevent="adicionar">
    <label>
      <span class="rotulo">Endereço</span>
      <input v-model="novo.url" class="campo" type="url" required placeholder="https://" autocomplete="off" />
    </label>
    <div class="campos">
      <label>
        <span class="rotulo">Nome <span class="fraco">(opcional)</span></span>
        <input v-model="novo.name" class="campo" type="text" maxlength="200" />
      </label>
      <label>
        <span class="rotulo">Observação <span class="fraco">(opcional)</span></span>
        <input v-model="novo.note" class="campo" type="text" maxlength="500" />
      </label>
    </div>
    <div class="linha-acoes">
      <button type="submit" class="botao primario" :disabled="salvando">{{ salvando ? 'Salvando…' : 'Salvar' }}</button>
      <button type="button" class="botao discreto" @click="formularioAberto = false">Cancelar</button>
    </div>
  </form>

  <p v-if="erro" class="aviso falha" role="alert">{{ erro }}</p>

  <ul v-if="links.length" class="lista links">
    <li v-for="link in links" :key="link.id">
      <a :href="link.url" target="_blank" rel="noopener noreferrer">
        <span class="nome">{{ link.name }}</span>
        <span class="pequeno">{{ dominio(link.url) }}</span>
        <span v-if="link.note" class="nota">{{ link.note }}</span>
      </a>
      <button type="button" class="botao discreto icone" :aria-label="`Remover ${link.name}`" title="Remover da lista" @click="remover(link)">
        <Icone nome="fechar" />
      </button>
    </li>
  </ul>
  <p v-else-if="!semConexao" class="suave">Nenhum site na lista. Use ADD para incluir um.</p>
</template>

<style scoped>
.explicacao {
  max-width: var(--leitura);
  margin: calc(-1 * var(--e3)) 0 var(--e5);
  color: var(--texto-suave);
  line-height: 1.55;
}

.add {
  font-size: 12px;
  letter-spacing: 0.06em;
}

.aviso {
  max-width: var(--leitura);
  margin: 0 0 var(--e4);
}

.formulario {
  display: grid;
  gap: var(--e3);
  max-width: var(--leitura);
  margin-bottom: var(--e5);
}

.formulario label {
  display: grid;
}

.formulario .rotulo {
  margin-bottom: var(--e1);
}

.links {
  max-width: var(--leitura);
}

.links li {
  display: flex;
  align-items: center;
  gap: var(--e2);
}

.links a {
  display: grid;
  flex: 1;
  gap: 2px;
  min-width: 0;
  padding: var(--e3) 0;
  color: inherit;
  text-decoration: none;
}

.links a:hover .nome {
  color: var(--link);
}

.nome {
  font-size: 14.5px;
  font-weight: 600;
  transition: color var(--transicao);
}

.nota {
  color: var(--texto-suave);
  font-size: 13px;
}
</style>
