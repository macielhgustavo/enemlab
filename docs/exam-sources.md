# Fontes, importadores e providers

Este documento existe porque a v8.0 misturou dois conceitos e isso deixou o
ENEM embutido no aplicativo inteiro. A v8.0.1 separou.

## 1. Source, Importer, Provider

```
FONTE            onde o conteúdo existe        vestibular.ita.br
   ↓
IMPORTADOR       como é descoberto/normalizado  ingest-ita.py
   ↓
CATÁLOGO         formato interno                NormalizedQuestion
   ↓
PROVIDER         como o app usa a prova         ItaProvider
```

- **Fonte** responde *de onde vem, em que forma, e o que podemos fazer com isso*.
- **Importador** responde *como transformamos aquilo em dado nosso*.
- **Provider** responde *como o ENEM Lab executa esta prova*.

As telas conhecem apenas o **provider**. Nenhuma tela deve importar cliente de
API ou parser.

## 2. Tipos de fonte

| `sourceType` | Significado | Exemplo |
|---|---|---|
| `structured-api` | API entrega questão estruturada | ENEM (`api.enem.dev`) |
| `official-html` | Página oficial com conteúdo em HTML | — |
| `pdf-text` | PDF **com** camada de texto extraível | — |
| `pdf-reference` | PDF digitalizado; enunciado fica na fonte | ITA |
| `partner-feed` | Conteúdo cedido por parceiro | — |
| `open-dataset` | Conjunto publicado com licença aberta | — |

`statementMode`: `structured` · `reference-only` · `mixed`.

## 3. Procedência

Todo item precisa responder **"de onde veio isto?"**. O `Provenance` carrega
provider, fonte, instituição, se é oficial, URL do documento, página quando
conhecida, versão do parser e data da última verificação.

Não persistimos isso em cada tentativa: é recuperável de forma determinística a
partir do provider + ano + fase.

## 4. Modo referência

Quando `statementAvailable === false`, o enunciado **não** está no app — ele é
lido no documento oficial.

Isso não é defeito: é a única forma honesta de trabalhar com prova digitalizada
sem copiar conteúdo de terceiros. A UI mostra numeração, matéria e um botão
para a prova oficial; o app cuida de tempo, confiança, marcação e correção.

O Data Quality trata esse modo com régua própria: cobra **procedência** (fonte,
URL válida, número, matéria) e **gabarito**, e não cobra enunciado nem texto de
alternativa.

### Leitor embutido

O documento oficial é exibido dentro da sessão, sob demanda, num `iframe` que
carrega direto do servidor da instituição. Nada é baixado, copiado ou
servido pelo nosso domínio — o navegador do aluno busca o arquivo na fonte.

Antes de implementar, foi medido se o servidor permite:

```bash
curl -sSI https://www.vestibular.ita.br/provas/2026_fase1.pdf
```

`vestibular.ita.br` responde `200` com `Content-Type: application/pdf`, **sem**
`X-Frame-Options`, `Content-Security-Policy: frame-ancestors` ou
`Content-Disposition`. Ou seja: não há proteção contra embed a ser contornada.
Se uma fonte futura enviar qualquer um desses cabeçalhos, o leitor embutido
**não** deve ser usado para ela — só o link externo.

Regras que valem para qualquer fonte em modo referência:

- carregar apenas quando o aluno pede (a prova do ITA passa de 12 MB);
- manter sempre o link externo visível: nem todo navegador exibe PDF embutido;
- usar só parâmetros de exibição do visualizador (`#navpanes=0&view=FitH`),
  nunca alterar o documento;
- nunca servir o arquivo a partir do nosso domínio para contornar bloqueio.

## 5. Como adicionar uma prova nova

1. **Descobrir a fonte oficial** e confirmar que ela publica as provas.
2. **Medir o PDF antes de escrever parser**:
   ```bash
   python -c "import pypdf; r=pypdf.PdfReader('prova.pdf'); print(len(r.pages), len(r.pages[0].extract_text() or ''))"
   ```
   Zero caractere significa documento digitalizado → `pdf-reference`.
3. Escrever o importador em `scripts/` e gerar o catálogo normalizado.
4. Declarar a fonte em `src/lib/sources/index.ts`.
5. Implementar o provider em `src/lib/providers/<prova>/`.
6. Registrar em `src/lib/providers/index.ts`.
7. Adicionar testes de isolamento contra as provas já existentes.

Nada em Banco, Adaptive, Plano ou Domínio precisa mudar.

## 6. Checklist de direitos

