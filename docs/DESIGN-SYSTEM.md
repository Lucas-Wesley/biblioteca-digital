# Design system das apps do homelab

Vale para a Biblioteca Digital, o Acervo e as próximas apps (Flashcards…). Há uma cópia igual em
`docs/DESIGN-SYSTEM.md` de cada app; os tokens ficam no começo do `frontend/src/style.css` de cada
uma, com os mesmos nomes e valores. Definido pelo Lucas em 06/11/2026.

## Princípios

1. **O texto vem primeiro.** Tudo o que não é conteúdo é menor, mais claro e mais discreto que ele.
2. **Neutro por padrão.** Branco, cinzas, preto e um toque de bege. Cor só quando precisa dizer algo.
3. **Listas finas.** Linhas separadas por um fio, alinhadas à esquerda, sem caixas nem sombras.
   Imagens pequenas (miniatura de vídeo, capa de livro) e só quando ajudam a reconhecer o item.
4. **Vidro no que flutua.** Barras fixas, abas e painéis sobre o texto usam fundo translúcido com
   blur; o resto da página é chapado.
5. **Botões pequenos.** 32 px de altura no computador e 36 px no toque. Só um botão preto por tela,
   para a ação principal.

## Cores

| Token | Claro | Escuro | Uso |
|---|---|---|---|
| `--fundo` | `#fbfaf8` | `#131312` | Fundo da página (branco quente) |
| `--superficie` | `#f3f1ed` | `#1c1c1b` | Hover, item ativo, blocos de apoio |
| `--superficie-forte` | `#e8e5df` | `#282826` | Chips, filtro ativo |
| `--texto` | `#1b1b1a` | `#e7e5e0` | Texto |
| `--texto-suave` | `#6d6a65` | `#9d9991` | Texto de apoio, ícones |
| `--texto-fraco` | `#9b978f` | `#6f6c66` | Metadados, rótulos, versão |
| `--linha` | preto 8% | branco 8% | Fios de separação |
| `--vidro` | fundo 72% | fundo 70% | Barras e painéis com blur |
| `--azul` | `#33608c` | `#8eb1d6` | Link, foco, seleção, progresso, "em andamento", "pronto" |
| `--terracota` | `#b4553a` | `#e3967c` | Erro, perigo, contador que pede atenção, citação |

Azul e terracota são o único contraste da paleta, e usá-los é a exceção:

- **Azul** é ação e informação: links, foco do teclado, seleção de texto, barra de progresso,
  estados "em andamento", "pronto" e "integrado", e linhas acrescentadas num diff.
- **Terracota** é atenção: erros, botões de apagar, o contador de revisões pendentes, linhas
  removidas num diff e o fio das citações.
- Cada um tem uma versão de fundo (`--azul-fundo`, `--terracota-fundo`) para chips e avisos.
- Sucesso não tem verde próprio: usa o azul.

O tema **sépia** da Biblioteca é o bege da paleta, com os mesmos papéis.

## Tipografia

- **Interface:** fonte do sistema (SF no Apple, Roboto no Android). Corpo de 15 px.
- **Leitura e títulos de conteúdo:** Literata. É usada no texto, no título de Temas e livros e no
  nome da app no menu.
- **Escala:** títulos de página com 28 px, peso 650 e espaçamento −0,025em. Na lista, título com
  19 px (Literata) ou 14 px (sistema), metadados com 12 px e rótulos de grupo com 11,5 px em
  maiúsculas e espaçados.
- **Leitura:** 17,5 px com entrelinha 1,72, coluna de no máximo 720 px.

## Forma e espaço

- **Raios:** 8 px (botão, campo), 12 px (aviso, cartão) e 18 px (painel, folha); a pílula usa 999 px.
- **Margem lateral:** 20 px no computador e 16 px no celular. Coluna de 720 px.
- **Sombra:** só em painéis que flutuam (`--sombra`). Listas e cartões não têm sombra.
- **Blur:** `blur(20px) saturate(1.6)` (`--blur`); o véu atrás de uma folha usa 4 px.

## Componentes

- **Navegação:** no computador, menu lateral de 216 px no fundo da página, com itens de 34 px e
  o item ativo em `--superficie`. No celular, **abas de vidro** no pé da tela; no leitor elas
  somem e o voltar fica na barra do topo.
- **Barra do leitor:** fixa, de vidro, com voltar, onde estou e ações em ícones redondos.
- **Lista:** `.lista` com um fio no topo e um em cada linha, linhas de 14 a 18 px de respiro e
  hover que muda só a cor do título para azul.
- **Filtros:** pílulas sem borda; a ativa ganha `--superficie-forte` e negrito.
- **Chips de estado:** neutro (cinza), azul (andando/pronto) ou terracota (erro).
- **Aviso rápido:** pílula de vidro no pé da tela, que some em 4 s.
- **Folha de ações:** sobe do pé da tela, com raio de 18 px e véu com blur leve.

## Referências que inspiraram

- Apple HIG, *Materials*: vidro e blur só nas camadas que flutuam.
- Readwise Reader, iA Writer e Apple Books: texto em primeiro lugar e serifa na leitura.
- Linear e Things: listas finas, interface neutra e uma cor só para ação.
- Os dois estudos de caso do Behance indicados pelo Lucas (TOP Game e MEO) ficaram só como
  consulta: o Behance bloqueia a leitura automática, então eles não foram analisados aqui.
