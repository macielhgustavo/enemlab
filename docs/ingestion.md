# Plataforma de ingestão

Para entregar enunciados diretamente no resolvedor, consulte
[Entrega de questões nativas](native-questions.md): publicação por edição,
integridade dos arquivos e validação contra os providers existentes.

O [piloto UFT 2025.1](native-uft-validation.md) inclui verificação offline dos
PDFs originais, gabarito final completo e transcrição parcial explicitamente contada.

Como uma prova nova entra no ENEM Lab.

## O caminho

```
FONTE → DESCOBERTA → IMPORTADOR → BRUTO → VALIDADOR → CATÁLOGO → PROVIDER
```

Cada seta é um contrato, e cada um existe porque juntar dois deles já deu
problema antes:

| Etapa | Responde | Onde mora |
|---|---|---|
| Fonte | de onde vem, em que forma, o que podemos fazer | `sources/types.ts` |
| Descoberta | **quais edições existem** | `sources/ingestion.ts` |
| Importador | como o documento vira dado nosso | `scripts/`, por provider |
| Validador | dá para confiar nisto? | `sources/ingestion.ts` |
| Catálogo | o que existe, sem carregar nada | `catalog/index.ts` |
| Provider | como o app executa a prova | `providers/` |

## A regra que governa tudo: falhar fechado

Uma edição em que 59 de 60 questões foram lidas **não entra**. Não existe
"parece ter dado certo".

Reprovam a edição inteira:

- contagem diferente da esperada;
- número de questão duplicado ou faltando;
- questão sem gabarito, ou com letra fora do conjunto da prova;
- documento que não pôde ser baixado;
- documento que mudou na origem desde a última leitura.

Não reprovam, mas ficam registrados:

- só existe gabarito preliminar (edição recém-aplicada);
- questão depende de mídia ausente.

O motivo é assimétrico: prova ausente é um incômodo, prova errada corrige
errado — e correção errada contamina histórico, SRS e mapa de domínio de uma
vez, sem ninguém ver.

## Níveis de validação

| Nível | O que significa | Entra no banco padrão |
|---|---|---|
| `verified` | numeração e gabarito conferidos deterministicamente | sim |
| `reviewed` | pipeline + amostragem manual | sim |
| `provisional` | extraiu, ninguém olhou ainda | só sob pedido |
| `blocked` | inconsistência conhecida | nunca |

**O pipeline nunca se declara `verified` sozinho.** O melhor que
`validateEdition` concede é `provisional`: um programa não pode se declarar
conferido por outra pessoa. `verified` e `reviewed` só entram por
`acceptEdition(bruto, relatorio, nivelConferido)`, e quem passa esse
argumento está afirmando ter olhado.

Uma exceção que não se negocia: gabarito preliminar continua `provisional`
mesmo com conferência humana. O aviso é sobre o dado, não sobre quem olhou —
enquanto o final não sair, a resposta pode mudar.

## Gabarito

O dado mais crítico da plataforma.

Ordem de precedência: **retificação > final > preliminar**. Um importador que
pegar o primeiro arquivo que encontrar vai corrigir prova com resposta
revogada.

`inspectAnswerKey` reprova: questão fora do intervalo, letra que a prova não
usa, anulada **com** resposta atribuída, buraco na cobertura. Lista vazia é a
única forma de aprovar — não há "aprovado com ressalvas".

`diffAnswerKeys` mostra o que uma retificação mudou, para o relatório poder
dizer quais respostas o app estava usando erradas.

## Impressão digital

Cada documento guarda URL, tamanho, SHA-256, `last-modified`, `etag`, versão
do parser e data de importação.

Serve para uma pergunta: **o documento mudou?** Bancas publicam retificação
sem avisar. Sem isto, a primeira notícia seria um aluno acertando a questão e
o app dizendo que errou.

`compareFingerprints` devolve `unknown` — não `identical` — quando não há
hash dos dois lados. Dois PDFs do mesmo tamanho podem ter conteúdo diferente,
e afirmar igualdade ali esconderia exatamente a retificação que se quer
pegar.

## Chave de questão

```
provider-edicao-fase[-variante][-idioma]-numero

ime-2025-2026-objective-17
fuvest-2026-first-v1-34
ita-2026-first-3
```

