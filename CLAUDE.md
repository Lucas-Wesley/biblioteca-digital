# Biblioteca Digital

App do **ecossistema de apps pessoais do Lucas**. É o **1º app a ser desenvolvido**.

**Comece lendo:**
- [`docs/DECISOES.md`](docs/DECISOES.md) — decisões (PWA, `PDF.js`/`EPUB.js`, anotações com CFI, integrações, upload+metadados) e o que está em aberto.
- [`docs/FONTES.md`](docs/FONTES.md) — padrão de **adaptador de fonte** (busca federada) + **regra de direito autoral**.

## O que é
Leitor + biblioteca de **PDF e EPUB** como **PWA**, com **anotações/marcações**, e **aquisição** de livros via adaptadores de fonte (fontes abertas primeiro; scraping = 1 script por site; Telegram). **Só conteúdo legítimo.**

## Contexto do ecossistema
App **independente** (banco + API próprios) que conversa com **Acervo** e **Flashcards** por API — nunca banco compartilhado. Visão geral, roadmap e contrato comum no repo **Hub**: `github.com/Lucas-Wesley/hub-home-lab-web` (pasta `docs/`).

## Ambiente
Homelab **LAN-only**: Proxmox no Lenovo M920q (`192.168.1.10`). Rodar como **container**. Armazenamento no **disco interno do M920q** (arquivos de livro tendem a ser o que mais cresce).

## Regras e convenções
- **Só conteúdo legítimo** (domínio público / licença aberta / arquivos que o Lucas tem direito).
- Começar por uma **fatia vertical fina**; **não definir o contrato comum ainda**.
- **Commits:** autoria do Lucas; **sem linha `Co-Authored-By`**.
