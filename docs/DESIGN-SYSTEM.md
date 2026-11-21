# Design system

A fonte do design system das apps do homelab é o **Hub**:
[`hub-home-lab-web/docs/DESIGN-SYSTEM.md`](https://github.com/Lucas-Wesley/hub-home-lab-web/blob/main/docs/DESIGN-SYSTEM.md),
com a vitrine viva em `hub.internal/#/design`. Decisão do Lucas em 18/11/2026.

A Biblioteca está na **quarta versão** desde 21/11/2026 (R42 em [`DECISOES.md`](DECISOES.md)): sem barra
no topo (a marca abre a lateral e o tema fica no pé dela e em Ajustes; no celular, a barra do pé
tem o Menu, que abre a gaveta), cabeçalho da página numa linha (`.topo-pagina`), quadros com rótulo
(`.quadro`, `.quadro-topo`, `.rotulo-secao`), números primeiro (`.numeros-quadro`) e painel ao lado
(`.duas-colunas`; e `.colunas-com-lateral`, daqui, quando o painel tem de vir antes no celular).
Os tokens e as classes do Hub estão no começo do `frontend/src/style.css`; mudança de design é lá
primeiro, depois se copia para cá.

O que só a Biblioteca tem (no fim do `style.css` e nos componentes):

- **Tema sépia**, só para o livro aberto: os mesmos tokens, com papel bege. O atributo do tema aqui
  é `data-theme` (`claro`, `sepia`, `escuro`; sem atributo = o do aparelho).
- **Tokens próprios:** `--m-amarelo`, `--m-verde`, `--m-azul`, `--m-rosa` (as cores das marcações),
  `--fonte-livro` (Literata: o texto do livro e as citações) e `--camera`, `--camera-disparo` (o
  fundo do vídeo e o botão de fotografar).
- **Peças:** capa de livro (`.capa-livro`), o rodapé do leitor (meta e livro separados, R43) e as
  folhas do leitor (sumário, ajustes, edição da marcação, Mais informações).
- **Ícone da app:** um livro aberto em traço azul (`#86bdf7`) sobre `#151515`, da mesma família do
  da Trilha (`frontend/public/favicon.svg`, `icon-192.png`, `icon-512.png`).
