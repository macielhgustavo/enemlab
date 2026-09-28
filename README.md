# Studium

Studium é uma plataforma pessoal de estudos orientada por evidência de uso. Ela organiza provas oficiais de diferentes vestibulares em **providers** plugáveis, registra histórico localmente, calcula próximos passos de estudo e pode sincronizar o estado do usuário com Supabase.

A interface pública se chama **Studium**. O antigo nome **ENEM Lab** permanece apenas em identificadores técnicos legados quando uma renomeação quebraria dados existentes, como chaves de `localStorage`, alguns caminhos internos e o nome histórico do repositório.

## O que o produto faz

O ciclo principal é:

**objetivo → plano → estudo → correção → diagnóstico → recuperação → revisão → simulado → novo plano**

Hoje o produto inclui, entre outros fluxos:

- plano diário e trajetória semanal até a data-alvo;
- treino manual e adaptativo;
- banco de questões por provider;
- revisões SRS e caderno de erros;
- domínio/cobertura por área;
- simulados completos;
- treino e histórico de redação quando o provider possui redação;
- onboarding por prova e rotina;
- persistência local-first com sincronização opcional em nuvem.

Indicadores internos de prontidão e ritmo são métricas de estudo. Eles **não** são TRI, nota prevista, probabilidade de aprovação ou previsão de resultado.

## Vocabulário do projeto

Use estes termos em novos módulos:

| Termo | Significado |
| --- | --- |
| **Studium** | produto/plataforma apresentada ao usuário |
| **provider** | integração de uma prova/vestibular, com metadados, taxonomia, edições e normalização |
| **source / fonte** | origem oficial ou referenciada do conteúdo |
| **NativePack** | contrato normalizado de conteúdo nativo extraído/validado |
| **Native Fleet** | automação fail-closed que prepara, valida e publica NativePacks |
| **ENEM Lab** | nome legado; não deve ser introduzido em novas strings públicas |

A decisão completa e as regras de compatibilidade estão em `docs/adr/0001-studium-product-identity.md`.

## Arquitetura

### Aplicação

- **Next.js 16 + React 19 + TypeScript**
- App Router em `src/app/`
- estado persistido com **Zustand**
- componentes e UI em `src/components/`
- regras de domínio em `src/lib/domain/`
- providers em `src/lib/providers/`

A aplicação é **local-first**. O estado principal continua disponível sem nuvem. O provider ativo é apenas uma visão sobre o mesmo produto; providers não devem compartilhar histórico de forma implícita.

### Providers

O registry atual inclui:

- ENEM
- ITA
- IME
- Fuvest
- AFA
- EPCAR
- EsPCEx
- ESA
- EEAR
- Unicamp
- UEL
- PUC-SP
- Udesc
- Acafe
- Fatec
- Unesp
- Unioeste

Cada provider implementa o contrato de `ExamProvider`, incluindo metadados, busca/normalização e uma `questionKey` estável.

### Estado local e compatibilidade

O estado principal é persistido em `localStorage` pela chave legada `enem_lab_v7`.

Essa chave **não deve ser renomeada apenas por identidade visual**. Uma troca futura exige migração explícita, com leitura do legado e garantia de que histórico, metas, tentativas, redações, SRS e configurações por provider sejam preservados.

O mesmo princípio vale para outros prefixos legados, por exemplo chaves de sessão/sincronização que começam com `enem_lab_`.

## Supabase e sincronização

A nuvem é opcional para o uso básico.

O cliente usa uma URL e uma **publishable key**, que são públicas por design. Nunca coloque uma `service_role` no frontend.

Arquivos principais:

- `src/lib/cloud/client.ts` — autenticação e chamadas REST/RPC;
- `src/components/CloudSyncProvider.tsx` — ciclo de sincronização e resolução de conflito;
- `supabase/schema.sql` — schema canônico;
- `supabase/VERIFICAR-RLS.md` — verificação obrigatória de RLS.