`rightsStatus` é **metadata operacional, não parecer jurídico**.

"Disponível na internet" não significa "liberado para republicação", e
"oficial" também não. Na dúvida: `permission-required` e modo referência.

- [ ] A prova é publicada oficialmente pela instituição?
- [ ] Estamos **referenciando** o documento ou **copiando** conteúdo?
- [ ] Se copiando: há licença explícita ou permissão?
- [ ] Gabarito é tratado como dado factual (número → alternativa)?
- [ ] Evitamos redistribuir o PDF no nosso domínio?

Na dúvida, `permission-required` e modo referência.

## 7. Checklist técnico de ingestão

- [ ] A numeração é **global** (1..N) ou reinicia por matéria? *(o ITA até 2018 reinicia — essas edições são recusadas)*
- [ ] A ordem/quantidade de matérias muda por ano? *(no ITA, muda — é lida do documento)*
- [ ] Como a anulação é marcada? *(no ITA varia entre `(*)`, `(**)` e `*`)*
- [ ] A edição tem cobertura completa e contígua?
- [ ] Conferiu ao menos duas edições contra o PDF, manualmente?
- [ ] Edição incompleta é **recusada** em vez de ingerida pela metade?

Correção errada é pior que ausência de dado.

## 8. Estado atual

| Prova | Fonte | Tipo | Enunciado | Edições |
|---|---|---|---|---|
| ENEM | `api.enem.dev` | `structured-api` | no app | 2009–2023 |
| ITA | `vestibular.ita.br` | `pdf-reference` | na fonte oficial | 2019–2026 |
| IME | `ime.eb.mil.br` | `pdf-reference` | na fonte oficial | 2018–2025 |
| FUVEST | `fuvest.br` | `pdf-reference` | na fonte oficial | 2005–2026 (22 edições) |
| AFA | FAB, gabaritos recuperados do Internet Archive | `pdf-reference` | não extraído | 2018–2025 |
| EPCAR | FAB, gabaritos recuperados do Internet Archive | `pdf-reference` | não extraído | 2018–2025 |
| EsPCEx | `espcex.eb.mil.br` + espelhos HDO/Específico | `pdf-reference` | referência externa quando espelhado | 2023–2025 (2 dias) |
| ESA — Área Geral | documentos ESA via espelhos QConcursos/HDO; arquivo `esa.eb.mil.br` | `pdf-reference` | referência externa | 2021–2025 Tipo A |
| UNICAMP | `comvest.unicamp.br` | `pdf-reference` | na fonte oficial | 2024–2026 |
| UEL | `cops.uel.br` | `pdf-reference` | na fonte oficial | 2026 |
| PUC-SP | `nucvest.com.br` | `pdf-reference` | na fonte oficial | 2024–2026 verão |
| UDESC | `udesc.br/vestibular/provasanteriores` | `pdf-reference` | na fonte oficial | 2015.1–2026.2 (18 edições) |
| ACAFE | `acafe.org.br` / `storage.acafe.org.br` | `pdf-reference` | na fonte oficial | 2022.2–2026.2 (9 edições) |

### v8.5.3 — FAB

