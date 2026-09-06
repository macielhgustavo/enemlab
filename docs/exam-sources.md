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

`reuseStatus` é **metadata operacional, não parecer jurídico**.

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

Placeholders conceituais para o futuro — **não implementados**: FUVEST, IME,
AFA, EPCAR, EsPCEx. Cada um exige repetir o passo 2 antes de qualquer estimativa.