O schema usa uma linha de `user_state` por usuário e revisão monotônica para detectar conflitos. O RLS deve permanecer ativo e forçado.

Para um fork ou ambiente próprio, copie `.env.example` e defina:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://SEU-PROJETO.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_SUA_CHAVE
```

Sem configuração externa, o repositório possui defaults do projeto canônico. Nunca adicione segredos administrativos ao bundle.

## NativePack e Native Fleet

O pipeline nativo existe para transformar documentos oficiais em conteúdo consumível pela aplicação sem aceitar silenciosamente material incompleto ou uma identidade de questão não comprovada.

Pontos principais:

- `scripts/native_ingest.py` é a porta pública fail-closed do inventário/preparo;
- `scripts/native_fleet.py` planeja, classifica saúde e publica bundles;
- `scripts/native_all.py` executa os alvos prontos;
- `.github/workflows/native-fleet.yml` roda canários, preparo e publicação;
- `supabase/functions/native-fleet-publisher/` recebe publicação autenticada por OIDC;
- alvos sem `questionKey` auditada, fonte válida ou qualidade suficiente permanecem bloqueados/degradados em vez de serem tratados como prontos.

Comandos úteis:

```bash
npm run native:inventory
npm run native:prepare -- --help
npm run native:prepare-all -- --help
npm run native:fleet:plan
npm run native:all -- --help
```

A publicação automatizada usa OIDC do GitHub Actions; uma chave de serviço do Supabase não deve ser colocada no workflow.

## Direitos e proveniência de conteúdo

O projeto diferencia **provider**, **fonte oficial** e **conteúdo redistribuível**.

Regras práticas:

- manter proveniência por questão/documento;
- preferir links e metadados de fonte oficial;
- não inventar enunciados ou respostas quando o material está ausente;
- não assumir que um PDF publicamente acessível pode ser redistribuído integralmente;
- conteúdo extraído que dependa de acesso restrito deve continuar protegido;
- mudanças no corpus devem preservar validação, identidade de questão e rastreabilidade da origem.

O tipo `OfficialSource` em `src/lib/providers/types.ts` existe justamente para registrar instituição, documento e página quando aplicável.

## Como rodar localmente

Requisitos recomendados:

- Node.js 22
- npm
- Python 3.12 para os scripts/testes do pipeline
- Google Chrome para a mesma configuração Playwright usada no CI

Instale as dependências:

```bash
npm ci
```

Inicie o desenvolvimento:

```bash
npm run dev
```

Abra `http://localhost:3000`.

## Testes e qualidade

### Unitários e pipeline Python

```bash
npm test
```

Esse comando executa Vitest e os testes Python em `scripts/tests/`.

### Lint e build

```bash
npm run lint
npm run build
```

### Storybook

```bash
npm run storybook
npm run build-storybook
```

### Playwright

```bash
npm run test:e2e
npm run test:e2e:ci
npm run test:a11y
npm run test:visual
```

O CI também valida composição responsiva/teclado e regressão visual. Snapshots não devem ser atualizados apenas para esconder regressões.

## CI/CD

`.github/workflows/ci.yml` roda em pull requests e em pushes para `main`, cobrindo:

- testes;
- lint;
- build;
- Storybook;
- fumaça E2E;
- acessibilidade;
- responsividade/teclado;
- regressão visual.

O deploy web é feito pela Vercel.

O Native Fleet possui workflow separado porque sua responsabilidade é preparar/publicar corpus, não validar a aplicação web.

## Regras para evolução

1. Studium é a marca pública; não introduzir novas strings “ENEM Lab”.
2. ENEM, ITA, IME e demais provas são providers, não produtos separados.
3. Providers quebrados devem degradar isoladamente.
4. Pouca amostra significa calibração/incerteza, não domínio confirmado.
5. Readiness e ritmo não são nota nem previsão de aprovação.
6. Estado local e histórico têm prioridade de compatibilidade sobre renomeações cosméticas.
7. Conteúdo oficial precisa de proveniência e de uma política de direitos explícita.
