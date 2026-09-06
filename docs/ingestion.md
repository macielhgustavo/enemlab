# Plataforma de ingestão

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
npm run sources:audit
npm run sources:audit -- --provider ita
```

`--dry-run` **nunca** escreve catálogo. Um comando que escreve depois de
dizer que não escreveria é pior que um comando que não existe.

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

## Estado (v8.5.0)

Esta versão entrega a **plataforma**. Nenhum provider novo entrou.

`IMPORTADORES` na CLI está vazio de propósito: cada prova entra na sua PR
depois de conferida. Uma CLI que aceita qualquer nome e não faz nada é pior
que uma que recusa.

| Prova | Edições | Questões | Nível | Enunciado |
|---|---|---|---|---|
| ITA | 8 (1ª fase) | 456 | `reviewed` | referência |
| ENEM | 30 (dia 1 e 2) | — | `reviewed` | no app |

`reviewed` e não `verified`: as duas foram conferidas contra a fonte nas
versões anteriores, mas não passaram pelo pipeline determinístico que esta
versão acabou de criar. Chamá-las de `verified` daria ao pipeline um crédito
que ele ainda não recebeu.
