# v8.8 — Vestibular Mass Injection

Data da validação: 2026-09-08.

Esta wave investigou vestibulares brasileiros para ampliar o catálogo sem
forçar edições ambíguas. A regra de corte foi simples: quando prova, gabarito,
revisão, variantes, anuladas ou direitos não ficaram claros, a edição ficou
bloqueada ou apenas registrada como pesquisa.

## Resultado

| Provider | Edições descobertas | Aceitas | Blocked | Questões | Content mode | Validation level | Fonte | Rights |
|---|---:|---:|---:|---:|---|---|---|---|
| UNICAMP | 3 | 3 | 0 | 216 | `reference-only` | `reviewed` | COMVEST | `official-reference` |
| UEL | 2 | 1 | 1 | 60 | `reference-only` | `reviewed` | COPS/UEL | `official-reference` |
| PUC-SP | 5 | 3 | 2 | 150 | `reference-only` | `reviewed` | NucVest | `official-reference` |
| UEM | 1 | 0 | 1 | 0 | `reference-only` | `blocked` | CVU/UEM | `permission-required` |
| UEPG | 1 | 0 | 1 | 0 | `reference-only` | `blocked` | CPS/UEPG | `permission-required` |
| UNESP | 4 | 0 | 4 | 0 | `reference-only` | `blocked` | Vunesp | `permission-required` |
| UFSC | 1 | 0 | 1 | 0 | `reference-only` | `blocked` | Coperve/UFSC | `permission-required` |
| UDESC | 2 | 0 | 2 | 0 | `reference-only` | `blocked` | UDESC | `permission-required` |
| ACAFE | 1 | 0 | 1 | 0 | `reference-only` | `blocked` | ACAFE | `permission-required` |
| PUC-PR | 1 | 0 | 1 | 0 | `reference-only` | `blocked` | PUC-PR | `permission-required` |
| PUC-Rio | 1 | 0 | 1 | 0 | `reference-only` | `blocked` | PUC-Rio | `permission-required` |
| Mackenzie | 1 | 0 | 1 | 0 | `reference-only` | `blocked` | Mackenzie | `permission-required` |
| UFRJ histórica | 1 | 0 | 1 | 0 | `reference-only` | `blocked` | UFRJ | `permission-required` |

Total aceito: 7 edições e 426 questões objetivas em modo referência.

## Providers entregues

### UNICAMP

- Edições aceitas: 2024, 2025 e 2026, todas da 1ª fase.
- Questões: 72 por edição, 216 no total.
- Anuladas: 2025 questão 53.
- Variantes: pares oficiais por edição; relação `unknown`, com uma variante canônica por ano.
- Parser: `unicamp-answer-key@1.0.0`.
- Evidência: páginas oficiais da COMVEST listam prova e gabarito; o parser confere cobertura 1..72 e revisão final.

### UEL

- Edição aceita: 2026, 1º dia, Inglês, Tipo 1.
- Questões: 60.
- Anuladas: questão 41.
- Variantes: Tipos 1, 2 e 3 registrados como `unknown`; só Tipo 1 Inglês entra no runner.
- Blocked: Espanhol/variações não entram nesta wave por falta de modelagem completa de idioma e variante.
- Parser: `uel-answer-key@1.0.0`.
- Evidência: endpoint oficial COPS/UEL de divulgação definitiva; preliminar é recusado explicitamente.

### PUC-SP

- Edições aceitas: Verão 2024, Verão 2025 e Verão 2026.
- Questões: 50 por edição, 150 no total.
- Anuladas: 2024 questão 1; 2025 questão 12.
- Retificação: 2025 usa gabarito republicado, registrado como `rectified`.
- Variantes: prova única registrada como `unknown`.
- Parser: `puc-sp-answer-key@1.0.0`.
- Evidência: NucVest lista caderno e gabarito; PUC-SP é provider próprio, separado de PUC-PR e PUC-Rio.

## Providers recusados ou bloqueados

- UEM: fonte oficial encontrada, mas o gabarito usa somatório/número; runner A–E não se aplica.
- UEPG: gabarito após recursos encontrado, mas também usa somatório; bloqueado por modelo de questão.
- UNESP/Vunesp: páginas oficiais localizadas; provas/gabaritos exigem Área do Candidato ou bloqueiam acesso automatizado.
- UFSC: fonte oficial definitiva encontrada, mas itens por proposição/somatório exigem modelo próprio.
- UDESC: provas/gabaritos públicos encontrados, porém há dias, períodos e idiomas com numeração sobreposta.
- ACAFE: portal público identificado, mas endpoints de prova/gabarito precisam de fechamento sem inferência.
- PUC-PR: não houve arquivo público consistente com associação prova ↔ gabarito final.
- PUC-Rio: não houve fonte pública objetiva com prova e gabarito final associáveis.
- Mackenzie: não houve arquivo oficial histórico suficiente para ingestão.
- UFRJ histórica: precisa de wave própria; não foi criado provider atual sem prova objetiva vigente.
- UFPR: permanece pesquisa já registrada; associação final prova ↔ versão ↔ gabarito ainda não está fechada.

## Controles técnicos

- As novas questões usam chaves com `providerId`, edição, fase, idioma e número.
- `Attempt`, `QuestionRef`, histórico, SRS e reconstrução de revisão preservam `providerId`.
- O catálogo leve mostra provider, edição, fase, quantidade, `validationLevel` e `contentMode` sem carregar todos os payloads.
- Banco e Treinar carregam questões por provider/edição sob demanda.
- O modo referência não coloca enunciados no bundle; usa links oficiais externos.

## Reprodução

```sh
npm run ingest:vestibular -- all
npm test
npm run lint
npm run build
npm run sources:audit
npm run test:e2e
```

O audit usa rede e deve reportar falhas externas sem maquiagem.

## Validação final

- `npm run ingest:vestibular -- all`: 3 edições UNICAMP, 1 UEL e 3 PUC-SP regeneradas.
- `npm test`: 370 testes Vitest e 27 testes Python passaram.
- `npm run lint`: passou.
- `npm run build`: passou.
- `npm run sources:audit`: 94 documentos, 0 problemas.
- `npm run test:e2e:ci`: 80 testes Playwright passaram.
