# Biblioteca Digital — Plano do Projeto

> Leitor + biblioteca digital pessoal (PDF/EPUB). Registro das decisões até **04/11/2026**.
> Parte do ecossistema — arquitetura e contrato comum ficam no repo **Hub**
> ([`hub-home-lab-web`](https://github.com/Lucas-Wesley/hub-home-lab-web): `docs/ARQUITETURA.md` e
> `docs/CONTRATO.md`).

---

## 1. O que é

Aplicação para **ler e organizar livros em PDF e EPUB** (que eu tenho, baixo ou compro), com
**anotações/marcações**, **busca** e **aquisição** a partir de fontes legítimas, centralizada no
homelab e acessível pelos meus dispositivos.

Três grandes frentes:
1. **Leitor** (abrir, ler, marcar, anotar — PDF e EPUB).
2. **Biblioteca** (guardar, classificar, achar os livros; arquivos no disco interno do servidor).
3. **Fontes** (de onde os livros vêm: upload, APIs abertas, scripts por site, Telegram).

---

## 2. Decisões tomadas

| # | Decisão | Por quê |
|---|---------|---------|
| R1 | App **independente** do ecossistema: banco próprio + API própria | Acoplamento mínimo; segue o padrão dos outros apps. |
| R2 | Frontend como **PWA (web)**, não Flutter | Ler **EPUB com anotações** é muito mais maduro na web (`EPUB.js`/`foliate-js`) que em Flutter; PWA já instala no celular e no desktop. Flutter nativo fica como opção futura só se a leitura mobile pedir. |
| R3 | Renderização: **`PDF.js`** para PDF, **`EPUB.js`** ou **`foliate-js`** para EPUB | São os motores open source comprovados pra cada formato. |
| R4 | Formatos: **PDF e EPUB** | É o que eu tenho/compro. |
| R5 | Guarda **anotações e marcações** + extração de texto | Parte central do uso de estudo. Ancoragem: **CFI** no EPUB, página+coordenadas (ou texto) no PDF, pra marcação não "escorregar". |
| R6 | **Integra com o Acervo** (capítulo/parágrafo → referência/Tema) e com o **Flashcards** (seleção → card) via API | Motivo de estar no ecossistema. A anotação sai como um **Fragmento** (texto + fonte=livro + localizador). |
| R7 | **Upload manual** com metadados automáticos + categoria editável | EPUB já traz metadado embutido; PDF quase sempre não, então consulto por título/ISBN em **API aberta** (Open Library, Google Books) e eu confirmo/edito a categoria. |
| R8 | Aquisição por **padrão de adaptador de fonte** (busca federada) | Cada fonte é um módulo plugável com `buscar()` + `baixar()`; adicionar fonte nova não mexe no resto. Detalhes em [`FONTES.md`](FONTES.md). |
| R9 | **Começar pelas fontes abertas/domínio público** (Project Gutenberg/Gutendex, Internet Archive, Open Library, Standard Ebooks) | Têm **API de verdade**, são estáveis e legais. Base ideal da busca. |
| R10 | **Scraping por site = um script específico por site** | Cada site tem seu caminho; é frágil (layout muda, anti-bot) e vira manutenção contínua. Entra como "só mais um adaptador". **Ciente de que cada site é um trabalho à parte.** |
| R11 | **Telegram** como fonte via API (ex.: Telethon): encaminhar/compartilhar → baixar pro servidor | Mecanismo funciona; entra como adaptador. |
| R12 | **Só conteúdo legítimo**: domínio público, licença aberta, ou arquivos que eu tenho direito | Regra de direito autoral do projeto. Ver [`FONTES.md`](FONTES.md). |
| R13 | Self-hosted no homelab, **LAN-only**; arquivos dos livros no **disco interno** do M920q (junto do Acervo) | Privacidade; centralização do armazenamento. |
| R14 | **Stack:** Go na API, Vue no PWA, **SQLite** como banco próprio do app | Mesma stack do Flashcards; um arquivo por app, sem serviço de banco para manter. |
| R15 | **Segurança fica por último:** autenticação e backup só depois das funcionalidades | Só o Lucas usa a rede, e o foco agora é a funcionalidade. Até lá, o app fica sem login e os dados ficam só no NVMe, sem cópia; esse risco foi aceito. |

---

## 3. Ordem de desenvolvimento

Combinada em 04/11/2026. **Item 1 publicado. Próximo passo: item 2.**

1. **Upload e catálogo (feito):** enviar EPUBs pelo app e guardar título, autor e capa no SQLite. O id do livro é o hash do conteúdo, o que recusa cópias repetidas. Ao iniciar, o app também cataloga os arquivos copiados à mão para `books/` e retira os que foram apagados de lá. Ainda não há como apagar um livro pelo app.
2. **Progresso de leitura:** continuar de onde parou em qualquer aparelho. O leitor já recebe a posição (CFI); falta salvá-la.
3. **Leitor mais confortável:** sumário, margens, tamanho de fonte e tema escuro. No desktop, o texto ocupa quase toda a largura da tela.
4. **PDF:** adicionar o `PDF.js`, seguindo o mesmo fluxo do EPUB.
5. **Anotações e marcações:** definir um modelo de dados que sirva para EPUB e PDF.
6. **Busca em fontes abertas:** começar pelo Gutendex e pela Open Library, com um adaptador por fonte.
7. **Segurança, por último (R15):** token de acesso e backup fora do NVMe. Falta escolher o destino do backup: o Mac é o mais simples, mas só protege quando estiver ligado; a nuvem funciona sempre, mas os dados saem da rede.

As integrações com o Acervo e o Flashcards ficam para quando esses apps existirem.

---

## 4. Estado atual

- **No ar:** https://192.168.1.20:8443, com Hello World, upload e catálogo de EPUBs e leitor mínimo. O certificado raiz já está instalado no Mac e no celular.
- **Publicar:** `git push origin main` e depois `./deploy.sh`. O script roda os testes, publica, confere a versão no ar, testa no servidor e volta à versão anterior se o app não ficar saudável.
- **Testar:** `make test` roda os testes do Go, do Vue e de navegador. Mais comandos no [`README.md`](../README.md).
- **Infraestrutura:** VM, HTTPS e acesso estão em `README.md` e `PLANO-BASE.md`, na pasta `homelab/`, fora das repos.
- **Ainda não testado:** instalar o PWA em um celular real.
- **Sem commit:** as correções sobre o SSD externo estão só no Mac, na `hub-home-lab-web`. Faça o commit quando o Lucas autorizar.

---

## 5. Em aberto (a definir)

- [ ] Modelo de dados das **anotações/marcações** (esquema do CFI/coordenadas, cores, notas).
- [ ] Categoria dos livros e metadados de PDF (R7).
- [ ] Nome em vez de IP (`biblioteca.local` por mDNS ou DNS local): fica para depois das funcionalidades; por enquanto, só o IP.
- [ ] Livros **comprados com DRM** — o que dá e o que não dá pra centralizar.
- [ ] Leitura/sincronização de progresso entre dispositivos.
- [ ] Endpoints da API (seguindo o contrato comum, quando ele for definido).
- [ ] Quais sites concretos vão virar adaptadores (mapear um a um — ver `FONTES.md`).

---

## 6. Contexto do ambiente

Mesmo homelab dos outros apps: Proxmox no M920q, **LAN-only**, armazenamento no **disco interno**.
Ver arquitetura do ecossistema no repo Hub (`hub-home-lab-web`).
