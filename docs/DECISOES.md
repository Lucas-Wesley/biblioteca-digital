# Biblioteca Digital — Plano do Projeto

> Leitor + biblioteca digital pessoal (PDF/EPUB). Registro das decisões até **04/11/2026**.
> Parte do ecossistema — arquitetura e contrato comum ficam no repo **Hub**
> ([`hub-home-lab-web`](https://github.com/Lucas-Wesley/hub-home-lab-web): `docs/ARQUITETURA.md` e
> `docs/CONTRATO.md`).

---

## 1. O que é

Aplicação para **ler e organizar livros em PDF e EPUB** (que eu tenho, baixo ou compro), com
**anotações/marcações**, **busca** e **aquisição** de livros, centralizada no
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
| R2 | Frontend como **PWA (web)**, não Flutter | Revisto em 04/11/2026 ([`TECNOLOGIAS.md`](TECNOLOGIAS.md)): segue PWA, e o celular do Lucas é Android. Ler **EPUB com anotações** é muito mais maduro na web (`EPUB.js`/`foliate-js`) que em Flutter; PWA já instala no celular e no desktop. Flutter nativo fica como opção futura só se a leitura mobile pedir. |
| R3 | Renderização: **`PDF.js`** para PDF e **Readium** para EPUB (R19) | Motor ativo para cada formato. |
| R4 | Formatos: **PDF e EPUB** | É o que eu tenho/compro. |
| R5 | Guarda **anotações e marcações** + extração de texto | Parte central do uso de estudo. Ancoragem: **Locator do Readium** no EPUB (citação do texto + posição), página+coordenadas (ou texto) no PDF, pra marcação não "escorregar". |
| R6 | **Integra com o Acervo** (capítulo/parágrafo → referência/Tema) e com o **Flashcards** (seleção → card) via API | Motivo de estar no ecossistema. A anotação sai como um **Fragmento** (texto + fonte=livro + localizador). |
| R7 | **Upload manual** com metadados automáticos + categoria editável | EPUB já traz metadado embutido; PDF quase sempre não, então consulto por título/ISBN em **API aberta** (Open Library, Google Books) e eu confirmo/edito a categoria. |
| R8 | Aquisição por **padrão de adaptador de fonte** (busca federada) | Cada fonte é um módulo plugável com `buscar()` + `baixar()`; adicionar fonte nova não mexe no resto. Detalhes em [`FONTES.md`](FONTES.md). |
| R9 | **Começar pelas fontes abertas/domínio público** (Project Gutenberg/Gutendex, Internet Archive, Open Library, Standard Ebooks) | Têm **API de verdade**, são estáveis e legais. Base ideal da busca. |
| R10 | **Scraping por site = um script específico por site** | Cada site tem seu caminho; é frágil (layout muda, anti-bot) e vira manutenção contínua. Entra como "só mais um adaptador". **Ciente de que cada site é um trabalho à parte.** |
| R11 | **Telegram** como fonte via API (ex.: Telethon): encaminhar/compartilhar → baixar pro servidor | Mecanismo funciona; entra como adaptador. |
| R13 | Self-hosted no homelab, **LAN-only**; arquivos dos livros no **disco interno** do M920q (junto do Acervo) | Privacidade; centralização do armazenamento. |
| R14 | **Stack:** Go na API, Vue no PWA, **SQLite** como banco próprio do app | Mesma stack do Flashcards; um arquivo por app, sem serviço de banco para manter. |
| R16 | **Menu lateral** como navegação principal: "Início" (lista de livros) e "Enviar arquivo"; novos itens entram nele | Pedido do Lucas em 04/11/2026. No celular, o menu abre por um botão. |
| R17 | **Layout de e-reader feito sem skill**, com base em padrões conhecidos (Kindle, Apple Books, Kobo): grade de capas, laterais viram a página, centro esconde os controles, sumário e ajustes em painéis | O problema é antigo e bem resolvido; referências do Lucas entram se ele quiser outro visual. |
| R18 | **Preferências de leitura por aparelho** (`localStorage`); **progresso no servidor**, valendo o último salvo | O tamanho de letra bom no celular não é o do computador; a posição precisa seguir o leitor entre aparelhos. |
| R19 | **Readium `ts-toolkit` no lugar do `epub.js`**; `foliate-js` como plano B | Testes práticos em [`TECNOLOGIAS.md`](TECNOLOGIAS.md): sem erros, deslizar nativo no Android, preferências prontas, equipe ativa e extensões que evitam fork. O `epub.js` está parado e nem compila em Node atual. |
| R20 | **Leitura offline dentro do PWA:** o Lucas escolhe o livro, baixa e lê fora de casa | O app é LAN-only e o Lucas quer ler fora de casa. O progresso feito offline sincroniza ao voltar para a rede. |
| R21 | **Layout antes da busca em fontes abertas** | Pedido do Lucas: primeiro a visualização do livro e os recursos de leitura, depois a aquisição. |
| R22 | **Identidade visual: minimalismo no estilo Apple, com o texto em primeiro lugar** | Pedido do Lucas em 04/11/2026. Na leitura, só o texto e um percentual discreto; os controles flutuam sobre a página, só aparecem ao tocar no centro e somem ao virar a página. Cores neutras, sem marca chamativa; a cor fica para as capas e as marcações. Fonte da interface: a do sistema. Fonte do livro: Literata, incluída no app. |
| R23 | **Marcação e nota são a mesma coisa:** um trecho com cor e nota opcional | Modelo único para EPUB e PDF. O id nasce no aparelho, para funcionar offline. A posição é um Locator do Readium no EPUB e página + retângulos no PDF. O texto citado também é guardado, para servir depois ao Acervo e ao Flashcards. |
| R24 | **Mudanças ficam primeiro no aparelho** e sobem em fila, valendo a edição mais recente | Fora de casa o servidor não responde. O horário enviado é o da edição, não o da chegada: um celular que volta com progresso antigo não apaga o que foi lido depois em outro aparelho. |
| R25 | **Livro baixado entra no leitor com CSS, imagens e fontes embutidos em `blob:`** | Os quadros do Readium são `blob:` com sandbox, e o que pedem não passa pelo service worker; sem isso, o livro abriria sem estilo e sem imagens. |
| R26 | **`PDF.js` na versão legacy** | A versão normal não abre nenhum PDF no Chrome 134 (falta `Uint8Array.toHex`), e o app não deve depender da versão do navegador do celular. |
| R27 | **No toque, a seleção de texto é feita pelo app**, sem a seleção nativa (`motores/selecao-toque.js`) | Pedido do Lucas em 05/11/2026. A web não consegue desligar o menu do Android nem o painel de busca do Google, que vêm com a seleção nativa, e eles cobriam a barra do app. Sem ela, a barra é só nossa: marcar, nota, copiar, pesquisar, e depois Anki e Flashcards. No computador, com mouse, segue a seleção nativa. Limite: a seleção vale para a página visível. |
| R28 | **Modo texto no PDF**, como o modo de leitura do Chrome: o texto sai do PDF e corre na largura da tela, com as preferências de leitura do EPUB; a escolha entre página e texto é por livro | Pedido do Lucas em 05/11/2026: PDF de texto fica pequeno no celular. Parágrafos, títulos, notas, cabeçalhos e hifenização são deduzidos pela geometria das linhas, no aparelho, e por isso funciona offline. As ligaduras que o PDF perdeu são recuperadas pelo vocabulário do próprio livro. As imagens entram depois do parágrafo em que estavam, desenhadas a partir do recorte da página; ficam de fora as pequenas (ornamentos) e as que têm texto por cima. A posição continua sendo a página do PDF, com a fração lida ("12.40"), então os dois modos e os outros aparelhos se entendem. Fora por enquanto: marcar no modo texto (as marcações do PDF são presas à página desenhada) e PDF escaneado, que precisaria de OCR. |
| R29 | **Ajustes de leitura por livro e estilos prontos.** Fonte, tamanho, fundo, entrelinhas, margens, alinhamento e zoom ficam guardados em cada livro, e o tema do livro vale só enquanto ele está aberto. O primeiro estilo pronto, **Acervo**, é também o padrão de um livro novo: Literata a 110%, entrelinha confortável (1,72), margem pequena, alinhado à esquerda e fundo do design system, claro ou escuro como o aparelho | Pedido do Lucas em 06/11/2026: a leitura do Acervo ficou boa no celular, ele quer a mesma nos livros sem ajustar à mão, e mudar a fonte de um livro não deve mexer nos outros. Os ajustes ficam no aparelho (localStorage), como antes, e os ajustes globais antigos foram descartados. |
| R30 | **Ajustes com sugestões de melhoria.** No fim do menu, o Lucas anota o que pode melhorar; o Claude Code lê por `GET /api/sugestoes`, faz e marca como feita, com uma resposta que aparece no app. A API é a mesma do Acervo e das próximas apps | Pedido do Lucas em 06/11/2026. A sugestão vai pela fila offline do app (escrita fora de casa, sobe depois) e guarda a tela de onde ele foi para Ajustes. |
| R31 | **Estatísticas de leitura.** O leitor conta o tempo com o livro aberto e as páginas lidas, por dia e por livro, e a tela **Estatísticas** mostra hoje, os últimos 7 dias, os dias seguidos, o total, as médias (nos dias lidos e por dia nos últimos 30), os minutos ou páginas por dia, o calendário dos dias de leitura e, por livro, o ritmo e a previsão de quanto falta | Pedido do Lucas em 06/11/2026. Os cuidados que ele aprovou: o tempo para com a tela apagada, com o app em segundo plano ou depois de **5 minutos sem virar a página** (os 5 minutos contam); uma página só conta depois de **3 segundos** na tela, e reler no mesmo dia não soma; no PDF a página é a real; no **EPUB**, que não tem página fixa, a página é estimada pelo texto lido, com **1.500 caracteres** por página (o servidor conta o texto e manda no manifesto, como `numberOfPages`); o dia é o do **horário de Brasília** e a leitura que passa da meia-noite se divide; um dia conta como dia de leitura a partir de 1 minuto. Cada aparelho guarda o seu total do dia e o manda pela fila offline (`PUT /api/books/{id}/reading/{dia}`); o servidor guarda um registro por aparelho, dia e livro, valendo o maior total, e `GET /api/reading` devolve tudo para as contas, que ficam no app. As estatísticas começam em 06/11/2026: antes disso só havia a última posição de cada livro. |
| R32 | **Busca no texto dos livros.** O servidor guarda o texto de cada livro num índice FTS5 do SQLite, em trechos de uma página: no **PDF**, a página real (tirada com o `pdftotext`, do Poppler); no **EPUB**, perto de 1.500 caracteres quebrados no fim de um parágrafo, com o número da página estimada (a régua da R31) e o capítulo do sumário. A busca ignora acentos e acha o começo das palavras ("laranja" acha "laranjeira"); traz primeiro os trechos com todas as palavras e completa com os que têm qualquer uma. `GET /api/search?q=&limit=&book=` devolve livro, página, capítulo, o trecho com as palavras achadas e a âncora para abrir o livro ali. Na tela **Buscar nos meus livros**, tocar num trecho abre o livro naquele ponto (`#/livro/<id>?em=<âncora>`) | Pedido do Lucas em 06/11/2026, para ele e para o **Pesquisador do Acervo**, que pesquisa nos livros e cita livro e página. O índice é feito em segundo plano ao iniciar e a cada livro enviado (os 7 livros de hoje: 2 s, 8 MB). PDF escaneado não tem texto e aparece como "fora da busca", com o motivo; não há OCR. |
| R15 | **Segurança fica por último:** autenticação e backup só depois das funcionalidades | Só o Lucas usa a rede, e o foco agora é a funcionalidade. Até lá, o app fica sem login e os dados ficam só no NVMe, sem cópia; esse risco foi aceito. |

---

## 3. Ordem de desenvolvimento

Revista em 04/11/2026. **Próximo passo: item 1.**

**Já publicado:**
- Upload e catálogo; progresso de leitura; menu lateral e grade de capas.
- EPUB pelo Readium, com o Go entregando manifesto, posições, sumário e arquivos internos; as posições salvas pelo `epub.js` foram convertidas.
- Leitura offline de EPUB e PDF, com download por livro, vista "Baixados" e sincronização ao voltar.
- Leitor com tipo e tamanho de fonte, entrelinhas, margens, alinhamento, temas claro, sépia e escuro, barra de progresso e "Continuar lendo".
- Marcações em quatro cores com nota, em EPUB e PDF, com lista por livro. Seleção por toque do próprio app, com copiar e pesquisar na Web.
- Estatísticas de leitura (R31): tempo, páginas, dias de leitura, médias e, por livro, ritmo e previsão de quanto falta.
- Busca no texto dos livros (R32), na tela Buscar nos meus livros e pela API, para o Pesquisador do Acervo.
- Botão de tela cheia no topo do leitor, que esconde as barras do Android. No PDF com zoom, a página abre centralizada e, ao virar, mantém a posição horizontal escolhida e volta ao topo.

1. **Marcações no modo texto do PDF (R28):** o modo texto está publicado, com imagens; falta marcar nele.
2. **Busca em fontes abertas:** começar pelo Gutendex e pela Open Library, com um adaptador por fonte.
3. **Segurança, por último (R15):** token de acesso e backup fora do NVMe. Falta escolher o destino do backup: o Mac é o mais simples, mas só protege quando estiver ligado; a nuvem funciona sempre, mas os dados saem da rede.

As integrações com o Acervo e o Flashcards ficam para quando esses apps existirem.

---

## 3.1. Recursos: o que ficou de fora

Os pedidos de 04/11/2026 (tipo de fonte, cor de fundo, barra de progresso, tema, tamanho) estão publicados. Falta decidir ou fazer:

- **Extração de capítulos:** a estrutura (sumário com níveis) já sai no servidor. O texto de cada capítulo ainda não é guardado; faz sentido quando a busca ou o Acervo precisarem dele.
- **Marcador de página** (sem trecho selecionado) e **rolagem contínua:** comuns em outros leitores, ainda não feitos. O **tempo restante** de cada livro já aparece em Estatísticas (R31); falta mostrá-lo dentro do leitor, se o Lucas quiser.
- **Busca dentro do livro:** o Readium não traz.
- **Tema nas imagens:** no EPUB as imagens ficam como estão; no PDF, o tema escuro inverte também as imagens.

---

## 4. Estado atual

- **No ar:** https://192.168.1.20:8443, com tudo o que está em "Já publicado" na seção 3. O certificado raiz já está instalado no Mac e no celular.
- **Publicar:** `git push origin main` e depois `./deploy.sh`. O script roda os testes, publica, confere a versão no ar, testa no servidor e volta à versão anterior se o app não ficar saudável.
- **Testar:** `make test` roda os testes do Go, do Vue e de navegador. Mais comandos no [`README.md`](../README.md).
- **Infraestrutura:** VM, HTTPS e acesso estão em `README.md` e `PLANO-BASE.md`, na pasta `homelab/`, fora das repos.
- **Testado em Android só no emulador** (Chrome 134): deslizar, tocar, selecionar segurando o dedo, marcar, ler EPUB e PDF com o servidor desligado e sincronizar ao voltar. No celular real (Samsung, com Chrome), o Lucas usou a versão de 04/11/2026; falta confirmar a seleção por toque e a instalação do PWA.
- **Limites conhecidos:** apagar uma marcação não deixa rastro, então uma edição offline em outro aparelho pode recriá-la; o que fica no aparelho aguardando envio usa o `localStorage` (cerca de 5 MB); um livro cujo capítulo é só uma imagem, sem XHTML, não teve o offline testado.
- **Sem commit:** as correções sobre o SSD externo estão só no Mac, na `hub-home-lab-web`. Faça o commit quando o Lucas autorizar.

---

## 5. Em aberto (a definir)

- [ ] Categoria dos livros e metadados de PDF (R7).
- [ ] `npm audit` aponta `deepmerge` e `glob`, que vêm de ferramentas de build e teste (`vite-plugin-pwa`, `@vue/test-utils`) e não vão para o app. A correção automática rebaixaria essas ferramentas; reavaliar quando saírem versões novas.
- [ ] Excluir e editar livros pelo app (hoje, só apagando o arquivo no servidor).
- [ ] Nome em vez de IP (`biblioteca.local` por mDNS ou DNS local): fica para depois das funcionalidades; por enquanto, só o IP.
- [ ] Livros **comprados com DRM** — o que dá e o que não dá pra centralizar.
- [ ] Endpoints da API (seguindo o contrato comum, quando ele for definido).
- [ ] Quais sites concretos vão virar adaptadores (mapear um a um — ver `FONTES.md`).

---

## 6. Contexto do ambiente

Mesmo homelab dos outros apps: Proxmox no M920q, **LAN-only**, armazenamento no **disco interno**.
Ver arquitetura do ecossistema no repo Hub (`hub-home-lab-web`).
