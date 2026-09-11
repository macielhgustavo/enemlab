# Piloto nativo UFT 2025.1 — tarde

## Cobertura

| Provider | Edição | Fase | Itens | Nativos | Referências | Anuladas | Validação |
|---|---|---|---:|---:|---:|---|---|
| uft | 2025-1 | afternoon | 44 | 12 | 32 | 28 | reviewed |

Nativos: 29, 31, 32, 33, 34, 35, 37, 38, 40, 41, 42, 43.
Gabaritos finais: B, C, A, D, D, C, B, C, A, D, D, C.
Não há 44 enunciados nativos. Manhã, línguas estrangeiras e redação não foram
ingeridas. A numeração da manhã não pode ser mesclada à tarde.
Somente um caderno da tarde foi observado: relação de variantes `unknown`,
sem canonicalização entre versões. Categorias amplas seguem os blocos do PDF:
Ciências Humanas (1–20) e Ciências da Natureza (21–44).

## Fonte e descoberta

- [Página oficial da edição](https://www.uft.edu.br/concursos-e-selecoes/ingresso-na-graduacao/vestibular-1/vestibular-2025-1).
- [Prova Tarde](https://docs.uft.edu.br/s/P-0pXSKSS8mxANW9EinpMA).
- [Gabarito Definitivo](https://docs.uft.edu.br/s/B2cJn4eoT-iGHw0f--vPOg), datado de 27/11/2024.

Descoberta manual pelos links rotulados na página oficial, não por nomes
inferidos. Os URLs efetivos em `answer-keys.generated.json` são os endpoints
de conteúdo usados pelo visualizador público Alfresco dessas páginas.
Download HTTPS em 10/09/2026. Prova: 1.126.694 bytes,
SHA-256 `77baa13ffbf7d07eca6c1a2bcf85897951d268822ea6099f1813b5f8f8e1cfa0`.
Gabarito: 447.122 bytes,
SHA-256 `2e69674f0b64aa2518d84f24619096ad942484e019f8801e234eb34213ac8daa`.

Estado da descoberta: tarde descoberta e aceita; manhã descoberta mas não
ingerida; nenhuma afirmação de cobertura completa do arquivo histórico UFT.
UFVJM também foi investigada, mas o download oficial falhou por DNS/conexão;
nenhum provider ou questão UFVJM foi publicado.

## Evidência de validação

Parser `uft-afternoon@1.0.0`: isola a tabela após PROVA TARDE, exige o título
GABARITO DEFINITIVO e a edição 2025.1, lê exatamente 44 números únicos,
alternativas A–D ou ANULADA. Não utiliza o gabarito provisório.
A questão 35 usa a resposta C do definitivo, não uma resposta inferida.
Qualquer alteração de hash exige nova revisão, inclusive retificações futuras.

Transcrição `uft-native-manual@1.0.0` e `uft-native-manual@1.1.0`:
comparação visual feita por Codex com as páginas físicas 8 a 11 (impressas
7 a 10). Texto e fórmulas foram convertidos
em caracteres Unicode; não foram criadas resoluções ou corrigidos erros do original.
Em Q31 as legendas castanho/incolor ficam associadas explicitamente aos gases.
Q33 preserva COH como impresso. Q30 fica em referência porque seu diagrama
não foi transcrito; Q36 permanece em referência por uma aparente inconsistência
na equação original. Q39 permanece em referência porque adapta uma reportagem
do G1; Q44 permanece em referência porque reproduz uma figura atribuída a livro
da FTD. Não se trata de revisão humana independente.

## Direitos

O portal oficial declara Creative Commons Atribuição-SemDerivações 3.0.
O piloto aplica essa declaração somente às doze questões selecionadas, sem
material de terceiros identificado nelas. Atribuição UFT/COPESE, link da
prova, evidência da declaração e link da licença acompanham cada questão.
Não é autorização genérica para republicar textos/imagens de terceiros
citados em outras questões ou provas. Fonte/base: `official-reference`;
doze transcrições: `allowed`, com evidência individual. Revisão humana do
alcance da licença e da fidelidade é recomendada antes do merge.

## Reprodução

Baixe a prova e o definitivo pelos links oficiais acima e mantenha os PDFs
fora do Git. Com `pdfplumber` instalado:

```sh
python scripts/verify_uft.py --exam prova.pdf --answer-key gabarito.pdf
npm run native:validate -- data/native/uft-2025-1.json
npm run native:validate -- data/native/uft-2025-1.json --publish
npm run sources:audit -- --provider uft
```

O verificador não usa rede nem publica; compara hashes, tamanho e todas as
respostas com a base versionada. A publicação usa o contrato nativo existente:
JSON por hash fora do JavaScript inicial, carregamento por edição, chaves
estáveis, sem sobrescrever gabarito. Repetir a publicação é idempotente.

Unitários não dependem da rede. O E2E seleciona UFT, encontra o texto real
no Banco e responde Q29 no resolvedor sem painel PDF, preservando a resposta
após recarregar. Nenhuma mudança de aparência ou snapshot foi necessária.
