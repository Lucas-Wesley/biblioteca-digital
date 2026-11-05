# Referências visuais

Guia para evoluir a identidade visual. A direção foi decidida pelo Lucas em 04/11/2026 (R22):
**minimalismo no estilo Apple, com o texto em primeiro lugar**. A primeira versão foi feita a partir
dessa direção e de padrões conhecidos; a comparação tela a tela com as referências abaixo ainda não
foi feita e serve para os próximos ajustes.

## Onde olhar

| Referência | Por que olhar | Como acessar |
|---|---|---|
| Kindle (app e aparelho) | Leitura sem distrações, marcações, tempo restante | App grátis |
| Apple Books | Biblioteca, temas, tipografia | iPhone ou Mac |
| Kobo (app e aparelho) | Ajustes finos de leitura e estatísticas | App grátis |
| Readest | App aberto com muitos recursos, próximo do nosso caso | [readest](https://github.com/readest/readest) |
| Thorium Web | Interface de referência sobre o Readium | [thorium-web](https://github.com/edrlab/thorium-web) |
| KOReader | Ajustes avançados para quem lê muito | [koreader](https://github.com/koreader/koreader) |
| Readium CSS | Recomendações de ajustes de leitura e acessibilidade | [documentação](https://readium.org/readium-css/docs/CSS14-user_settings_recs.html) |
| Apple HIG e Material Design | Padrões de cada celular: toque, navegação, tema escuro | Sites oficiais |

## O que comparar

Registre a mesma tela em cada referência, no celular e no computador:

1. **Biblioteca:** capas, continuar lendo, filtros, livro sem capa.
2. **Página de leitura:** o que fica visível e como os controles aparecem e somem.
3. **Virar a página:** toque, gesto, animação, rolagem.
4. **Ajustes:** quais existem, como são agrupados e se a mudança aparece na hora.
5. **Sumário e progresso:** capítulo atual, barra, percentual, tempo restante.
6. **Marcações:** selecionar texto, escolher cor, escrever nota, rever as marcações.
7. **Temas:** claro, escuro, sépia e o que acontece com imagens.
8. **Primeiro uso:** biblioteca vazia e envio do primeiro livro.

## O que decidir

- **Personalidade:** discreta como um e-reader, ou com marca própria?
- **Tipografia:** fontes da interface e opções para o texto dos livros.
- **Cores:** paleta e cor de destaque, em claro, escuro e sépia.
- **Tokens:** partir das variáveis de `frontend/src/style.css`.
- **Ícones:** trocar os botões de texto do leitor, sem perder a clareza.
- **Marca:** nome exibido, ícone do PWA e tela de abertura.

## Estado atual do app

- **Leitura:** só o texto e um percentual discreto. Os controles flutuam sobre a página, sem mover o texto.
- **Ajustes:** painel sem escurecer a página, para a mudança aparecer enquanto se escolhe.
- **Cores:** cinzas neutros da Apple, em claro, sépia e escuro; valores em `frontend/src/style.css`.
- **Tipografia:** fonte do sistema na interface e Literata nos livros, com a do próprio livro como opção.
- **Ícones:** traço fino, em `frontend/src/Icone.vue`. Ícone do app: um livro aberto em linha.

## Como registrar

Guarde as capturas em `docs/referencias/` e anote aqui, para cada referência: o que adotar, o que
evitar e por quê. As capturas são de produtos de terceiros e a repo é pública, então confirme se elas
devem ir para o Git ou ficar fora dele.
