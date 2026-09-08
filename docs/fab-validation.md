# Validação documental FAB — PR #14

## Estado preservado

Workspace: `C:\Users\onome\OneDrive\Área de Trabalho\ENEM_Lab_v6_BETA_FINAL_PWA\web`.
Branch local encontrada: `fix/fab-real-ingestion`, HEAD inicial `33661b8`, acompanhando `origin/feat/v8-5-3-fab-exams`.
Havia 12 arquivos modificados e nenhum arquivo staged ou novo não ignorado. A cópia dentro da pasta desta tarefa estava limpa e foi deixada intacta.

Arquivos já modificados: `scripts/ingest-fab.py`, `scripts/sources-audit.mjs`, `src/lib/catalog/current.test.ts`, `src/lib/providers/afa/afa.test.ts`, `src/lib/providers/afa/answer-keys.generated.json`, `src/lib/providers/epcar/answer-keys.generated.json`, `src/lib/providers/epcar/epcar.test.ts`, `src/lib/providers/fab/index.ts`, `src/lib/providers/fab/parser.test.ts`, `src/lib/sources/index.ts`, `src/lib/sources/sources.test.ts`, `src/lib/sources/types.ts`.

Todos foram preservados no commit de backup `37c9c43` e enviados à branch da PR antes das correções seguintes. Não houve reset, clean, rebase, troca destrutiva de branch ou merge.
A base local passou em 336 testes. As duas novas criações mencionadas no relato anterior não apareceram como arquivos novos neste workspace; não foram inventadas nem descartadas.

## Evidência e escopo

Os 16 snapshots abaixo foram efetivamente baixados novamente. Cada PDF foi validado por assinatura PDF/EOF, tamanho e SHA-256, extraído com pypdf 6.17.0 e comparado por `fab-answer-key@2.1.0` contra o dataset local produzido pelo `2.0.0`.
Todos confirmaram edição, gabarito oficial final, 64 (AFA) ou 48 (EPCAR) respostas por versão A/B/C, anuladas e ordem das matérias. Datas individuais, hashes completos, tipo `archived-official`, revisão e assinatura do dataset estão em [evidence.generated.json](../src/lib/providers/fab/evidence.generated.json).

- AFA: 8 edições ingeridas e reconferidas, 8 reviewed, 0 provisional, 0 blocked entre as ingeridas; 512 questões A, 20 anuladas, 492 não anuladas.
- EPCAR: 8 edições ingeridas e reconferidas, 8 reviewed, 0 provisional, 0 blocked entre as ingeridas; 384 questões A, 11 anuladas, 373 não anuladas.
- Não somar B/C ao banco: são versões de referência, não 1.792 questões adicionais.
- Reviewed é revisão **do gabarito**, não aprovação integral dos cadernos. A correlação por conteúdo entre as versões A/B/C não foi comprovada. Letras distintas são uma verificação estrutural, não prova de reordenação.
- A ordem das matérias foi lida do cabeçalho. Os intervalos em blocos de 16 são inferidos. Os flags herdados de conferência AFA 2023–2025 foram preservados, mas o trabalho anterior não registrou URL/hash dos cadernos usados. Não tratamos esses flags como nova comprovação. As demais edições declaram explicitamente ausência de conferência dos limites.
- Não foram ingeridos enunciados ou PDFs para distribuição. As URLs de prova no dataset continuam nulas; o link de referência pode abrir o gabarito. Essa limitação permanece e impede anunciar um fluxo completo de leitura da prova.

## Por edição

Em todas as linhas: revisão `final`, três versões completas, canônica A, sourceType `archived-official`. As anuladas são números próprios de cada versão e não uma permutação demonstrada.

