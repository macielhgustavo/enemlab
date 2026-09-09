# v8.10 — Vestibular Volume Wave 2

Data da validação: 2026-09-09.

## Resultado

| Provider | Descobertas | Aceitas | Bloqueadas | Questões | Content mode | Validation | Fonte | Rights |
|---|---:|---:|---:|---:|---|---|---|---|
| FUVEST | 26 | 22 | 4 | 2.000 | `reference-only` | `reviewed` | acervo oficial FUVEST | `official-reference` |

## Cobertura aceita

- 2005–2006: 100 questões objetivas por edição.
- 2007–2026: 90 questões objetivas por edição.
- 2.000 referências canônicas no total.
- 4 questões anuladas preservadas: 2014/51, 2016/43, 2022/54 e 2026/3.
- 2026 usa o gabarito retificado; as demais edições registram a revisão publicada no documento escolhido.

## Variantes

Os documentos oficiais demonstram correspondência entre versões reordenadas.
O catálogo executa somente a versão canônica e registra as demais como
`reordered`, sem multiplicar tentativas, domínio ou histórico no SRS. O parser
lê os códigos do próprio documento, incluindo V/K/Q/X/Z e V1/V2/V3/V4.

## Evidência

Cada edição aceita registra URL original e efetiva, página de arquivo,
data de coleta, SHA-256, tamanho, versão do parser, revisão, contagem esperada e
extraída, anuladas, variantes, nível de validação e evidências usadas. O parser
`fuvest-answer-key@1.1.0` reconhece tabelas diretas, tabelas fragmentadas pela
camada de texto do PDF e tabelas oficiais de correspondência, sempre com
falha fechada para lacunas, duplicatas ou respostas inválidas.

## Bloqueios

As páginas oficiais de 2001–2004 foram descobertas, mas não apresentam uma
associação inequívoca entre a primeira fase objetiva e um gabarito próprio no
acervo atual. Elas permanecem bloqueadas e não entram no runner.

## Direitos

Os enunciados continuam nos PDFs da FUVEST. O aplicativo distribui somente
metadados, referências e respostas factuais, sem reempacotar o texto das
questões. Fontes secundárias podem apoiar descoberta futura, mas não substituem
a evidência necessária para marcar uma edição como revisada.

## Runner

O seletor global de prova agora controla diretamente a tela Treinar. Ao
selecionar ITA, IME, FUVEST, AFA, EPCAR, UNICAMP, UEL, PUC-SP, UDESC ou ACAFE,
a tela abre a edição correspondente em modo referência, carrega o documento da
banca e permite marcar e corrigir as alternativas. O fluxo é coberto por E2E
para todos os providers, incluindo provas com quatro e cinco alternativas.

## Validação final

- `npm test`: 385 testes TypeScript e 38 testes Python aprovados.
- `npm run lint`: aprovado.
- `npm run build`: build de produção aprovado no Next.js 16.3.4.
- `npm run sources:audit`: 252 documentos verificados, sem problemas.
- `npm run test:e2e:ci`: 100 fluxos desktop/mobile aprovados.
