# Ordem de integração e estado da base — 2026-09-13

## Base auditada

- `main`: `9f23bd0ff2ef5f4d0170fc475adad2fcb53fc30d` (`feat(espcex): expand historical corpus 2012-2019`).
- O job funcional `validate` desse commit está verde: testes, lint, build, Storybook, E2E de fumaça/acessibilidade e composição responsiva/teclado.
- O job `visual` está vermelho por dívida de baseline, não por falha funcional.

## Regressão visual

O artefato `diferencas-visuais` do run `34763302912` foi revisado. As referências ainda representam a interface anterior, enquanto o `main` já renderiza a interface atual. A divergência atinge as 50 capturas de referência atuais (desktop/mobile, claro/escuro e seletor), portanto não é correto tratar o vermelho como regressão pontual nem aumentar tolerância.

A correção correta continua sendo a já documentada em `docs/visual-testing.md`: gerar `capturas-linux`, revisar visualmente o conjunto e substituir os PNGs de referência. Não atualizar snapshots automaticamente e não tornar o job permanentemente não-bloqueante.

## Ordem de PRs

A árvore atual contém PRs empilhados. A ordem segura é:

1. **#17** — `Harden discovery and native-question ingestion architecture` → `main`.
2. **#21** — `feat: introduce high-volume ingestion engine core` → depende de #17.
3. **#26** — `feat: persist ingestion review and add corpus contract` → depende de #21.
4. Depois de #26, podem avançar em paralelo:
   - **#27** — adaptador genérico de corpus de múltipla escolha;
   - **#28** — console local de revisão.
5. **#24** — entrega de conteúdo nativo/UFT também depende da infraestrutura de #17; deve ser reconciliado com a linha acima antes de merge para evitar duplicar alterações em registry/catalog.
6. **#22** — Student AI permanece isolado e draft; não deve bloquear ingestão/native.

PRs que precisam de reconciliação antes de merge:

- **#25**: branch antiga em relação ao `main` atual e conflituosa; transportar apenas os commits ainda úteis em branch nova baseada no `main`.
- **#29**: Mass Ingestion 1 atingiu 50 edições/4.520 questões, mas nasceu antes do novo commit histórico da EsPCEx. Está 22 commits à frente e 1 atrás do `main`; não deve ser mergeado enquanto `providers/index.ts` e `catalog/current.ts` não forem reconciliados com a expansão da EsPCEx.

## Regra operacional

- Nenhum merge automático.
- Nenhum `reset --hard`, `clean`, rebase destrutivo ou force-push.
- Para branches divergidas, criar uma branch limpa do `main` atual e transportar apenas as mudanças necessárias.
- Manter ingestion, review, providers e UI em PRs revisáveis sempre que possível.