Feita só de identidade estrutural. **Nunca do texto do enunciado**: um
enunciado reextraído com um espaço a mais viraria outra questão, e o aluno
perderia o histórico dela.

A variante só entra quando existe. Colocar `v1` em prova sem versões criaria
chave diferente para a mesma questão a cada mudança de modelagem.

Quando a banca aplica versões que são só reordenação, `officialId` resolve a
identidade. Sem ele, `sameQuestion` responde `false` — é a resposta honesta:
sem identificador da banca não dá para afirmar sem comparar conteúdo, e
conteúdo não é identidade.

## Duas taxonomias

```
providerSubject: "physics"                      (o que a banca diz)
universalTopic:  "physics.electricity.circuits" (o que o assunto é)
```

Nenhuma substitui a outra. O mapa de domínio continua por provider; o treino
por conteúdo usa a universal.

A raiz universal (`physics`) **não é atribuível** — só ramos com dois ou mais
níveis. Dois motivos que se reforçam: marcar uma questão como "física" não
diz nada que a matéria do provider já não diga; e as raízes colidem com o
vocabulário de algumas bancas (o ITA chama sua matéria de `physics`), o que
tornaria um id solto ambíguo entre as duas taxonomias.

Classificação com confiança baixa vira `UNCLASSIFIED`. Questão marcada errado
como "circuitos" polui o treino de quem confiou nele.

## Direitos

`rightsStatus`: `allowed` · `official-reference` · `permission-required` ·
`unknown`.

**É metadata operacional, não parecer jurídico.**

"Disponível na internet" não significa "liberado para republicação", e
"oficial" também não. Na dúvida: `permission-required` e modo referência,
com o app levando ao documento da instituição.

Nunca usar como origem de conteúdo: QConcursos, Estratégia, Estuda, Teachy,
Kuadro e semelhantes. Podem servir para descoberta manual; nunca como fonte
de redistribuição. Nunca contornar login, paywall ou proteção.

## Catálogo

Índice **leve**: uma linha por edição, não por questão. Quantas questões
existem, de que matéria, com que validação.

O motivo: o Banco carregava a edição inteira só para montar um filtro. Com
uma prova passa; com dezenas, montar um dropdown viraria dezenas de
megabytes.

`questionCount` é `number | null`. `null` quando só se sabe carregando a
prova — zero seria a mesma mentira que o app já proíbe nos indicadores.
`countQuestions` devolve `{ known, unknownEditions }`: "456 questões" e "456
mais trinta edições que não sabemos medir" são frases diferentes.

`estimateSizeBytes` existe para a decisão de paginar ter base em medição.

## CLI

```bash
npm run ingest -- ime --year 2025-2026
npm run ingest -- all --dry-run
npm run ingest -- ime --validate
npm run ingest:vestibular -- all
npm run sources:audit
npm run sources:audit -- --provider ita
```

`--dry-run` **nunca** escreve catálogo. Um comando que escreve depois de
dizer que não escreveria é pior que um comando que não existe.

A ingestão de vestibulares em modo referência (`ingest:vestibular`) é separada
da CLI genérica porque cada banca aceita tem adapter próprio e regras
fail-closed próprias. Ela gera apenas gabarito, metadados de prova, variantes e
proveniência; não copia enunciado para o bundle.

A escrita é idempotente: deduplica por `provider|edição|fase` e ordena de
forma estável. Rodar duas vezes dá o mesmo arquivo — sem isso cada execução
vira um diff e ninguém consegue revisar o que de fato mudou.

O audit **usa rede** e por isso não roda no `npm test`. Teste unitário que
depende do servidor de outra pessoa falha quando o problema não é do nosso
código, e vermelho que não é culpa nossa ensina a ignorar o vermelho.

Um 404 previsto (o Português da 2ª fase do ITA antes de 2025) é tratado como
conhecimento, não falha. O que deve assustar é ele **deixar** de dar 404:
significa edição nova por ingerir.

## Adicionar uma prova

1. Confirmar a fonte oficial e o `rightsStatus`.
2. **Medir o documento antes de escrever parser.** PDF digitalizado →
   `reference-only`; não escrever OCR em lote por padrão.
3. Escrever a descoberta com allowlist: descobrir automaticamente, mas
   recusar o inesperado.