| Edição | Total A | Anuladas A / B / C | Ordem das matérias | Limites de matérias | Original / bytes efetivamente lidos |
|---|---:|---|---|---|---|
| AFA 2018 | 64 | 14, 29, 60, 64 / 28, 32, 46, 61 / 12, 16, 30, 45 | Português → Matemática → Inglês → Física | não verificados | [FAB](https://www.fab.mil.br/ingresso/arquivos/provas/afa2018_gab_oficial.pdf) / [snapshot](https://web.archive.org/web/20250110164756id_/https://www.fab.mil.br/ingresso/arquivos/provas/afa2018_gab_oficial.pdf) |
| AFA 2019 | 64 | 42, 55 / 10, 23 / 26, 39 | Português → Matemática → Inglês → Física | não verificados | [FAB](https://www.fab.mil.br/ingresso/arquivos/provas/afa2019_gab_oficial.pdf) / [snapshot](https://web.archive.org/web/20250420074908id_/https://www.fab.mil.br/ingresso/arquivos/provas/afa2019_gab_oficial.pdf) |
| AFA 2020 | 64 | 40, 51, 56 / 8, 19, 24 / 24, 35, 40 | Português → Matemática → Inglês → Física | não verificados | [FAB](https://www.fab.mil.br/ingresso/arquivos/provas/afa2020_gabarito_oficial.pdf) / [snapshot](https://web.archive.org/web/20250110171627id_/https://www.fab.mil.br/ingresso/arquivos/provas/afa2020_gabarito_oficial.pdf) |
| AFA 2021 | 64 | 2, 36, 37 / 18, 52, 53 / 4, 5, 34 | Inglês → Física → Português → Matemática | não verificados | [FAB](https://www.fab.mil.br/ingresso/arquivos/provas/afa2021_gabarito_oficial.pdf) / [snapshot](https://web.archive.org/web/20240418203433id_/https://www.fab.mil.br/ingresso/arquivos/provas/afa2021_gabarito_oficial.pdf) |
| AFA 2022 | 64 | 21 / 5 / 53 | Inglês → Física → Português → Matemática | não verificados | [FAB](https://www.fab.mil.br/ingresso/arquivos/2021/afa2022_gab_oficial.pdf) / [snapshot](https://web.archive.org/web/20250110103018id_/https://www.fab.mil.br/ingresso/arquivos/2021/afa2022_gab_oficial.pdf) |
| AFA 2023 | 64 | 33 / 17 / 1 | Inglês → Física → Português → Matemática | flag herdado; evidência do caderno pendente | [FAB](https://www.fab.mil.br/ingresso/arquivos/provas/afa2023_gab_oficial.pdf) / [snapshot](https://web.archive.org/web/20240517222855id_/https://www.fab.mil.br/ingresso/arquivos/provas/afa2023_gab_oficial.pdf) |
| AFA 2024 | 64 | 60, 62 / 12, 14 / 28, 30 | Português → Matemática → Inglês → Física | flag herdado; evidência do caderno pendente | [FAB](https://www.fab.mil.br/ingresso/arquivos/2023/afa2024_gabarito_oficial.pdf) / [snapshot](https://web.archive.org/web/20250110030820id_/https://www.fab.mil.br/ingresso/arquivos/2023/afa2024_gabarito_oficial.pdf) |
| AFA 2025 | 64 | 11, 32, 41, 51 / 16, 25, 35, 59 / 9, 19, 43, 64 | Português → Matemática → Inglês → Física | flag herdado; evidência do caderno pendente | [FAB](https://www.fab.mil.br/ingresso/arquivos/2024/afa/afa2025_gab_oficial.pdf) / [snapshot](https://web.archive.org/web/20250109100902id_/https://www.fab.mil.br/ingresso/arquivos/2024/afa/afa2025_gab_oficial.pdf) |
| EPCAR 2018 | 48 | 31 / 15 / 47 | Português → Matemática → Inglês | não verificados | [FAB](https://www.fab.mil.br/ingresso/arquivos/provas/cpcar2018_gab_oficial.pdf) / [snapshot](https://web.archive.org/web/20250110023023id_/https://www.fab.mil.br/ingresso/arquivos/provas/cpcar2018_gab_oficial.pdf) |
| EPCAR 2019 | 48 | 28, 46 / 14, 44 / 12, 46 | Português → Matemática → Inglês | não verificados | [FAB](https://www.fab.mil.br/ingresso/arquivos/provas/cpcar2019_gab_oficial.pdf) / [snapshot](https://web.archive.org/web/20250110131214id_/https://www.fab.mil.br/ingresso/arquivos/provas/cpcar2019_gab_oficial.pdf) |
| EPCAR 2020 | 48 | 25, 30, 37 / 5, 41, 46 / 9, 14, 21 | Português → Matemática → Inglês | não verificados | [FAB](https://www.fab.mil.br/ingresso/arquivos/provas/cpcar2020_gab_oficial.pdf) / [snapshot](https://web.archive.org/web/20250420065110id_/https://www.fab.mil.br/ingresso/arquivos/provas/cpcar2020_gab_oficial.pdf) |
| EPCAR 2021 | 48 | 3, 23, 38, 39 / 6, 7, 19, 39 / 7, 22, 23, 35 | Inglês → Português → Matemática | não verificados | [FAB](https://www.fab.mil.br/ingresso/arquivos/provas/cpcar2021_gab_oficial.pdf) / [snapshot](https://web.archive.org/web/20240409022813id_/https://www.fab.mil.br/ingresso/arquivos/provas/cpcar2021_gab_oficial.pdf) |
| EPCAR 2022 | 48 | nenhuma / nenhuma / nenhuma | Inglês → Matemática → Português | não verificados | [FAB](https://www.fab.mil.br/ingresso/arquivos/provas/cpcar2022_gab_oficial.pdf) / [snapshot](https://web.archive.org/web/20250109124136id_/https://www.fab.mil.br/ingresso/arquivos/provas/cpcar2022_gab_oficial.pdf) |
| EPCAR 2023 | 48 | nenhuma / nenhuma / nenhuma | Inglês → Matemática → Português | não verificados | [FAB](https://www.fab.mil.br/ingresso/arquivos/2022/cpcar/cpcar2023_oficial.pdf) / [snapshot](https://web.archive.org/web/20250110170902id_/https://www.fab.mil.br/ingresso/arquivos/2022/cpcar/cpcar2023_oficial.pdf) |
| EPCAR 2024 | 48 | nenhuma / nenhuma / nenhuma | Português → Matemática → Inglês | não verificados | [FAB](https://www.fab.mil.br/ingresso/arquivos/2023/cpcar/cpcar2024_gab_OFICIAL.pdf) / [snapshot](https://web.archive.org/web/20240409022815id_/https://www.fab.mil.br/ingresso/arquivos/2023/cpcar/cpcar2024_gab_OFICIAL.pdf) |
| EPCAR 2025 | 48 | 31 / 15 / 47 | Inglês → Matemática → Português | não verificados | [FAB](https://www.fab.mil.br/ingresso/arquivos/2024/cpcar/cpcar2025_gab_oficial.pdf) / [snapshot](https://web.archive.org/web/20250110154843id_/https://www.fab.mil.br/ingresso/arquivos/2024/cpcar/cpcar2025_gab_oficial.pdf) |

AFA 2024: conferência independente repetida, 64/64 respostas A e anuladas [60, 62]. EPCAR 2023: página renderizada e inspecionada; A29–A34 = D B B C A B, enquanto C29–C34 = C A C B C B. O teste `scripts/tests/fixtures/epcar-2023-columns.txt` é transcrito desse trecho do snapshot da tabela, não do JSON gerado.

## Edições excluídas

**AFA 2026 — bloqueada para ingestão, não presente no provider.** A URL anteriormente declarada, [gabarito oficial AFA 2026](https://www.fab.mil.br/ingresso/arquivos/2025/afa/afa2026-P1-gabarito-oficial.pdf), retornou 403 em 2026-09-07. A [consulta de disponibilidade Wayback](https://archive.org/wayback/available?url=https%3A%2F%2Fwww.fab.mil.br%2Fingresso%2Farquivos%2F2025%2Fafa%2Fafa2026-P1-gabarito-oficial.pdf) retornou `archived_snapshots: {}`. Isso registra o motivo operacional da remoção, não prova que a banca deixou de publicar o gabarito ou que nenhuma cópia exista em outro lugar. Não atribuímos fetchedAt/checksum a documento não lido.

**EPCAR 2026 — bloqueada para ingestão, não presente no provider.** Não foi reconferida uma cópia final oficial nessa entrega. A afirmação anterior “só existe provisório” foi removida por falta de evidência suficiente. Não há contagem de questões validada para essa edição.

“8 descobertas” não quer dizer que só existem 8 edições na história da instituição. O audit registra em `discoveredEditions` apenas os anos encontrados nos dois índices CDX consultados; indisponibilidade do índice gera falha, não lista vazia aprovada. As duas candidatas 2026 acima ficam separadas das 16 edições realmente lidas.

## Reprodução e testes

`npm test` executa Vitest e unittest Python, sem rede. O teste Python não precisa de pypdf: ele usa texto independente e mocks na fronteira do PDF. A verificação documental online exige pypdf.

```sh
python scripts/ingest-fab.py --verify-manifest
npm run sources:audit -- --output .cache/sources-audit.json
npm test
npm run lint
npm run build
npm run test:e2e
```

O audit não consulta “available” para aprovar as edições ingeridas: faz GET do snapshot exato e compara os bytes. HTTP 403 no origin é `blocked-expected`, nunca `healthy`; snapshot inacessível, HTML, PDF truncado ou checksum diferente falham. O teste cobre também origin recuperado, arquivo desaparecido, redirecionamento errado e falha de rede. A disponibilidade histórica de 2026 acima é apenas diagnóstico de exclusão.

Resultados finais de execução e pendências externas são registrados no corpo da PR #14; não confundir CI verde com documentos ou enunciados não conferidos.

