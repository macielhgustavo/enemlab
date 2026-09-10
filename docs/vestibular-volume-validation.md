# v8.9 — Vestibular Volume Expansion

Data da validação: 2026-09-09.

Esta wave dá continuidade à Mass Injection com arquivos públicos oficiais da
UDESC e da ACAFE. Nenhum enunciado foi copiado para o bundle; o app mantém as
provas nos domínios institucionais e usa os gabaritos finais apenas para
correção em modo referência.

## Resultado

| Provider | Edições descobertas | Aceitas | Blocked | Sessões | Questões | Content mode | Validation level | Fonte | Rights |
|---|---:|---:|---:|---:|---:|---|---|---|---|
| UDESC | 18 | 18 | 0 | 36 | 1.800 | `reference-only` | `reviewed` | UDESC/COVEST | `official-reference` |
| ACAFE | 10 | 9 | 1 | 9 | 567 | `reference-only` | `reviewed` | Sistema ACAFE | `official-reference` |

Edições aceitas: 2015.1, 2015.2, 2016.1, 2016.2, 2017.1, 2017.2,
2018.1, 2018.2, 2019.1, 2019.2, 2020.1, 2023.2, 2024.1, 2024.2,
2025.1, 2025.2, 2026.1 e 2026.2.

ACAFE aceita: 2022.2, 2023.1, 2023.2, 2024.1, 2024.2, 2025.1, 2025.2,
2026.1 e 2026.2. A edição 2022.1 está bloqueada porque o PDF apresentado no
índice como oficial declara internamente “Gabarito preliminar”.

## Evidência e modelagem

- Descoberta: [arquivo oficial de provas anteriores da UDESC](https://www.udesc.br/vestibular/provasanteriores).
- Documentos: prova matutina, prova vespertina e gabarito final de cada edição, com URLs registradas explicitamente pelo importer.
- Cobertura: 50 questões pela manhã e 50 à tarde em cada edição.
- Total: 1.800 questões/referências, incluindo 50 anuladas sem alternativa correta.
- Fases: `morning` e `afternoon`; edição semestral faz parte da chave determinística.
- Idiomas: Inglês é a variante canônica do bloco 29..36 da manhã; Espanhol é validado e preservado com seu gabarito como variante `distinct`, sem execução nem canonicalização presumida.
- Matérias: faixas vêm da estrutura publicada da prova; a mudança de 2026 que inclui Filosofia e Sociologia é modelada explicitamente.
- Parser: `udesc-answer-key@1.0.0`.
- Source registry: `udesc-official-archive`, lista manual verificada automaticamente contra a página oficial, `pdf-text-layer`.
- Proveniência por entrada: `originalUrl`, `effectiveSourceUrl`, `fetchedAt`, SHA-256, tamanho, parser, revisão final, questões esperadas/lidas, anuladas, variantes e evidência de validação.

### ACAFE

- Cobertura: 63 questões por edição, 567 no total e 22 anuladas.
- Matérias: Português 1..10, Literatura 11..14, língua estrangeira 15..21, Matemática 22..28, Física 29..35, Química 36..42, Biologia 43..49, História 50..56 e Geografia 57..63.
- Variantes: Inglês canônico e Espanhol `distinct`, ambos com gabarito completo preservado.
- Parser: `acafe-answer-key@1.0.0`; aceita A–E e `X` apenas como anulação.
- Descoberta: lista manual de links exatos, revalidada contra a página oficial de cada edição.
- Recusa: 2022.1 permanece fora do provider por conflito entre rótulo da página e conteúdo preliminar do PDF.

## Fail-closed

O importer da UDESC recusa a edição se não encontrar exatamente duas sessões
completas. O da ACAFE exige 63 questões e a duplicação exata do bloco 15..21 de
idiomas. Ambos falham se houver questão faltante ou duplicada fora da estrutura
documentada, se a revisão não for final, se uma resposta não for A–E/`X` ou se
prova e gabarito não estiverem associados pela página oficial. URLs não são
inferidas por nome de arquivo.

As 45 entradas do catálogo são leves e só carregam o payload da edição
selecionada. `Attempt`, `Result`, SRS, histórico e reconstrução usam
`providerId`, `editionId`, sessão e chave exata, evitando colisões entre os dois
semestres do mesmo ano e, na UDESC, entre as duas sessões da mesma edição.

## Direitos

`rightsStatus` é `official-reference`. O ENEM Lab não republica os PDFs nem o
texto das questões; abre os documentos nos sites oficiais da UDESC e da ACAFE.
A existência pública dos arquivos não é tratada como licença de redistribuição.

## Validação final

- `npm run ingest:vestibular -- udesc`: 18 edições e 36 sessões regeneradas a partir dos gabaritos oficiais.
- `npm run ingest:vestibular -- acafe`: 9 edições e 567 referências regeneradas a partir dos gabaritos oficiais.
- Idempotência: os manifests da UDESC e da ACAFE mantêm o mesmo SHA-256 após regeneração.
- `npm test`: 384 testes Vitest e 32 testes Python passaram.
- `npm run lint`: passou.
- `npm run build`: passou com TypeScript e 14 rotas geradas.
- `npm run sources:audit`: 166 documentos, 0 problemas; os 27 documentos adicionados da ACAFE responderam HTTP 200.
- `npm run test:e2e:ci`: 80 testes Playwright passaram em desktop e mobile.
