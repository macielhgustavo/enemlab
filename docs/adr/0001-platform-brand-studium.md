# ADR 0001 — Studium como marca da plataforma

- Status: aceito
- Data: 2026-09-28
- Escopo: produto, UI, documentação e nomenclatura técnica

## Contexto

O produto nasceu como ENEM Lab, mas deixou de ser um aplicativo exclusivo para ENEM.

Hoje a mesma base executa múltiplos vestibulares, com:

- registry de providers;
- catálogo por edição/fase;
- fontes e proveniência separadas da UI;
- ingestão e Native Fleet;
- métricas de domínio escopadas por provider;
- Plano, Adaptive, Redação, Simulado e Trajetória multi-prova;
- Supabase e pipeline já usando o nome Studium em partes da infraestrutura.

Manter “ENEM Lab” como marca pública enquanto módulos novos usam “Studium” cria duas identidades sem hierarquia clara.

## Decisão

**Studium é a marca da plataforma.**

ENEM, ITA, IME, FUVEST e demais provas são **providers/experiências dentro do Studium**.

O nome “ENEM Lab” deixa de ser marca apresentada ao usuário. Ele permanece apenas onde é um identificador legado ou referência histórica necessária para compatibilidade.

## Vocabulário canônico

| Termo | Significado |
|---|---|
| Studium | produto/plataforma |
| provider | implementação de uma prova/banca |
| fonte | origem do documento/dado e política de uso |
| importador | código que transforma a fonte em dado normalizado |
| catálogo | índice leve de edições/fases disponíveis |
| Native Fleet | pipeline de preparação/validação/publicação do corpus nativo |
| ENEM Lab | nome legado, somente compatibilidade/histórico |

Uma prova não é uma “submarca” da plataforma. A UI deve mostrar algo como “Studium · ENEM” quando contexto de produto + prova forem necessários.

## Compatibilidade

Esta decisão **não** autoriza renomeação cega de identificadores persistidos.

Permanecem inalterados:

- `localStorage: enem_lab_v7`;
- `enem_lab_cloud_session_v1`;
- `enem_lab_cloud_client_v1`;
- IndexedDB `enem_lab_next_cache`;
- diretórios `components/enem-lab`;
- arquivo `styles/enem-lab.css`;
- IDs de projeto/bucket/audience já implantados;
- repo e nomes históricos de scripts quando a troca não traz benefício funcional.

Motivo: esses nomes não são copy de produto; são contratos de compatibilidade. Renomeá-los sem dual-read/migração pode desconectar estado existente.

Se um identificador persistido for renomeado no futuro, a mudança deve ter:

1. leitura da chave antiga;
2. escrita/migração para a nova;
3. teste de upgrade com estado legado;
4. janela explícita de compatibilidade;
5. rollback possível.

## Consequências

### Positivas

- a marca passa a refletir o produto multi-prova;
- UI, Supabase e pipeline deixam de parecer produtos diferentes;
- novos módulos têm nomenclatura única;
- providers podem crescer sem contradizer o nome do produto.

### Custos

- snapshots visuais de marca precisam ser atualizados intencionalmente;
- documentação histórica continuará contendo “ENEM Lab” em alguns nomes/paths;
- storage e caches conservam prefixos legados até uma migração funcional justificar a troca.

## Regra para código novo

- Copy apresentada ao usuário: **Studium**.
- Nome de prova: usar `examLabel(providerId)`/metadata do provider.
- Não escrever “ENEM” fixo quando a tela é multi-prova.
- Não criar novos identificadores persistidos com prefixo `enem_lab`.
- Não renomear identificadores legados só para “limpar” estética.
