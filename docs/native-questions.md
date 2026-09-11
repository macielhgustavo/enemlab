# Entrega de questões nativas

Esta etapa continua o `structuredRegistry` da PR #17. O resolvedor recebe
enunciado, contexto, alternativas e imagens no mesmo formato usado pelo ENEM.
Os gabaritos dos providers continuam sendo a base da identidade e da correção.
O ENEM mantém sua API atual.

## Estado entregue

- JSON por edição em `public/native/editions/`, fora do JavaScript inicial.
- Manifesto leve em `public/native/manifest.json`, com hash, quantidade e cobertura por fase.
- Download sob demanda, compartilhado entre consumidores, com SHA-256 conferido antes do uso.
- Conteúdo nativo aplicado pelos providers registrados, inclusive os adaptadores de vestibular por referência.
- Enunciado e contexto chegam ao campo renderizado; a taxonomia é preservada.
- Imagens locais, alternativas visuais, fórmulas e fontes citadas são preservadas.
- Identidade e correção permanecem iguais em tentativas, resultados, histórico e SRS.
- `nativeQuestionCount` e `contentMode` distinguem cobertura completa de `hybrid` no catálogo.

O primeiro piloto contém doze questões reais da UFT 2025.1 (tarde):
29, 31, 32, 33, 34, 35, 37, 38, 40, 41, 42 e 43. As outras 32 permanecem em
referência, incluindo a anulada 28. Q39 e Q44 permanecem fora do pacote nativo
porque incorporam material de terceiros. Consulte
[a evidência e os limites do piloto](native-uft-validation.md).
As questões sintéticas dos testes não são publicadas.

## Contrato

O schema executável fica em `src/lib/native/bundle.ts`. Cada arquivo contém
`schemaVersion: 1`, `providerId`, `year`, `editionId` (string ou `null`) e `questions`.

Cada questão declara:

- `providerId`, `examId`, `editionId`, `year`, `phase`, `number` e `language`.
- `statement`, alternativas com `letter` e `text` e/ou `file`.
- Contexto, introdução às alternativas, imagens e fontes citadas quando existentes.
- `validationLevel` igual a `reviewed` ou `verified`.
- `provenance`: `documentUrl`, `documentSha256`, `parserVersion`, `extractionMethod`,
  `rightsStatus`, `rightsEvidenceUrl`, `reviewedAt`, `reviewedBy`, `revision` e página opcional.

O hash do documento usado na transcrição é diferente do hash do JSON publicado.
`rightsStatus` deve ser `allowed`, acompanhado da URL da evidência de reuso.
Preliminares, evidência incompleta e alternativas vazias são recusados.
A conferência humana da fidelidade, do documento, das retificações e da evidência
de direitos continua necessária. O comando não atribui revisão automaticamente.

O documento de prova deve coincidir com o do provider. Variantes diferentes não
podem reutilizar numeração. Edição, fase, idioma e `examId` também precisam
coincidir exatamente. Nenhum campo de gabarito é aceito no arquivo nativo:
respostas e anuladas vêm do provider.

## Validar e publicar

```sh
npm run native:validate -- caminho/edicao-revisada.json
npm run native:validate -- caminho/edicao-revisada.json --publish
```

O primeiro comando só valida. O segundo valida contra o provider, confere as
imagens locais, grava o JSON com nome derivado do hash e atualiza o manifesto
por substituição atômica. Repetir o mesmo conteúdo não duplica a edição.
Uma nova publicação substitui a cobertura anterior daquela edição: o arquivo
de entrada deve conter todo o conteúdo nativo que se deseja manter nela.

As imagens locais ficam sob `/native/assets/`; imagens HTTPS também são
suportadas. Travessia de diretórios e URLs executáveis são recusadas.
O comando usa o Vite já instalado para executar os mesmos schemas e providers
TypeScript do aplicativo, evitando um segundo validador com regras diferentes.

Após publicar, incluir os arquivos e o manifesto na revisão de código e
reconstruir o site. O manifesto integra o build; os enunciados são baixados
apenas quando a edição é solicitada. Arquivos antigos podem ser mantidos
para builds anteriores.
O `.gitattributes` preserva os bytes dos arquivos de edição para que a
conversão automática de quebras de linha entre Windows e Linux não altere o hash.

## Migração gradual

O gabarito base precisa estar completo. A transcrição pode cobrir um subconjunto
explicitamente contado: só essas questões recebem texto; as demais preservam
a referência oficial. No catálogo, `statementAvailable` só passa a verdadeiro
quando a fase inteira está coberta.

Edição sem entrada no manifesto não gera download adicional. Erro HTTP, hash
alterado, contagem divergente e identidade incompatível interrompem o
carregamento, sem aplicar parte de um arquivo inválido. Uma nova tentativa
pode repetir o download; `force` força revalidação.

`fetchQuestions({ nativeContent: false, ... })` permite validar a base nas
ferramentas de ingestão. Banco, treino, revisão e resolvedor usam o caminho
nativo padrão. Os construtores síncronos legados continuam disponíveis para
metadados e compatibilidade; a entrega de conteúdo passa pelo provider.

## Testes

`src/lib/native/native.test.ts` cobre integridade, identidade, variantes,
direitos, revisão, anuladas, CLI, cache, repetição, isolamento, mídia e catálogo.
Também verifica cada arquivo publicado sem rede.
`src/lib/native/runner.test.tsx` monta o resolvedor real, mostra enunciado e
imagem, responde uma alternativa e verifica a ausência do painel de PDF.

Os testes de arquitetura usam conteúdo sintético. O teste UFT e o E2E nativo
também usam o arquivo real publicado; revisão humana independente continua pendente.