4. Escrever o importador e produzir `RawImportedExam`.
5. Rodar `validateEdition` e ler o relatório inteiro.
6. **Conferir à mão pelo menos três edições** — uma recente, uma
   intermediária, uma antiga: contagem, numeração, matérias, gabarito,
   anuladas.
7. Só então passar `nivelConferido` em `acceptEdition`.
8. Registrar a fonte no audit e testes de isolamento contra as provas já
   existentes.

## Quando um PDF com texto não serve

O critério para decidir entre catálogo estruturado e modo referência **não é**
"o PDF tem camada de texto". É se o texto **preserva o significado**.

Os dois casos já vividos:

| Prova | Camada de texto | Decisão | Por quê |
|---|---|---|---|
| ITA | nenhuma (0 caractere) | referência | não há o que extrair |
| IME | sim (23 mil caracteres) | referência | a extração quebra a matemática |

No IME, 67 frações da edição 2025-2026 saem quebradas em três linhas e os
expoentes viram dígitos comuns. A questão 20 extrai como

```
y = x2
2b − b
2
```

quando a fórmula é y = x²/(2b) − b/2. Reproduzir isso mostraria ao aluno uma
equação diferente da que caiu na prova.

**Meça antes de decidir**, e olhe o texto extraído — não só a contagem de
caracteres.

## Variantes de prova

Uma banca pode aplicar a mesma prova em versões com as questões em ordem
diferente. Ignorar isso produz dois estragos ao mesmo tempo: a mesma questão
vira N no banco, e **o gabarito de uma versão corrige outra**.

A relação é declarada, nunca inferida:

| Relação | Ingere | Por quê |
|---|---|---|
| `reordered` | só a canônica | as questões são as mesmas |
| `distinct` | todas | é conteúdo diferente |
| `unknown` | só uma | duplicar o banco é pior que deixar conteúdo de fora |

A variante só entra na chave da questão quando é conteúdo diferente.

**Leia os nomes das versões do documento.** A FUVEST usou V1..V4 em 2025 e
V, K, Q, X, Z em 2024 — parser com a lista fixa recusaria o segundo ano, ou
pior, atribuiria a resposta à versão errada.

## Estado (v8.10)

| Prova | Edições | Questões | Nível | Enunciado | Fonte |
|---|---|---|---|---|---|
| ITA | 8 (1ª fase) | 456 | `reviewed` | referência | `ita-official-archive` |
| IME | 8 (objetiva) | 320 | `reviewed` | referência | `ime-cfg-archive` |
| FUVEST | 22 (1ª fase) | 2.000 | `reviewed` | referência | `fuvest-archive` |
| AFA | 8 (1ª fase) | 512 | `reviewed` | referência | `afa-official-archive` |
| EPCAR | 3 (1ª fase) | 144 | `reviewed` | referência | `epcar-official-archive` |
| UNICAMP | 3 (1ª fase) | 216 | `reviewed` | referência | `unicamp-comvest-archive` |
| UEL | 1 (1º dia Inglês) | 60 | `reviewed` | referência | `uel-cops-archive` |
| PUC-SP | 3 (verão) | 150 | `reviewed` | referência | `puc-sp-nucvest-archive` |
| UDESC | 18 (manhã e tarde) | 1.800 | `reviewed` | referência | `udesc-official-archive` |
| ACAFE | 9 (semestres) | 567 | `reviewed` | referência | `acafe-official-archive` |
| ENEM | 30 (dia 1 e 2) | — | `reviewed` | no app | `enem-dev` |

O IME tem 40 questões por edição nas oito — 15 matemática, 15 física, 10
química. Conferido à mão em 2025-2026, 2021-2022 e 2018-2019.

A FUVEST tem 100 questões em 2005–2006 e 90 de 2007 em diante. O importador
`fuvest-answer-key@1.1.0` aceita as 22 edições contínuas de 2005–2026, em três
layouts oficiais diferentes, totalizando 2.000 referências. As páginas de
2001–2004 permanecem bloqueadas porque o acervo atual não associa um documento
inequívoco de gabarito da 1ª fase. Recusar é o comportamento correto — meia
leitura corrige errado.

### FAB

