# Studium

Studium é uma plataforma pessoal de estudos para ENEM e vestibulares. O produto organiza treino, revisão espaçada, recuperação de conteúdo, redação, simulado e trajetória até a prova a partir do histórico real do usuário.

A plataforma é multi-prova: ENEM, ITA, IME e demais vestibulares entram como **providers**. Cada provider mantém identidade, catálogo, regras e proveniência próprios; desempenho de bancas diferentes não é somado como se fosse a mesma prova.

## Princípios do produto

- **Local-first:** o navegador mantém uma cópia completa do estado de estudo.
- **Nuvem opcional:** Supabase adiciona continuidade entre dispositivos sem substituir o estado local.
- **Provider-scoped:** questões, histórico, domínio e métricas são separados por prova.
- **Fail-closed:** edição incompleta ou inconsistente não entra no banco padrão.
- **Evidência explícita:** baixa amostra é calibração, não “fraqueza”.
- **Sem previsão de aprovação:** readiness, ritmo e domínio são métricas internas; não são TRI, nota oficial ou probabilidade de aprovação.
- **Direitos de conteúdo:** documento público não é tratado automaticamente como conteúdo redistribuível.

## Arquitetura

Fluxo principal do produto:

```
FONTE → IMPORTADOR → CATÁLOGO → PROVIDER → TENTATIVA → HISTÓRICO/DOMÍNIO/SRS
```

Camadas relevantes:

- `src/lib/providers/`: regras e identidade de cada prova;
- `src/lib/sources/`: procedência, tipo de fonte e política de direitos;
- `src/lib/catalog/`: índice leve de edições disponíveis;
- `src/lib/domain/`: métricas, plano, adaptive, trajetória, redação e estado de aprendizagem;
- `src/lib/services/`: criação/correção de tentativas e composição de fluxos;
- `src/components/` e `src/app/`: interface Next.js;
- `scripts/`: ingestão, validação e Native Fleet;
- `supabase/`: schema e funções da nuvem/corpus privado.

Documentação de arquitetura e ingestão:

- `docs/adr/0001-platform-brand-studium.md`
- `docs/exam-sources.md`
- `docs/ingestion.md`
- `docs/native-content-pipeline.md`
- `docs/study-flow.md`
- `docs/design-system.md`

## Stack

- Next.js 16 + React 19 + TypeScript
- Zustand para estado local persistido
- Supabase Auth/Postgres/Storage/Edge Functions
- Vitest + Python unittest
- Playwright para E2E, acessibilidade, responsividade e regressão visual
- Storybook
- Radix UI + class-variance-authority
- Recharts
- GitHub Actions
- Vercel

O CI usa Node.js 22.

## Rodando localmente

Pré-requisitos:

- Node.js 22
- npm
- Python 3 para os testes/scripts de ingestão

Instalação:

```bash
npm ci
npm run dev
```

Abra `http://localhost:3000`.

Build de produção:

```bash
npm run build
npm start
```

## Testes

Suite principal:

```bash
npm test
npm run lint
npm run build
```

E2E:

```bash
npm run test:e2e
```

Acessibilidade:

```bash
npm run test:a11y
```

Regressão visual:

```bash
npm run test:visual
```

Atualização intencional dos snapshots visuais:

```bash
npm run test:visual:update
```

Storybook:

```bash
npm run storybook
npm run build-storybook
```

O workflow `.github/workflows/ci.yml` executa testes, lint, build, Storybook, E2E/acessibilidade, composição responsiva/teclado e regressão visual.

## Supabase

Projeto canônico atual:

- project ref: `srpohfgqqrzpilalemar`
- schema: `supabase/schema.sql`

O cliente aceita overrides:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

A publishable key pode existir no bundle do navegador; `service_role` nunca deve ser usada no cliente.

A nuvem sincroniza o estado do usuário com RLS. O estado local continua sendo uma cópia completa.

## Native Fleet e corpus privado

O Native Fleet prepara e publica conteúdo nativo validado sem permitir que uma edição degradada contamine as demais.

Comandos principais:

```bash
npm run native:inventory
npm run native:prepare
npm run native:prepare-all
npm run native:fleet:plan
npm run native:all
```

Estados de saúde:

- `healthy`: pode publicar;
- `degraded`: não publica e preserva fallback/referência;
- `unavailable`: fonte/conteúdo indisponível;
- `pending`: ainda não processado.

A imagem/PDF oficial continua sendo a fonte visual de verdade. OCR/texto extraído é camada auxiliar e não autoriza republicação.

## Direitos de conteúdo

`rightsStatus` é metadata operacional, não parecer jurídico.

Regras do projeto:

- “disponível na internet” não significa “licenciado para republicação”;
- quando não há permissão clara, usar modo referência;
- nunca contornar login, paywall ou proteção técnica;
- gabaritos são tratados separadamente de enunciados/documentos;
- fontes oficiais, URLs, páginas e parser ficam registrados como proveniência;
- material de cursinhos/plataformas comerciais não deve ser copiado para o corpus.

Veja `docs/exam-sources.md` e `docs/ingestion.md`.

## Providers

A plataforma registra provas por provider. Entre os providers já modelados/documentados estão:

- ENEM
- ITA
- IME
- FUVEST
- AFA
- EPCAR
- EsPCEx
- ESA
- UNICAMP
- UEL
- PUC-SP
- UDESC
- ACAFE

Nem toda edição possui enunciado redistribuível. Providers em modo referência mantêm numeração, gabarito, contexto de sessão e link para a fonte oficial sem copiar o documento para o domínio do Studium.

## Vocabulário

- **Studium:** produto/plataforma.
- **Provider:** implementação de uma prova/banca dentro do produto.
- **Fonte:** origem do conteúdo e suas condições de uso.
- **Importador:** transforma uma fonte em dados normalizados.
- **Catálogo:** índice leve de edições disponíveis.
- **Native Fleet:** pipeline que prepara/valida/publica corpus nativo.
- **ENEM Lab:** nome legado. Não é a marca atual da UI.

## Compatibilidade com o nome legado

A decisão de marca não renomeia chaves técnicas apenas por estética.

Permanecem por compatibilidade, até existir uma migração explícita com leitura do legado:

- `enem_lab_v7`
- `enem_lab_cloud_session_v1`
- `enem_lab_cloud_client_v1`
- `enem_lab_next_cache`
- caminhos como `components/enem-lab/` e `styles/enem-lab.css`
- nomes históricos de branches, arquivos e documentos de migração

Mudar esses identificadores sem uma estratégia de compatibilidade poderia fazer o navegador “perder” estado existente mesmo com os dados ainda presentes.

## Marca

A decisão está registrada em `docs/adr/0001-platform-brand-studium.md`.

Resumo: **Studium é a plataforma; ENEM, ITA, IME e demais provas são providers.** “ENEM Lab” fica restrito a identificadores e documentação histórica de compatibilidade.
