# Pipeline único de conteúdo nativo

## Decisão

O modo `PDF na página exata + overlay textual` continua útil como fallback, mas não é o formato final mais eficiente.

O alvo passa a ser um **NativePack privado** com duas camadas independentes:

1. **Visual canônico** — cada página da prova é rasterizada uma única vez em WebP. Cada questão guarda somente um ou mais retângulos normalizados que apontam para as regiões da página que devem aparecer no runner.
2. **Semântica** — texto extraído do PDF/OCR para busca, classificação, acessibilidade e analytics. Se esse texto tiver erro, a questão continua visualmente correta porque a imagem vem da página original.

O gabarito nunca vem do NativePack. A alternativa correta continua sendo responsabilidade do provider validado.

Isso evita três problemas ao mesmo tempo: reconstruir fórmulas/tabelas manualmente, duplicar uma imagem por questão e depender do PDF remoto durante o treino.

## Por que não usar só texto estruturado

PDFs de vestibular misturam duas colunas, fórmulas, gráficos, tirinhas, tabelas e textos compartilhados por várias questões. Uma extração textual perfeita em 100% das páginas é cara e desnecessária para dois usuários.

A imagem da página é a fonte visual de verdade. O texto extraído é uma camada semântica auxiliar. Quando estiver perfeito, pode ser renderizado como HTML; quando não estiver, o Studium mostra o recorte visual e mantém o texto somente para classificação/busca.

## Protótipo UNESP 2026

No caderno de 40 páginas usado no Sprint 2:

- o detector por camada de texto encontrou 90/90 marcadores `QUESTÃO NN` sem OCR;
- rasterizar as 40 páginas em WebP, escala 1,5 e qualidade 82 produziu aproximadamente 4,43 MB no total;
- um teste alternativo de um WebP por questão produziu aproximadamente 3,64 MB para 90 questões, mas duplica regiões e é pior para textos compartilhados;
- por isso o formato oficial é **imagem por página + coordenadas por questão**.

Esses números são um benchmark de uma prova, não uma promessa para todas as bancas. O pipeline mede o tamanho real a cada ingestão.

## Fluxo único desejado

```text
DESCOBRIR
  ↓
FINGERPRINT DA FONTE
  ↓
VALIDAR FORMATO + GABARITO
  ↓
EXTRAIR MARCADORES/PÁGINAS
  ↓
RASTERIZAR PÁGINAS
  ↓
EXTRAIR TEXTO SEMÂNTICO
  ↓
QUALITY GATE
  ↓
REVISÃO HUMANA APENAS DO QUE FALHOU
  ↓
PUBLICAR NO CORPUS PRIVADO
  ↓
QUESTÃO NATIVA NO STUDIUM
```

### 1. Descobrir

Os discoverers existentes continuam procurando arquivo de prova, gabarito final e página de arquivo da banca. O pipeline novo não precisa conhecer HTML específico de cada instituição: ele recebe uma descrição normalizada da edição.

### 2. Fingerprint

Antes de extrair qualquer coisa:

- SHA-256 do PDF;
- tamanho em bytes;
- URL original e URL efetiva;
- número de páginas;
- versão do parser.

Se o SHA esperado divergir, o processo para. Nunca reaproveitar coordenadas de bytes diferentes.

### 3. Gate de formato

A edição só entra se o provider já tiver provado que é compatível com o Studium:

- múltipla escolha de resposta única;
- alternativas pertencem ao alfabeto A–E;
- cobertura completa do gabarito final/retificado;
- anuladas são explícitas;
- identidade de edição/fase não é ambígua.

Somatória, múltiplas corretas e questões discursivas continuam fora desse pipeline.

### 4. Extrair marcadores

Fast path: PyMuPDF lê blocos com bounding boxes e procura a numeração oficial da questão. Uma edição só passa automaticamente quando o conjunto de marcadores é exatamente `1..N`, sem falta nem duplicidade.

O retângulo inicial é uma sugestão para revisão, não uma verdade silenciosa. Layouts de uma coluna, duas colunas, questões que atravessam página e textos compartilhados podem exigir mais de uma região visual.

### 5. Rasterizar páginas

Gerar uma imagem WebP por página de conteúdo. O manifest guarda o padrão do asset, por exemplo:

```text
native/unesp/2026/first/page-003.webp
```

As questões guardam coordenadas normalizadas 0..1. Alterar a resolução futura não invalida os recortes.

### 6. Texto semântico

Ordem de custo:

1. camada de texto do próprio PDF;
2. OCR local somente nas páginas sem camada confiável;
3. parser de layout mais pesado somente em páginas difíceis;
4. visão/LLM apenas como exceção de baixa confiança, nunca no corpus inteiro.

O texto semântico pode ser corrigido depois sem alterar o visual da questão.

### 7. Quality gate

Uma questão visualmente publicável precisa ter:

- `questionKey` exata;
- documento fingerprintado;
- marcador confirmado;
- página existente;
- pelo menos uma região visual válida;
- provider/gabarito já validados.

Para ficar `semantic-ready`, além disso deve haver extração de texto suficiente para busca/classificação. Falhar nessa segunda camada não bloqueia a resolução visual.

### 8. Revisão

O extrator sempre gera `status: review`; nunca se autoaprova. A futura console de revisão mostra o recorte sugerido e permite:

- aprovar;
- ajustar o retângulo;
- adicionar uma região de contexto/continuação;
- corrigir texto semântico;
- reprovar a questão.

Depois de aprovado, o mesmo pack pode ser publicado de uma vez.

## Armazenamento

O repositório GitHub permanece sem enunciados/assets privados. O app já possui autenticação/sincronização Supabase, então a primeira implementação deve reutilizar essa infraestrutura:

- banco: manifest, texto semântico, evidência e coordenadas;
- bucket privado: WebPs das páginas;
- frontend: somente leitura;
- ingestão: credencial administrativa apenas no CLI/ambiente privado, nunca no browser.

Se o volume ultrapassar a franquia de Storage, o contrato não muda: `pageAssetPattern` é storage-agnostic e permite trocar somente o backend de objetos. Não devemos adicionar um segundo provedor antes de existir necessidade real.

## Contrato de publicação

`src/lib/native/contracts.ts` é o contrato entre extrator, review console, storage e frontend. O visual é deliberadamente independente do texto semântico e do gabarito.

`scripts/native_pipeline.py` já implementa o primeiro estágio local:

```bash
python -m pip install pymupdf pillow
python scripts/native_pipeline.py \
  --spec /caminho/spec.json \
  --pdf /caminho/prova.pdf \
  --out .native-out/provedor-edicao
```

A saída contém `native-pack.json` e `pages/page-NNN.webp`. `.native-out/` deve permanecer fora do Git.

## Próximos incrementos

O sistema completo deve evoluir nesta ordem:

1. ligar o NativePack ao review console;
2. implementar publisher privado para o storage/banco já autenticado;
3. fazer `questionsFor()` sobrepor o conteúdo nativo publicado automaticamente;
4. renderizar as regiões da página dentro do runner;
5. conectar os discoverers atuais ao gerador de spec para chegar ao comando único `discover → verify → native`;
6. só depois retomar uma nova Mass Ingestion.