AFA e EPCAR usam importador compartilhado apenas na normalização comum: cada
provider tem identidade, catálogo, histórico e chaves próprias. A versão A é
canônica; B e C ficam como referência por serem reordenações. O script
`npm run ingest:fab -- --dry-run` revalida os JSON gerados sem rede e recusa
sequência incompleta, letra inválida, anulação inconsistente, matéria com
buraco ou gabarito que não seja final.

As provas oficiais da FAB retornam 403 ao audit HTTP automatizado neste
ambiente. Isso não é tratado como aprovação: a página e as chaves seguem
monitoradas, mas o bloqueio é uma pendência operacional da próxima execução do
audit.

### v8.8 — vestibulares em massa

UNICAMP, UEL e PUC-SP entram com adapters específicos sobre utilitários comuns
de modo referência. O fluxo é:

1. Confirmar página oficial de arquivo ou divulgação.
2. Baixar o gabarito final/retificado.
3. Extrair apenas número, resposta e anuladas.
4. Rejeitar duplicidade, buraco, letra inválida, preliminar ou cobertura
   parcial.
5. Gravar checksum, tamanho, data, parser, revisão, variantes e evidências.

As três ficam `reference-only` e `official-reference`: o app corrige pela chave
oficial, mas o enunciado continua no domínio da banca. UNICAMP e UEL possuem
variantes conhecidas com relação `unknown`; só a variante canônica é
executável. PUC-SP verão entra como prova única, separada de PUC-PR e PUC-Rio.

Relatório completo: [v8.8 Vestibular Mass Injection](vestibular-mass-validation.md).

### v8.9 — UDESC em volume

O adapter UDESC consome a página oficial de provas anteriores e uma lista
manual de URLs de PDF encontradas nela, revalidada automaticamente a cada
ingestão. Não monta nomes de arquivo por padrão. O
gabarito final é dividido em manhã e tarde apenas quando o parser encontra duas
sequências completas 1..50 e o bloco duplicado 29..36 corresponde aos dois
idiomas publicados.

As 18 edições usam identificadores semestrais (`2026.1`, `2026.2` etc.), pois o
ano sozinho não é suficiente. `Attempt` e `QuestionRef` preservam edição,
sessão e chave exata para impedir colisões entre manhã/tarde e entre semestres.
O Banco soma as duas sessões no seletor da edição, enquanto catálogo e provider
continuam lazy por edição.

O modo permanece `reference-only`/`official-reference`: prova e gabarito ficam
no domínio oficial, e o bundle contém apenas chave, correção e metadados. Veja o
[relatório de expansão UDESC](vestibular-volume-validation.md).

### v8.9 — ACAFE

O adapter ACAFE usa páginas oficiais específicas por edição e preserva as URLs
exatas de prova e gabarito encontradas nelas. As nove edições aceitas cobrem
2022.2 e os dois semestres de 2023 a 2026, com 63 questões objetivas cada.
Inglês é canônico; Espanhol é armazenado como variante `distinct`.

O parser recusa preliminar mesmo quando o rótulo da página externa diz
“oficial”. Isso excluiu 2022.1, cujo PDF contradiz o índice. Respostas `X` são
registradas como anuladas, e edição só entra com cobertura exata 1..63.

### Fontes registradas e não ingeridas

`inep-official-archive` cobre 1998–2025 e é o **único** caminho para 2024 e
2025 — a API estruturada para em 2023, verificado. Está registrada com
`years: []` porque declarar 1998–2025 faria o app prometer prova que não tem.

Duas coisas precisam existir antes de importá-la:

1. **Variante de caderno.** O ENEM aplica Azul, Amarelo, Branco e Rosa por
   dia — a mesma prova em ordem diferente. São 95 documentos só em 2025.
   Importar sem modelar variante criaria quatro cópias de cada questão, e o
   gabarito de um caderno corrigiria outro.
2. **Descoberta.** A página do INEP monta a lista por JavaScript; o HTML
   servido tem zero link de PDF. As URLs seguem
   `{ano}_{PV|GB}_impresso_D{dia}_CD{caderno}.pdf` — conferido em 2023, 2024
   e 2025 —, mas §14 pede verificar existência, não inferir padrão.

Este é também o caso que prova o suporte a **múltiplas fontes por provider**:
o ENEM tem duas, e a regra é não trocar fonte boa por PDF pior — a
estruturada segue sendo a origem de 2009–2023.
