# Próximas bancas: response model antes do provider

Pesquisa técnica em 2026-09-12/13 para decidir se UEPG, UEM e UFSC podem entrar no Studium Labs usando o modelo atual de resposta única.

## Decisão

**Não ativar UEPG, UEM ou UFSC como providers usando `A-E`.**

A próxima expansão depois da UNESP precisa primeiro representar respostas além de escolha única. Forçar essas bancas no contrato atual produziria correção semanticamente errada, mesmo que os PDFs e gabaritos fossem baixados corretamente.

## Evidência por banca

### UEPG

Fontes:

- Vestibular 2026: `https://www2.uepg.br/cps/vestibular-2026/`
- Gabarito definitivo do Vestibular 2025: `https://www2.uepg.br/cps/wp-content/uploads/sites/270/2025/12/EDITAL-N-51_2025-_CPS_GABARITO-VESTIBULAR-2025_Apos-Recursos.pdf`

O gabarito definitivo de 2025 publica, para cada questão, as proposições corretas e o **somatório correto**. Há respostas como `24`, `05`, `31`, `17`, etc., obtidas pela combinação de proposições `01`, `02`, `04`, `08` e `16`.

Conclusão: `single-choice A-E` não representa a prova corretamente.

### UEM

Fontes oficiais:

- Vestibular de Inverno 2026: `https://www.vestibular.uem.br/evento_62.html`
- Manual do Candidato 2026: `https://www.vestibular.uem.br/manuais/manual_candidato_62.pdf`
- Gabarito definitivo: `https://www.vestibular.uem.br/provas/in26/gabdef.pdf`

O manual define 50 questões objetivas. Cada questão possui cinco afirmações identificadas por `01`, `02`, `04`, `08` e `16`; a resposta é a soma dos valores das afirmações corretas. Se nenhuma estiver correta, a resposta é `00`. O regulamento também prevê pontuação parcial quando aplicável.

Conclusão: é uma questão de **seleção de proposições com codificação por soma**, não uma alternativa única.

### UFSC

Fontes oficiais:

- Provas e gabaritos 2026: `https://vestibularunificado2026.ufsc.br/provas-e-gabaritos/`
- Arquivo de provas anteriores: `https://vestibularunificado2027.ufsc.br/provas-anteriores/`
- Exemplo de gabarito oficial 2026: `https://vestibularunificado2026.ufsc.br/files/2025/12/novo_gabarito_p1_marrom.pdf`

O gabarito da Prova 1 de 2026 lista proposições `01`, `02`, `04`, `08`, `16`, `32` e `64`, dependendo da questão, e registra o valor final do gabarito como soma. O mesmo gabarito também identifica questão `ABERTA`.

Conclusão: a UFSC exige pelo menos `sum-of-propositions` **e** `open`, além de variantes/cor de prova.

## Contrato mínimo proposto

Não migrar `Question`, `Attempt`, SRS ou catálogo agora. Primeiro introduzir um contrato independente e testado:

```ts
type ResponseModel =
  | {
      kind: "single-choice";
      optionIds: string[];
    }
  | {
      kind: "sum-of-propositions";
      propositionValues: number[];
      zeroAnswerAllowed: boolean;
      displayWidth?: number;
    }
  | {
      kind: "open";
      answerFormat?: "text" | "integer" | "decimal";
    };
```

O gabarito canônico deve guardar a **semântica**, e não apenas o texto digitado:

- single-choice: `"C"`;
- sum-of-propositions: proposições corretas `[1, 4, 16]` e soma derivada `21`;
- open: valor/resposta esperada em estrutura própria.

Para provas de somatória, guardar apenas `21` perde informação útil. Duas extrações diferentes poderiam chegar ao mesmo inteiro por erro de parsing; manter as proposições permite validar e explicar a correção.

## Pontuação

A correção binária `isCorrect` pode continuar existindo como sinal comum, mas **não deve ser usada para reproduzir a nota oficial** de UEPG/UEM/UFSC sem um `scoringPolicy` separado.

Motivo: há bancas que atribuem pontuação parcial ou regras próprias de penalização. O Studium Labs pode inicialmente usar:

- `exactMatch` para domínio/SRS;
- pontuação oficial somente quando a política da edição estiver modelada e testada.

Nunca inventar TRI ou equivalência entre bancas.

## Ordem de implementação

1. concluir UNESP com `single-choice` usando o adapter genérico do corpus;
2. introduzir `ResponseModel` como contrato independente, sem migração destrutiva;
3. testar `sum-of-propositions` com **uma** edição real (preferência: UEM 2026, por ter prova, manual e gabarito oficiais acessíveis);
4. só depois adaptar UEPG;
5. UFSC entra por último entre as três porque adiciona variantes numerosas e questões abertas.

## Gate arquitetural

Uma nova banca só pode ser ativada quando:

- o response model representa a resposta sem perda semântica;
- a identidade inclui edição/fase/variante necessárias;
- gabarito final/retificado prevalece sobre preliminar;
- bytes/documentos têm provenance e fingerprints;
- a edição chega a `ready-for-review` sem condição específica dentro de `engine.ts`;
- revisão humana produz o artifact de handoff;
- o provider não mistura histórico/mastery/SRS com outra prova.
