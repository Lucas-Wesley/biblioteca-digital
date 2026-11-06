// As contas da tela de Estatísticas, a partir dos registros de leitura (um por aparelho, dia e livro).

// Um dia conta como dia de leitura a partir de 1 minuto: abrir o livro sem querer não conta.
export const MINIMO_DO_DIA = 60
// O ritmo e a previsão só aparecem depois de 10 minutos no livro, para não oscilar demais.
const MINIMO_PARA_RITMO = 600
const PERIODO = 30

// Datas como texto AAAA-MM-DD; a conta é feita ao meio-dia UTC, longe da virada do dia.
export function somarDias(dia, n) {
  const data = new Date(`${dia}T12:00:00Z`)
  data.setUTCDate(data.getUTCDate() + n)
  return data.toISOString().slice(0, 10)
}

export function diasEntre(de, ate) {
  return Math.round((new Date(`${ate}T12:00:00Z`) - new Date(`${de}T12:00:00Z`)) / 86400000)
}

const vazio = () => ({ segundos: 0, paginas: 0 })

function somar(alvo, r) {
  alvo.segundos += r.seconds
  alvo.paginas += r.pages
  return alvo
}

// calcular devolve tudo o que a tela mostra. livros vem da lista da biblioteca (título, percent).
export function calcular(registros, livros, hoje) {
  const porDia = new Map()
  const porLivro = new Map()
  for (const r of registros) {
    porDia.set(r.day, somar(porDia.get(r.day) ?? vazio(), r))
    const livro = porLivro.get(r.book_id) ?? { ...vazio(), ultimoDia: '', totalDePaginas: 0 }
    somar(livro, r)
    if (r.day >= livro.ultimoDia) {
      livro.ultimoDia = r.day
      livro.totalDePaginas = r.book_pages || livro.totalDePaginas
    }
    porLivro.set(r.book_id, livro)
  }

  const diasLidos = [...porDia.keys()].filter((dia) => porDia.get(dia).segundos >= MINIMO_DO_DIA).sort()
  const lidos = new Set(diasLidos)
  const total = [...porDia.values()].reduce((a, d) => ({ segundos: a.segundos + d.segundos, paginas: a.paginas + d.paginas }), vazio())

  function noPeriodo(dias) {
    const soma = vazio()
    for (let i = 0; i < dias; i++) {
      const d = porDia.get(somarDias(hoje, -i))
      if (d) somar(soma, { seconds: d.segundos, pages: d.paginas })
    }
    return soma
  }

  // A sequência de hoje só quebra quando o dia acaba: sem leitura hoje, conta a partir de ontem.
  let atual = 0
  for (let dia = lidos.has(hoje) ? hoje : somarDias(hoje, -1); lidos.has(dia); dia = somarDias(dia, -1)) atual++
  let maior = 0
  let corrida = 0
  diasLidos.forEach((dia, i) => {
    corrida = i > 0 && diasEntre(diasLidos[i - 1], dia) === 1 ? corrida + 1 : 1
    maior = Math.max(maior, corrida)
  })

  // Nos primeiros dias das estatísticas, o período é desde a primeira leitura, não 30 dias.
  const primeiro = [...porDia.keys()].sort()[0]
  const periodo = primeiro ? Math.min(PERIODO, diasEntre(primeiro, hoje) + 1) : 0
  const doPeriodo = noPeriodo(periodo)

  const titulos = new Map(livros.map((l) => [l.id, l]))
  const porLivroLista = [...porLivro.entries()]
    .filter(([, l]) => l.segundos >= MINIMO_DO_DIA)
    .map(([id, l]) => {
      const livro = titulos.get(id)
      const horas = l.segundos / 3600
      const ritmo = l.segundos >= MINIMO_PARA_RITMO && l.paginas > 0 ? l.paginas / horas : null
      const percent = livro?.percent ?? 0
      const faltamPaginas = l.totalDePaginas * (1 - percent)
      return {
        id,
        titulo: livro?.title ?? 'Livro removido',
        autor: livro?.author ?? '',
        segundos: l.segundos,
        paginas: l.paginas,
        ultimoDia: l.ultimoDia,
        percent,
        ritmo,
        faltam: ritmo && percent < 1 && faltamPaginas > 0 ? (faltamPaginas / ritmo) * 3600 : null,
      }
    })
    .sort((a, b) => b.ultimoDia.localeCompare(a.ultimoDia) || a.titulo.localeCompare(b.titulo, 'pt-BR'))

  return {
    hoje: porDia.get(hoje) ?? vazio(),
    semana: noPeriodo(7),
    total: { ...total, dias: diasLidos.length },
    sequencia: { atual, maior },
    media: {
      nosDiasLidos: diasLidos.length
        ? { segundos: total.segundos / diasLidos.length, paginas: total.paginas / diasLidos.length }
        : null,
      porDia: periodo ? { segundos: doPeriodo.segundos / periodo, paginas: doPeriodo.paginas / periodo, dias: periodo } : null,
    },
    porDia,
    lidos,
    livros: porLivroLista,
  }
}

// ---------- Para mostrar ----------

export function duracao(segundos) {
  const minutos = Math.round(segundos / 60)
  if (segundos > 0 && minutos < 1) return 'menos de 1 min'
  if (minutos < 60) return `${minutos} min`
  const h = Math.floor(minutos / 60)
  const m = minutos % 60
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`
}

export function paginas(n) {
  const inteiro = Math.round(n)
  return inteiro === 1 ? '1 página' : `${inteiro.toLocaleString('pt-BR')} páginas`
}
