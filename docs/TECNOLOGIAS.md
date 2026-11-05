# Tecnologias: pesquisa e testes de 04/11/2026

Base da escolha do motor de leitura (R19) e da forma de usar o app no celular (R2). Os dados de
atividade vêm do GitHub e do npm, consultados nessa data.

**Decisão: Readium para EPUB, `PDF.js` para PDF, PWA com leitura offline.** Os testes práticos estão
em "Testes práticos", logo abaixo da tabela de pesquisa.

## Motor de EPUB

| | `epub.js` (em uso) | `foliate-js` | Readium `ts-toolkit` |
|---|---|---|---|
| Última versão estável | 0.3.93, de fev/2022; alpha 0.5 parada desde set/2023 | Não publica versões; o autor recomenda submódulo Git | `@readium/navigator` 2.14, de out/2026 |
| Último commit | mar/2026, depois de um intervalo de mai/2023 a out/2025 | mai/2026 (pedidos abertos até nov/2026) | 04/11/2026 |
| Estabilidade declarada | Sem declaração | "Não é estável; a API pode mudar a qualquer momento" | Versionamento semântico |
| Comunidade | 6,9 mil estrelas, 516 issues abertas | 1,1 mil estrelas, 71 issues; usado pelo Foliate e pelo Readest | 159 estrelas, 74 issues; usado pelo Thorium Web |
| Fonte, cores, espaçamento | Manual, com CSS injetado | Parcial; o app monta o resto | Pronto: família, tamanho, cores, altura de linha, espaçamentos, largura de linha |
| Marcações | Sim; há bug aberto em sublinhado entre parágrafos (#1415) | Sim, `overlayer.js` | Sim, `@readium/decorator` 1.4, com testes visuais |
| Âncora da marcação | CFI | CFI | Locator: intervalo exato, com recurso à citação do texto e a seletor CSS |
| Busca dentro do livro | Básica, por seção | Sim, `search.js` | Não encontrei no navigator |
| Leitura em voz alta | Não | Sim | Sim, `readaloud` |
| Outros formatos | Só EPUB | MOBI, AZW3, FB2, CBZ; PDF experimental | Áudio e quadrinhos; sem navegador de PDF |
| Mudança necessária aqui | Nenhuma | Trocar `motores/epub.js` | Trocar `motores/epub.js` e o Go passar a servir manifesto WebPub e os arquivos internos do EPUB |
| Riscos | Parado; alerta alto e moderado no `xmldom`, sem versão estável corrigida | API instável; bugs abertos no celular (#149, #150) | Migração maior e comunidade menor; integração ainda não testada aqui |

**Sobre o `npm audit`:** a "correção" que ele sugere é o `epub.js` 0.4.2, de 2018, mais antigo que o
atual. Não aplicar.

**Relato de migração:** um projeto pessoal com Go trocou o `foliate-js` pelo Readium + `PDF.js` em
out/2026, por telas em branco no celular. É um relato só, e esse projeto não usa marcações.

### Testes práticos

Mesmo roteiro nas três bibliotecas, com *Quincas Borba* e *Moby Dick*, nas versões publicadas em
04/11/2026. Foi rodado no Chromium em tamanho de Pixel 7 e no Chrome 134 de um emulador Android 16.

| Teste | `epub.js` | `foliate-js` | Readium |
|---|---|---|---|
| Deslizar o dedo no Android, sem código nosso | 0 de 6 | 6 de 6 | 6 de 6 |
| Salto ao mudar a fonte para 150%, Android, *Moby Dick* (caracteres) | 91.983 | 250 | 50.506 |
| O mesmo, voltando pela âncora do trecho | 40.234 | 250 | 220 |
| Salto no Chromium, sem ajuste / com âncora, *Moby Dick* | 64.492 / 60.025 | 466 / 466 | 53.395 / 373 |
| Reabrir na posição salva | Exato | Exato | Exato |
| Marcação cai no lugar, depois de mudar a fonte | Sim, mas em *Moby Dick* a âncora não levou ao trecho no Chromium | Sim | Sim |
| Tema escuro, sumário, 40 páginas sem travar | Sim | Sim | Sim |
| Offline, com a rede cortada (só no Chromium) | Sim, 1 arquivo | Sim, 1 arquivo | Sim, 21 arquivos em *Moby Dick* |
| Busca dentro do livro | Sim, feita por nós | Sim, pronta | Não existe; a fazer com as marcações |
| Erros de JavaScript e página em branco | Nenhum | Nas 3 rodadas do Chromium com *Moby Dick*: 2 tipos de erro; 1 página vazia em 40 nas 2 últimas. Nenhum no Android | Nenhum |
| JavaScript do motor (gzip) | 105 KB | Cerca de 35 KB | 101 KB, mais o CSS de leitura |

Abrir o livro e virar a página foram rápidos nas três (menos de 0,5 s e de 0,11 s, no Android). O
tempo de virar mede até a mudança de posição, e não até a tela terminar de desenhar.

**Limites:** emulador não é aparelho real, foram só dois livros de domínio público, e o offline não
rodou no emulador. Tudo isso precisa ser confirmado no celular do Lucas.

### Manutenção pelo nosso lado

| | `epub.js` | `foliate-js` | Readium |
|---|---|---|---|
| Código (linhas) | 14,6 mil de JavaScript | 7,1 mil de JavaScript | 38 mil de TypeScript, em pacotes separados |
| Compilar com o Node 24 | **Falha**; só compila com opção legada do OpenSSL | Não precisa compilar | Passa, cerca de 3 s por pacote |
| Rodar os testes | **Falham ao carregar** | Só existem testes de CFI | 519 passam em `shared`; `decorator` tem 11 arquivos de teste visual (não rodei); **`navigator` não tem testes** |
| Commits em 12 meses | Poucos: 5 em 3 anos | 15 | 85 |
| Pedidos aceitos (mediana de dias, últimos 40) | 27, com 31 abertos | 5, com 32 abertos | 0, com 9 abertos |
| Principais autores | 1, praticamente parado | 1 | 2, em organização dedicada |
| Como alterar sem depender deles | Fork com build antigo | Copiar os arquivos para a repo | Preferências, recursos injetados e marcações; para o resto, `patch` ou fork, com tipos |

**Mais fácil de modificar: `foliate-js`.** O código é pequeno e não tem build, mas quase nenhum teste
avisa quando uma mudança quebra algo, e fica tudo nas mãos de uma pessoa.

**Mais seguro de manter: Readium.** Há mais código para entender e o `navigator` não tem testes, mas
os tipos e as extensões reduzem a necessidade de mexer no núcleo, e há quem corrija com rapidez.

**Pior nesse critério: `epub.js`.** Consertá-lo exige antes recuperar o build e os testes.

### Por que Readium

1. **Menos chance de precisar de correção nossa:** nenhum erro nos testes e equipe ativa.
2. **Conserto possível sem fork:** o salto ao mudar a fonte se resolve no app, voltando pela âncora do
   trecho. Esse ajuste faz parte da migração.
3. **Recursos pedidos já prontos:** família de fonte, cores, altura de linha, espaçamentos e largura
   da linha.
4. **Marcação resistente:** o Locator guarda a citação do texto, além da posição (R5).

**O que custa:** o Go passa a entregar manifesto, lista de posições e os arquivos internos do EPUB
(cerca de 200 linhas no teste, ainda sem o sumário em EPUB 3), a busca no livro será nossa, e o
offline guarda vários arquivos em vez de um.

**Plano B:** `foliate-js`, copiado para a repo, se o Readium falhar no celular real. A interface de
motor do app (`motores/`) mantém essa troca barata.

## Celular: PWA ou app nativo

| Necessidade | PWA no iPhone | PWA no Android | App nativo |
|---|---|---|---|
| Ler, marcar, ajustar | Sim | Sim | Sim |
| Instalar | Tela de Início, sem aviso | Menu do Chrome | iPhone: US$ 99/ano, ou reinstalar a cada 7 dias com conta grátis. Android: APK grátis |
| Atualizar | Automático | Automático | Reinstalar |
| Espaço para livros | Até 60% do disco por origem | Depende do navegador | Sem limite do navegador |
| Livros offline garantidos | Não: `persist()` pode ser recusado | Não totalmente | Sim |
| Receber arquivo de outro app | **Não** | Sim, Chrome 76+ | Sim |
| Abrir `.epub` direto do sistema | **Não** | **Não** (`file_handlers` no Chrome Android) | Sim |
| Baixar em segundo plano | **Não** | Sim, no Chrome | Sim |

### Recomendação

**Manter o PWA**, como na R2. O celular do Lucas é Android, onde o PWA tem o maior suporte. Os livros e as marcações ficam no servidor, então perder a cópia
offline só obriga a baixar de novo. O nativo traria mais integração com o sistema, não mais recursos
de leitura, e custaria manutenção em duas bases.

**Leitura fora de casa:** decidida como download dentro do PWA (R20), já que o app é LAN-only.

**Reavaliar se:** receber arquivos de outros apps no iPhone virar uso frequente, ou o iOS apagar os
livros offline com frequência. O caminho seria o Capacitor, que reaproveita o Vue. O Readium também
tem toolkits para Swift e Kotlin. No Android, um app nativo precisa declarar a CA própria em
`network_security_config`.

## Fontes

- [epub.js](https://github.com/futurepress/epub.js) · [versões no npm](https://www.npmjs.com/package/epubjs?activeTab=versions)
- [foliate-js](https://github.com/johnfactotum/foliate-js) · [issue 149](https://github.com/johnfactotum/foliate-js/issues/149) · [issue 150](https://github.com/johnfactotum/foliate-js/issues/150)
- [Readium ts-toolkit](https://github.com/readium/ts-toolkit) · [Thorium Web](https://github.com/edrlab/thorium-web) · [Readest](https://github.com/readest/readest)
- [Relato de migração](https://github.com/xdoubleu/tools.xdoubleu.com/issues/2312)
- [Política de armazenamento do WebKit](https://webkit.org/blog/14403/updates-to-storage-policy/)
- [Dados de compatibilidade do MDN](https://github.com/mdn/browser-compat-data)
- [Contas de desenvolvedor Apple](https://developer.apple.com/support/compare-memberships/)
- [Configuração de rede no Android](https://developer.android.com/privacy-and-security/security-config)

## O que apareceu depois, ao usar o Readium de verdade

Encontrado durante a migração de 04/11/2026, e que os testes comparativos não mostraram:

- **Offline:** os quadros são `blob:` com sandbox, e o que pedem não passa pelo service worker. O teste comparativo só via o texto; CSS, imagens e fontes ficavam de fora. A solução é embutir tudo em `blob:` (`motores/embutir.js`).
- **Posição:** o Locator de `positionChanged` traz só o percentual do capítulo. Para manter o trecho ao mudar a fonte, o app mesmo lê o texto visível (`trechoVisivel`) e espera o layout assentar.
- **Toque em marcação:** responder `true` em `onDecorationActivated` faz o Readium descartar o toque seguinte, qualquer que seja. O app responde `false` e ignora o toque por conta própria.
- **Fontes:** a política de segurança do quadro só libera a pasta do livro e `blob:`, então a Literata também entra como `blob:`.
- **`PDF.js`:** a versão normal não abre PDF no Chrome 134; o app usa a legacy.
