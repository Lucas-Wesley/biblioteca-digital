# Biblioteca Digital — Plano do Projeto

> Leitor + biblioteca digital pessoal (PDF/EPUB). Registro das decisões até **03/11/2026**.
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
2. **Biblioteca** (guardar, classificar, achar os livros; arquivos no SSD externo).
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
| R11 | **Telegram** como fonte via API (ex.: Telethon): encaminhar/compartilhar → baixar pro SSD | Mecanismo funciona; entra como adaptador. |
| R12 | **Só conteúdo legítimo**: domínio público, licença aberta, ou arquivos que eu tenho direito | Regra de direito autoral do projeto. Ver [`FONTES.md`](FONTES.md). |
| R13 | Self-hosted no homelab, **LAN-only**; arquivos dos livros no **SSD externo** (junto do Acervo) | Privacidade; centralização do armazenamento. |

---

## 3. Em aberto (a definir)

- [ ] Stack do backend (linguagem/framework) e do frontend PWA.
- [ ] Modelo de dados das **anotações/marcações** (esquema do CFI/coordenadas, cores, notas).
- [ ] Banco de dados (qual, e esquema da biblioteca/metadados).
- [ ] Estrutura de **pastas dos arquivos** no SSD externo.
- [ ] Livros **comprados com DRM** — o que dá e o que não dá pra centralizar.
- [ ] Leitura/sincronização de progresso entre dispositivos.
- [ ] Endpoints da API (seguindo o contrato comum, quando ele for definido).
- [ ] Quais sites concretos vão virar adaptadores (mapear um a um — ver `FONTES.md`).

---

## 4. Contexto do ambiente

Mesmo homelab dos outros apps: Proxmox no M920q, **LAN-only**, armazenamento no **SSD externo**.
Ver arquitetura do ecossistema no repo Hub (`hub-home-lab-web`).
