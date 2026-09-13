# Escopo de novas provas: múltipla escolha apenas

## Decisão de produto

O Studium Labs vai implementar, por enquanto, **somente fases objetivas de alternativa única**.

Formatos fora de escopo:

- somatória de proposições;
- múltiplas respostas corretas;
- questões discursivas/abertas;
- provas que exijam uma regra de correção não representável como uma alternativa única por questão.

A aplicação não deve converter esses formatos artificialmente para A–E.

## Consequência para as bancas pesquisadas

- **UNESP 1ª fase**: compatível; segue como prova-piloto do adapter genérico do corpus.
- **FATEC**: compatível nas edições objetivas saneadas do corpus legado.
- **UEPG**: não implementar enquanto o formato relevante continuar usando somatória.
- **UEM**: não implementar enquanto o formato relevante continuar usando somatória.
- **UFSC**: não implementar as provas com somatória/questões abertas.

Uma universidade que possua fases diferentes pode ser suportada parcialmente no futuro **somente se a fase adicionada for múltipla escolha de alternativa única e tiver identidade própria no catálogo**.

## Gate arquitetural para uma banca nova

Uma nova prova/fase só pode ser ativada quando:

1. cada questão objetiva tem exatamente uma resposta canônica dentro de um conjunto declarado, por exemplo `A-E`;
2. edição, fase e variante identificam unicamente a prova;
3. gabarito final ou retificado prevalece sobre preliminar;
4. documentos possuem provenance, tamanho e SHA-256 conhecidos;
5. a edição chega a `ready-for-review` sem condição específica dentro de `engine.ts`;
6. revisão humana produz um handoff explícito;
7. o provider mantém treino, mastery, erros, SRS e plano isolados por prova;
8. nenhum conteúdo é inventado quando o corpus está apenas em modo referência.

## Ordem atual

1. fechar UNESP 2026 ponta a ponta;
2. sanear e validar FATEC;
3. usar essas duas provas para provar que o fluxo `manifest -> pacote -> adapter genérico -> review -> catálogo` é repetível;
4. pesquisar outras provas de múltipla escolha com fontes estáveis;
5. adicionar uma por vez, sem ampliar o modelo de resposta.
