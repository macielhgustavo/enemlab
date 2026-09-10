# Vestibular Volume Wave 3 — PUC-Rio

Coleta das fontes: 2026-09-09. Validação final: 2026-09-10.

Esta wave reabriu a pesquisa da PUC-Rio depois da localização do repositório
oficial de provas e gabaritos. O objetivo foi ganhar volume sem copiar
enunciados para o bundle e sem completar lacunas por padrão.

## Resultado

| Provider | Edições investigadas | Aceitas | Blocked | Questões | Content mode | Validation level | Fonte | Rights |
|---|---:|---:|---:|---:|---|---|---|---|
| PUC-Rio | 12 | 9 | 3 | 330 | `reference-only` | `reviewed` | Repositório oficial PUC-Rio | `official-reference` |

O provider cobre somente o **2º dia, Grupo 1**. PUC-Rio permanece isolada de
PUC-SP e PUC-PR em provider, chaves, tentativas, histórico, SRS e domínio.

## Edições aceitas

| Edição | Questões | Anuladas | Revisão | Extração do gabarito | Variante |
|---|---:|---|---|---|---|
| 2026 | 45 | — | `final` | destaque amarelo por geometria | Grupo 1, `unknown` |
| 2025 | 45 | 8 | `final` | destaque amarelo por geometria | Grupo 1, `unknown` |
| 2024 | 45 | — | `final` | destaque amarelo por geometria | Grupo 1, `unknown` |
| 2020 | 45 | 19, 36 | `rectified` | respostas comentadas em texto | Grupo 1, `unknown` |
| 2019 | 45 | — | `final` | respostas comentadas em texto | Grupo 1, `unknown` |
| 2018 | 45 | — | `rectified` | respostas comentadas em texto | Grupo 1, `unknown` |
| 2017 | 20 | — | `final` | respostas comentadas em texto | Grupo 1, `unknown` |
| 2016 | 20 | — | `rectified` | respostas comentadas em texto | Grupo 1, `unknown` |
| 2015 | 20 | — | `final` | respostas comentadas em texto | Grupo 1, `unknown` |

O parser atual é `puc-rio-answer-key@1.0.0`. Cada entrada registra URL original
e efetiva, data de coleta, SHA-256, tamanho, revisão, contagem, anuladas,
variante, `validationLevel` e evidência legível.

## Edições bloqueadas

| Edição | Estado | Motivo |
|---|---|---|
| 2023 | `blocked` | O gabarito usa destaque visual, mas o layout não produziu 45 associações inequívocas; o parser fechou com apenas 12 respostas. |
| 2022 | `blocked` | A página lista gabaritos, mas não associa um caderno limpo inequívoco do Grupo 1; há link com nome de arquivo de 2020. |
| 2021 | `blocked` | O pacote é apresentado como gabarito e reutiliza link de caderno de 2020; não há prova limpa segura para execução. |

O 1º dia e os demais grupos foram descobertos, mas não entram nesta entrega.
As línguas e relações entre grupos não foram canonicalizadas porque a
equivalência não foi demonstrada.

## Evidência e direitos

- Fonte: [repositório oficial de provas da PUC-Rio](https://www.puc-rio.br/vestibular/repositorio/).
- A página anual precisa listar diretamente o caderno e o gabarito aceitos.
- O PDF precisa ter assinatura válida, camada legível e numeração completa.
- Preliminar ou provisório é recusado; retificação é preservada na edição.
- O bundle contém somente respostas factuais, metadados e URLs.
- Os PDFs continuam no domínio da instituição: `rightsStatus` é
  `official-reference`, não autorização de republicação.

## Validação

```sh
npm run ingest:vestibular -- puc-rio
npm test
npm run lint
npm run build
npm run sources:audit -- --provider puc-rio
npm run test:e2e:ci
```

Testes unitários não usam rede. A rede aparece somente na ingestão explícita e
no audit de fontes.

Resultados finais:

- `npm test`: 390 testes Vitest e 42 testes Python aprovados.
- `npm run lint`: aprovado sem erros.
- `npm run build`: build de produção aprovado com Next.js 16.3.4.
- `npm run sources:audit`: 279 documentos auditados, sem problemas.
- `npm run test:e2e:ci`: 102 cenários aprovados em desktop e mobile, incluindo seleção, carregamento e início de prova PUC-Rio.
- Snapshots visuais não foram atualizados nesta wave.
