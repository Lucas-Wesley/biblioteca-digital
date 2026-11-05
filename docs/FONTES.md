# Fontes de Livros — Padrão de Adaptador

> Como a Biblioteca Digital encontra e baixa livros. Rascunho de projeto, **03/11/2026**.

---

## 1. Ideia central: adaptador de fonte

Toda forma de obter um livro é uma **fonte**, e toda fonte é um **módulo plugável** com a mesma
cara. Isso transforma "cada site é um projeto à parte" em "cada site é só mais um adaptador", sem
mexer no resto do app.

Cada adaptador implementa (nomes ilustrativos):

```
buscar(termo)      -> lista de resultados { titulo, autor, formato, id_na_fonte, ... }
baixar(id_na_fonte) -> arquivo (PDF/EPUB) salvo no servidor + metadados
```

A **busca** do app é **federada**: pergunta pra todos os adaptadores habilitados em paralelo e junta
os resultados numa lista única, marcando de qual fonte veio cada um. Eu escolho na lista e mando
baixar.

Até o **upload manual** é tratado como uma "fonte" (a fonte sou eu, enviando o arquivo).

---

## 2. Camadas de fonte (por ordem de prioridade de construção)

### 🟢 Fontes abertas / domínio público — começar por aqui

Têm **API de verdade** (não precisa raspar), são estáveis e legais. São a base da busca:

- **Project Gutenberg** via **Gutendex** (API) — clássicos de domínio público.
- **Internet Archive** — acervo enorme, tem API.
- **Open Library** — metadados + alguns textos; ótima também pra enriquecer metadado.
- **Standard Ebooks** — EPUBs de domínio público bem produzidos.

### 🟡 Scraping por site — um script específico por site

Para sites **legítimos** que não têm API. Cada site vira **um adaptador/script próprio**, porque
cada um tem seu caminho de busca e download. Caveats conhecidos e aceitos:
- **Frágil:** quebra quando o layout muda; muitos têm anti-bot (Cloudflare). É **manutenção
  contínua** — cada site é um trabalho à parte.
- Mapear **site a site**: documentar o passo a passo (como buscar, como chegar no arquivo) antes de
  escrever o adaptador.

### 🟡 Telegram — adaptador via API

Mecanismo: usar a API do Telegram (ex.: **Telethon**) pra, a partir de um link/encaminhamento de
mensagem que eu tenho acesso, **baixar o arquivo** direto pro servidor. Entra como mais um adaptador.

---

## 3. Regra de direito autoral (vale pra todos os adaptadores)

**Só entra conteúdo legítimo:** domínio público, licença aberta (ex.: Creative Commons), ou
arquivos que eu **tenho direito** de ter (meus, comprados, ou de fontes autorizadas). A arquitetura
de adaptador é neutra — o que decide a legalidade é **qual fonte eu plugo**. Fontes que distribuem
obra protegida sem autorização ficam **de fora**.

---

## 4. Em aberto

- [ ] Lista concreta dos sites que vão virar adaptadores (mapear um a um).
- [ ] Interface exata do adaptador (assinatura de `buscar`/`baixar`, formato do resultado).
- [ ] Como habilitar/desabilitar e configurar cada fonte.
- [ ] Deduplicação (mesmo livro em várias fontes) e qualidade (qual edição preferir).
