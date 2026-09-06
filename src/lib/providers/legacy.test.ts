import { describe, expect, it } from "vitest";
import { toLegacyQuestion } from "./legacy";
import { itaFirstPhaseQuestions, itaYears } from "./ita";
import { itaQuestionsForAttempt } from "../services/ita-attempts";
import type { Attempt } from "../domain/types";

// Este adaptador já existiu em duas cópias, e elas divergiam em qual campo
// virava `discipline`. Uma divergência aqui mistura o domínio de duas provas
// sem estourar nada — o tipo de defeito que só aparece nos números do painel.

const ano = itaYears()[0];

describe("adaptador legado", () => {
  it("preserva a procedência do modo referência", () => {
    const q = toLegacyQuestion(itaFirstPhaseQuestions(ano)[0]);
    expect(q.statementAvailable).toBe(false);
    expect(q.number).toBe(1);
    expect(q.official?.institution).toBe("ITA");
    expect(q.official?.documentUrl).toMatch(/^https:\/\/www\.vestibular\.ita\.br\//);
  });

  it("mantém a matéria do ITA fora das áreas do ENEM", () => {
    const areas = new Set(itaFirstPhaseQuestions(ano).map((n) => toLegacyQuestion(n).discipline));
    // Se qualquer área do ENEM aparecer aqui, os dois domínios se somam.
    for (const enem of ["matematica", "ciencias-natureza", "ciencias-humanas", "linguagens"]) {
      expect(areas.has(enem)).toBe(false);
    }
    expect(areas.has("mathematics")).toBe(true);
  });

  it("alternativa sem texto vira string vazia, não `null`", () => {
    const q = toLegacyQuestion(itaFirstPhaseQuestions(ano)[0]);
    expect(q.alternatives).toHaveLength(5);
    for (const a of q.alternatives) expect(a.text).toBe("");
  });

  it("questão anulada chega sem gabarito em vez de errado", () => {
    const anuladas = itaFirstPhaseQuestions(ano)
      .filter((n) => n.correctAlternative === null)
      .map(toLegacyQuestion);
    for (const q of anuladas) expect(q.correctAlternative).toBeUndefined();
  });

  it("o serviço do ITA usa este mesmo adaptador", () => {
    // Regressão da consolidação: o serviço tinha a própria cópia. As duas
    // saídas precisam ser idênticas, campo a campo.
    const refs = [1, 2, 3].map((index) => ({ providerId: "ita", index, year: ano, language: null }));
    const pelaTentativa = itaQuestionsForAttempt({ year: ano, questionRefs: refs } as Attempt);
    const direto = itaFirstPhaseQuestions(ano)
      .filter((n) => [1, 2, 3].includes(n.index))
      .map(toLegacyQuestion);

    expect(pelaTentativa).toEqual(direto);
  });
});
