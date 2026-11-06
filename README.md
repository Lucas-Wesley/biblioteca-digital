# Biblioteca Digital

Leitor e biblioteca digital pessoal para **PDF e EPUB** — livros que eu já tenho, que vou baixar e
que vou comprar, centralizados num só lugar, com **anotações e marcações**, e com **busca e
aquisição** de livros.

Repositório: `github.com/Lucas-Wesley/biblioteca-digital`

> **Status:** upload, catálogo e leitor de EPUB e PDF, com progresso de leitura. Ver [`docs/DECISOES.md`](docs/DECISOES.md).

## O que é

- **Leitor** de PDF e EPUB como **PWA** (funciona no navegador, "instala" no celular/desktop).
- **Anotações e marcações** dentro dos livros, com extração de texto.
- **Estatísticas de leitura**: tempo e páginas por dia, dias de leitura, médias e, por livro, ritmo e previsão de quanto falta.
- **Biblioteca**: upload manual, metadados automáticos e classificação por categoria.
- **Fontes**: busca e download a partir de várias fontes, via um padrão de
  **adaptador de fonte** (cada fonte é um módulo plugável). Ver [`docs/FONTES.md`](docs/FONTES.md).

## Papel no ecossistema

A Biblioteca Digital é uma das aplicações **independentes** do ecossistema (banco próprio + API
própria). Ela **conversa** com as outras por API — não compartilha banco com ninguém.

Integrações previstas:
- **Biblioteca → Acervo:** enviar um capítulo/parágrafo para virar **texto de referência** ou
  alimentar um **Tema** do Acervo.
- **Biblioteca → Flashcards:** transformar uma **seleção** de texto em flashcard.

## Desenvolvimento

Requer Go, Node e, para rodar a imagem localmente, Docker.

```bash
cd frontend && npm install && npx playwright install chromium && cd ..
make livro-exemplo   # baixa um EPUB de domínio público para data/books
make dev-api         # API em http://localhost:8080
make dev-web         # em outro terminal: app em http://localhost:5173
make test            # testes do Go, do Vue e de navegador (com dados temporários)
```

`docker compose up --build` roda a mesma imagem de produção em `http://localhost:8080`.

## Publicação

```bash
git push origin main
./deploy.sh
```

O script roda os testes, publica o commit de `origin/main` no homelab, confere a versão no ar e
repete os testes de navegador no servidor. Se o app não ficar saudável, ele volta ao commit
anterior. Alterações sem push não são publicadas.

Os dados ficam fora do Git: banco, livros e capas em `data/` no Mac e em `/srv/data/biblioteca` no servidor.

## Documentação

- [`docs/DECISOES.md`](docs/DECISOES.md) — o que está decidido e o que está em aberto.
- [`docs/FONTES.md`](docs/FONTES.md) — padrão de adaptador de fontes.
- Arquitetura e contrato comum do ecossistema (repo separado, o **Hub**):
  [`hub-home-lab-web`](https://github.com/Lucas-Wesley/hub-home-lab-web) — ver `docs/ARQUITETURA.md`
  e `docs/CONTRATO.md` lá.
