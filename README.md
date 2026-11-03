# Biblioteca Digital

Leitor e biblioteca digital pessoal para **PDF e EPUB** — livros que eu já tenho, que vou baixar e
que vou comprar, centralizados num só lugar, com **anotações e marcações**, e com **busca e
aquisição** a partir de fontes legítimas.

Repositório: `github.com/Lucas-Wesley/biblioteca-digital`

> **Status:** fase de planejamento / documentação. Nada implementado ainda.

## O que é

- **Leitor** de PDF e EPUB como **PWA** (funciona no navegador, "instala" no celular/desktop).
- **Anotações e marcações** dentro dos livros, com extração de texto.
- **Biblioteca**: upload manual, metadados automáticos e classificação por categoria.
- **Fontes**: busca e download a partir de fontes abertas/legítimas, via um padrão de
  **adaptador de fonte** (cada fonte é um módulo plugável). Ver [`docs/FONTES.md`](docs/FONTES.md).

## Papel no ecossistema

A Biblioteca Digital é uma das aplicações **independentes** do ecossistema (banco próprio + API
própria). Ela **conversa** com as outras por API — não compartilha banco com ninguém.

Integrações previstas:
- **Biblioteca → Acervo:** enviar um capítulo/parágrafo para virar **texto de referência** ou
  alimentar um **Tema** do Acervo.
- **Biblioteca → Flashcards:** transformar uma **seleção** de texto em flashcard.

## Documentação

- [`docs/DECISOES.md`](docs/DECISOES.md) — o que está decidido e o que está em aberto.
- [`docs/FONTES.md`](docs/FONTES.md) — padrão de adaptador de fontes + regras de direito autoral.
- Arquitetura e contrato comum do ecossistema (repo separado, o **Hub**):
  [`hub-home-lab-web`](https://github.com/Lucas-Wesley/hub-home-lab-web) — ver `docs/ARQUITETURA.md`
  e `docs/CONTRATO.md` lá.
