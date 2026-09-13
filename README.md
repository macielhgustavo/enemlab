# Studium Labs

Studium Labs é uma plataforma pessoal de preparação para vestibulares e provas de alta exigência. O projeto existe principalmente para uso diário de dois estudantes e busca concentrar, em um único lugar, treino, revisão, diagnóstico e planejamento de estudo.

Não é tratado como uma startup neste momento. A prioridade é qualidade de estudo, confiabilidade dos dados e integração entre os módulos.

## Por que existe

Estudar para provas diferentes costuma espalhar questões, simulados, erros, revisões e métricas em várias ferramentas. O Studium Labs tenta manter esse ciclo em um sistema único:

```text
questão
  ↓
acerto / erro
  ↓
domínio
  ↓
identificação de lacunas
  ↓
plano
  ↓
revisão / questões / futuro vídeo
  ↓
novo treino
  ↓
evolução
```

Uma feature nova só faz sentido quando melhora esse ciclo ou a qualidade dos dados que o alimentam.

## Principais módulos

- **Treino** — sessões de questões por prova, edição e filtros disponíveis.
- **Banco** — catálogo pesquisável de questões e referências, com histórico pessoal por item.
- **Simulados** — sessões mais longas montadas a partir das provas suportadas.
- **Erros** — identificação e priorização de questões erradas, incluindo confiança e tempo.
- **Revisões / SRS** — fila de repetição espaçada baseada no histórico de respostas.
- **Domínio** — métricas de desempenho por conteúdo ou matéria, sempre separadas por prova.
- **Plano** — plano diário que combina revisões vencidas, lacunas, ritmo e treino adaptativo.
- **Histórico** — tentativas e resultados já concluídos.
- **Dados** — visão de qualidade/cobertura do acervo e dos sinais de estudo.
- **Multi-exam** — providers isolam regras, taxonomias e fontes de cada prova.

## Arquitetura

A aplicação separa quatro responsabilidades principais:

```text
fonte → descoberta/importação → validação/evidência → catálogo → provider → Studium Labs
```

- **Sources** descrevem onde a prova existe, procedência, direitos operacionais, modo do enunciado e versão do parser.
- **Ingestion/importers** descobrem documentos e transformam fontes heterogêneas em dados verificáveis.
- **Validation/evidence** bloqueiam edições incompletas ou inconsistentes; material `provisional` ou `blocked` não entra no catálogo padrão.
- **Catalog** é um índice leve por edição. Ele guarda metadados e contagens sem carregar todas as questões.
- **Providers** são a interface usada pela aplicação para buscar e normalizar uma prova sem expor detalhes do parser às telas.

A `main` ainda combina importadores especializados com essa infraestrutura. Uma engine genérica de ingestão em alto volume está sendo desenvolvida separadamente no PR #21 e ainda não faz parte da `main`; portanto, ela não deve ser tratada como infraestrutura de produção concluída.

Mais detalhes: [`docs/ingestion.md`](docs/ingestion.md) e [`docs/exam-sources.md`](docs/exam-sources.md).

## Exames

A tabela abaixo descreve somente providers registrados no código atual. `structured` significa que o enunciado é consumido de forma estruturada pelo app; `reference` significa que o Studium Labs mantém metadados/gabarito e direciona o estudante ao documento de origem para o enunciado.

| Prova | Cobertura atual | Conteúdo | Estado predominante |
|---|---|---|---|
| ENEM | 2009–2023 | structured | reviewed legado |
| ITA | 2019–2026 | reference | reviewed legado |
| IME | 2018–2025 | reference | reviewed legado |
| FUVEST | 2005–2026, 1ª fase | reference | reviewed |
| AFA | 2018–2025 | reference | reviewed quando a evidência documental é válida |
| EPCAR | 2018–2025 | reference | reviewed quando a evidência documental é válida |
| EsPCEx | 2020–2025, dois dias | reference | reviewed |
| ESA — Área Geral | 2021–2025, Tipo A | reference | reviewed |
| UNICAMP | 2024–2026, 1ª fase | reference | reviewed |
| UEL | 2026 | reference | reviewed |
| PUC-SP | 2024–2026, vestibular de verão | reference | reviewed |
| UDESC | 2015.1–2026.2, 18 edições | reference | varia por edição conforme validação |
| ACAFE | 2022.2–2026.2, 9 edições | reference | varia por edição conforme validação |

