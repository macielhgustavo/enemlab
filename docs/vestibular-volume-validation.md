# v8.9 — Vestibular Volume Expansion

Data da validação: 2026-09-09.

Esta wave dá continuidade à Mass Injection com um recorte de alto volume e
baixo risco: o arquivo público oficial da UDESC. Nenhum enunciado foi copiado
para o bundle; o app mantém a prova no domínio institucional e usa o gabarito
final apenas para correção em modo referência.

## Resultado

| Provider | Edições descobertas | Aceitas | Blocked | Sessões | Questões | Content mode | Validation level | Fonte | Rights |
|---|---:|---:|---:|---:|---:|---|---|---|---|
| UDESC | 18 | 18 | 0 | 36 | 1.800 | `reference-only` | `reviewed` | UDESC/COVEST | `official-reference` |

Edições aceitas: 2015.1, 2015.2, 2016.1, 2016.2, 2017.1, 2017.2,
2018.1, 2018.2, 2019.1, 2019.2, 2020.1, 2023.2, 2024.1, 2024.2,
2025.1, 2025.2, 2026.1 e 2026.2.

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

## Fail-closed

O importer recusa a edição se não encontrar exatamente duas sessões completas,
se houver questão faltante/duplicada fora do bloco de idiomas, se a revisão não
for final, se uma resposta não for A–E ou se prova e gabarito não estiverem
associados pela página oficial. URLs não são inferidas por nome de arquivo.

As 36 entradas do catálogo são leves e só carregam o payload da edição
selecionada. `Attempt`, `Result`, SRS, histórico e reconstrução usam
`providerId`, `editionId`, sessão e chave exata, evitando colisões entre os dois
semestres do mesmo ano e as duas sessões da mesma edição.

## Direitos

`rightsStatus` é `official-reference`. O ENEM Lab não republica os PDFs nem o
texto das questões; abre os documentos no site oficial da UDESC. A existência
pública do arquivo não é tratada como licença de redistribuição.

## Validação final

- `npm run ingest:vestibular -- udesc`: 18 edições e 36 sessões regeneradas a partir dos gabaritos oficiais.
- `npm test`: 378 testes Vitest e 30 testes Python passaram.
- `npm run lint`: passou.
- `npm run build`: passou com TypeScript e 14 rotas geradas.
- `npm run sources:audit`: 139 documentos, 0 problemas. Uma primeira execução teve falha transitória de rede na página EEAR; a repetição leu a mesma URL com HTTP 200, sem alteração de regra ou exceção.
- `npm run test:e2e:ci`: 80 testes Playwright passaram em desktop e mobile.