A [página oficial](https://www.fab.mil.br/ingresso/provas.html) retorna 403
neste ambiente. Não contornamos a proteção. `ingest-fab.py` pode descobrir
documentos nos índices CDX `fab.mil.br/ingresso/arquivos*` e
`fab.mil.br/ingresso*`, tentar a fonte viva e então uma cópia datada do
Internet Archive. O registro do app permanece `discovery: manual`: esta
entrega reconferiu um manifesto conhecido; não promete atualização automática
nem ingestão automática direta do site da FAB.

O comando `python scripts/ingest-fab.py --verify-manifest` baixa os **bytes dos
16 PDFs registrados**, confere SHA-256/tamanho, extrai o texto com `pypdf` e
compara edição, revisão final, respostas A/B/C, anuladas e ordem das matérias
com o dataset. Não lê JSON para gerar uma cópia do mesmo JSON. Falha de rede,
PDF diferente, coluna emendada, preliminar e divergência impedem aprovação.
Os testes de parser usam fixtures independentes e não acessam a rede.

| Provider | Edições com gabarito conferido | Questões canônicas | Anuladas (A) |
|---|---|---:|---:|
| AFA | 2018–2025 (8 reviewed) | 512 | 20 |
| EPCAR | 2018–2025 (8 reviewed) | 384 | 11 |

São 896 registros canônicos, dos quais 31 anulados ficam sem resposta correta
(865 não anulados). B/C são preservadas para conferência, não duplicadas no
banco ou no SRS. A relação `reordered` é a política herdada; **a permutação
questão a questão entre cadernos não foi demonstrada por esta verificação**.

`reviewed` agora depende da evidência individual e da assinatura do dataset,
não do nível herdado. Sem evidência, fica `provisional`; divergência fica
`blocked`. Ambos são excluídos do banco padrão. A verificação tem escopo de
**gabarito**, não de enunciado, permutação ou direitos de republicação.

Os limites das matérias são inferidos em blocos de 16. O trabalho preservado
declara comparação com cadernos AFA 2023–2025, mas não guardou seus
fingerprints: esta entrega **não reconfirma essa evidência**. Nas outras
cinco AFA e em todas as EPCAR, os limites estão explicitamente não verificados.
As URLs de caderno continuam ausentes: o modo referência ainda pode abrir
o gabarito, não o enunciado. Não anunciar experiência completa de prova.

AFA 2026 permanece excluída: em 2026-09-07 a URL anteriormente declarada
retornou 403 e a consulta de disponibilidade Wayback não encontrou snapshot.
Isso justifica não ingerir; **não prova inexistência de publicação**. EPCAR
2026 também não foi ingerida; retiramos a alegação sem evidência de que apenas
o preliminar existia.

O audit lê todos os snapshots efetivamente usados, não apenas a API que diz
que uma cópia existe. `origin: blocked-expected` continua não saudável;
`archive: healthy` exige PDF íntegro e checksum/tamanho iguais. Arquivo quebrado
reprova mesmo se a origem responder 200. Se a origem voltar, também é
verificada e seu estado não invalida automaticamente uma cópia histórica.
A descoberta audita os mesmos dois índices CDX e falha se eles não puderem
ser lidos. Os resultados de rede são separados da revisão histórica.

Fontes, snapshots, anuladas por versão, hashes e limitações por edição:
[relatório de validação FAB](fab-validation.md). Evidência legível por máquina:
`src/lib/providers/fab/evidence.generated.json`. Parser/verificador atual:
`fab-answer-key@2.1.0`; dataset preservado foi produzido pelo `2.0.0`.

Reprodução (Python com `pypdf`, Node e dependências npm):

```sh
npm test
npm run lint
npm run build
python scripts/ingest-fab.py --verify-manifest
npm run sources:audit -- --output .cache/sources-audit.json
```

`--evidence-output src/lib/providers/fab/evidence.generated.json` grava um novo
relatório apenas após leitura real; exige os dois providers e todas as edições.
Não executar esse modo só para renovar datas. A ingestão com `--year` conserva
as outras edições; qualquer edição recusada impede a escrita daquele provider.

### v8.8 — Vestibular Mass Injection

A wave v8.8 expande o catálogo de vestibulares sem copiar enunciados para o
bundle. UNICAMP, UEL e PUC-SP entram em `pdf-reference`: o app guarda gabarito,
proveniência, variante canônica e contagem; o aluno abre o enunciado na fonte
oficial. O modo de conteúdo continua explícito porque não há licença pública
suficiente para republicar os PDFs.

| Provider | Edições aceitas | Questões | Anuladas | Variante canônica | Relação | Fonte | Direitos |
|---|---|---:|---:|---|---|---|---|
| UNICAMP | 2024, 2025, 2026 — 1ª fase | 216 | 1 | Q/Y, Q/Z, Q/X conforme edição | `unknown` | COMVEST | `official-reference` |
| UEL | 2026 — 1º dia Inglês | 60 | 1 | Tipo 1 Inglês | `unknown` | COPS/UEL | `official-reference` |
| PUC-SP | 2024, 2025, 2026 — verão | 150 | 2 | Prova única | `unknown` | NucVest | `official-reference` |

As variantes marcadas como `unknown` são preservadas como metadado, mas apenas a
canônica entra no runner. Isso evita corrigir um caderno com o gabarito de
outro quando a equivalência por reordenação não foi demonstrada.

O comando `npm run ingest:vestibular -- all` baixa os gabaritos oficiais, valida
cobertura, duplicidade, anuladas, revisão final/retificada, checksum, tamanho e
página de descoberta antes de escrever `answer-keys.generated.json` por
provider. Parser atual:

- `unicamp-answer-key@1.0.0`
- `uel-answer-key@1.0.0`
- `puc-sp-answer-key@1.0.0`

Fontes, fingerprints, recusas e pendências estão no
[relatório da wave v8.8](vestibular-mass-validation.md).

### v8.9 — UDESC em volume

O arquivo oficial da UDESC permitiu separar deterministicamente manhã e tarde
em 18 edições: 2015.1–2020.1 e 2023.2–2026.2. Cada edição oferece 50 questões
objetivas por sessão, totalizando 1.800 referências. O catálogo guarda as 36
sessões separadamente e carrega uma edição por vez.

| Provider | Edições | Sessões | Questões | Anuladas | Variante canônica | Relação | Direitos |
|---|---:|---:|---:|---:|---|---|---|
| UDESC | 18 | 36 | 1.800 | 50 | Inglês no bloco de língua | `distinct` (idiomas) | `official-reference` |
| ACAFE | 9 | 9 | 567 | 22 | Inglês | `distinct` (idiomas) | `official-reference` |

O gabarito de Espanhol é validado e preservado como variante distinta, mas não
entra no runner porque ocupa a mesma numeração do bloco canônico de Inglês. Não
há inferência de equivalência entre idiomas. O parser `udesc-answer-key@1.0.0`
exige duas sessões completas, duplicidade controlada apenas no bloco de língua,
revisão final e cobertura exata 1..50. Detalhes e limitações estão no
[relatório de expansão UDESC](vestibular-volume-validation.md).

A ACAFE segue a mesma política de idioma nas nove edições aceitas entre 2022.2
e 2026.2. São 63 questões por edição. A 2022.1 ficou explicitamente recusada:
a página do arquivo chama o documento de oficial, mas o próprio PDF contém
“Gabarito preliminar”. O parser `acafe-answer-key@1.0.0` trata `X` como
anulação, exige cobertura 1..63 e duas respostas somente no bloco 15..21.

### Pesquisa sem provider

- **UEM:** o arquivo oficial da CVU foi encontrado, incluindo gabarito
  definitivo, mas o formato é somatório/numerado e não A–E. Bloqueada até haver
  modelo de prova compatível.
- **UEPG:** o arquivo oficial da CPS foi encontrado com gabarito após recursos,
  mas também usa respostas por somatório. Bloqueada por incompatibilidade de
  runner, não por ausência de fonte.
- **UNESP/Vunesp:** páginas oficiais históricas existem, mas o acesso às provas
  e gabaritos exige Área do Candidato ou bloqueia robôs. Não rehostar nem
  contornar.
- **UFSC:** a Coperve publica gabaritos definitivos, porém a prova usa itens por
  proposição/somatório. Fica `reference-only` bloqueada até modelagem própria.
- **PUC-PR, PUC-Rio e Mackenzie:** não entraram por falta de arquivo público
  consistente com prova, gabarito final e direitos de referência fechados.
- **UFRJ histórica:** cobertura histórica exige investigação própria. Não há
  provider atual inventado porque o processo vigente não expõe vestibular
  próprio objetivo equivalente.
- **UFPR:** PS 2018–PS 2026 foram investigados no [Portal NC da UFPR](https://lua.nc.ufpr.br/PortalNC/Concurso?concurso=PS2026).
  Há versões e documentos preliminares/definitivos, mas a associação final
  consistente entre prova, versão e gabarito não foi demonstrada. Permanece
  `research`/bloqueada, sem parser executável.
- **EEAR:** o [arquivo oficial de provas anteriores](https://ingresso.eear.fab.mil.br/SOO/home/provas_anteriores.php?sigla_conc=%25)
  reúne cursos, ciclos, códigos e opções diferentes. A associação prova↔chave
  final não foi fechada com segurança nesta wave; fica documentada para
  v8.5.4, sem provider.

### Cobertura verificada do arquivo do ITA

Conferido por `HEAD` em 2026-09-06, edição por edição:

| Documento | 2019–2024 | 2025–2026 |
|---|---|---|
| 1ª fase (`<ano>_fase1.pdf`) | 200 | 200 |
| 2ª fase Matemática / Física / Química | 200 | 200 |
| 2ª fase Português | **404** | 200 |

O ITA só passou a publicar Português da 2ª fase como arquivo próprio em 2025.
Montar a URL pelo padrão sem checar oferecia link morto em seis das oito
edições — por isso a lista de matérias da 2ª fase depende do ano.

Ao acrescentar edições, refaça esta conferência antes de anunciar o documento
na interface. O padrão de nome não é promessa de existência.

Placeholders conceituais para o futuro — **não implementados**: EEAR e
UFPR. Cada um exige repetir o passo 2 antes de qualquer estimativa.