Os níveis usados pelo catálogo são `verified`, `reviewed`, `provisional` e `blocked`. Por padrão, somente `verified` e `reviewed` são consultáveis; `provisional` e `blocked` precisam ser pedidos explicitamente. Cobertura publicada pela banca não é automaticamente cobertura disponível no app.

## enemlab-corpus

O repositório relacionado é [`macielhgustavo/enemlab-corpus`](https://github.com/macielhgustavo/enemlab-corpus).

Hoje ele funciona como **corpus de documentos e manifests**, não como banco normalizado de questões. Ele versiona referências de fontes, baixa documentos em jobs próprios, calcula hashes e publica pacotes de corpus. Não contém atualmente o frontend, o estado do usuário, mastery, SRS ou o catálogo de runtime do Studium Labs.

Também não existe integração automática direta entre os dois repositórios na `main`. A direção desejável é manter o corpus como camada de material bruto/proveniência e deixar normalização, validação, catálogo e experiência de estudo no `enemlab`, com um contrato explícito entre os dois antes de automatizar esse fluxo.

## Stack

- Next.js 16 e React 19
- TypeScript
- Zustand
- TanStack Query
- Zod
- Recharts
- Radix UI + class-variance-authority
- CSS com design tokens próprios
- Supabase opcional para autenticação e sincronização
- Vitest e testes Python
- Playwright para E2E, acessibilidade e regressão visual
- Storybook

## Desenvolvimento

O CI usa Node.js 22.

```bash
npm ci
npm run dev
```

A aplicação funciona localmente sem Supabase. Para habilitar sincronização, copie as variáveis descritas em `.env.example` para `.env.local` e aplique as políticas/RPC documentadas em `supabase/`.

Comandos úteis de ingestão e auditoria de fontes estão em `package.json` e em [`docs/ingestion.md`](docs/ingestion.md).

## Testes

```bash
npm test                 # Vitest + unittest Python
npm run lint
npm run build
npm run build-storybook
npm run test:e2e:ci      # smoke + acessibilidade
npm run test:visual      # regressão visual
```

O workflow principal também executa checagens responsivas e de teclado em múltiplas larguras.

## Estado atual

O projeto já é multi-exam e possui banco, treino, resultados, histórico, domínio, SRS, plano adaptativo, dashboard, autenticação/sincronização opcional e infraestrutura de qualidade de dados.

Ainda existem diferenças entre a arquitetura desejada e a efetivamente consolidada:

- o nome **Studium Labs** ainda não foi propagado por toda a interface e pelo código legado, que continua contendo referências a `ENEM Lab`;
- muitos providers são `reference-only`, portanto o app não possui o texto estruturado de todas as questões;
- a engine genérica de mass ingestion está em desenvolvimento fora da `main`;
- `enemlab-corpus` ainda não possui um contrato de integração versionado com o catálogo do app;
- partes antigas do catálogo e de algumas telas ainda conhecem casos específicos de providers.

A prioridade é fechar essas lacunas sem reescrever o sistema que já funciona.

## Próximos passos

1. Estabilizar a mass ingestion engine e seu caminho de revisão/evidência antes de multiplicar providers.
2. Garantir consistência de identidade e escopo entre erros, mastery, SRS, plano e treino adaptativo em todas as provas.
3. Definir um contrato pequeno e versionado entre `enemlab-corpus` e a ingestão do Studium Labs, incluindo procedência e direitos.
4. Depois da base estável, adicionar ou ampliar somente as provas que realmente importam para os dois usuários.
5. Consolidar o rebranding Studium Labs e terminar o refinamento do dashboard sem iniciar um redesign completo.

A biblioteca e a recomendação de vídeos ficam para uma etapa posterior, quando erros, domínio, plano, prova-alvo e pré-requisitos estiverem suficientemente confiáveis para orientar recomendações úteis.
