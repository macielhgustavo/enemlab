import { describe, expect, it } from "vitest";
import {
  compareVariantKeys,
  variantBelongsInKey,
  variantsForReference,
  variantsToIngest,
  type EditionVariants,
} from "./variant";
import { buildQuestionKey } from "./question-key";

/**
 * O caso real: o ENEM aplica quatro cadernos por dia, com a mesma prova em
 * ordem diferente e um gabarito para cada. Modelar isso errado produz dois
 * estragos — duplicata no banco e, pior, correção com o gabarito do caderno
 * errado.
 */

const enem = (over: Partial<EditionVariants> = {}): EditionVariants => ({
  relation: "reordered",
  canonical: "cd1",
  variants: [
    { id: "cd1", label: "Caderno 1 — Azul" },
    { id: "cd2", label: "Caderno 2 — Amarelo" },
    { id: "cd3", label: "Caderno 3 — Branco" },
    { id: "cd4", label: "Caderno 4 — Rosa" },
  ],
  ...over,
});

describe("o que ingerir", () => {
  it("prova reordenada ingere só a canônica", () => {
    // As quatro têm as mesmas questões. Ingerir todas quadruplicaria o
    // banco com a mesma prova.
    expect(variantsToIngest(enem()).map((v) => v.id)).toEqual(["cd1"]);
    expect(variantsForReference(enem()).map((v) => v.id)).toEqual(["cd2", "cd3", "cd4"]);
  });

  it("provas realmente diferentes são todas ingeridas", () => {
    const v = enem({ relation: "distinct", canonical: undefined });
    expect(variantsToIngest(v)).toHaveLength(4);
    expect(variantsForReference(v)).toEqual([]);
  });

  it("relação desconhecida cai no caso conservador", () => {
    // Duplicar o banco é estrago maior e mais difícil de desfazer que
    // deixar conteúdo de fora.
    const v = enem({ relation: "unknown", canonical: undefined });
    expect(variantsToIngest(v)).toHaveLength(1);
    expect(variantsForReference(v)).toHaveLength(3);
  });

  it("sem canônica declarada, usa a primeira — mas de forma estável", () => {
    const v = enem({ canonical: undefined });
    expect(variantsToIngest(v).map((x) => x.id)).toEqual(["cd1"]);
    expect(variantsToIngest(v).map((x) => x.id)).toEqual(variantsToIngest(v).map((x) => x.id));
  });

  it("edição sem variante declarada não ingere nada por engano", () => {
    expect(variantsToIngest({ relation: "reordered", variants: [] })).toEqual([]);
  });
});

describe("variante na chave da questão", () => {
  it("prova reordenada não põe caderno na chave", () => {
    // Seria criar quatro identidades para a mesma questão — exatamente o
    // que o modelo existe para evitar.
    expect(variantBelongsInKey("reordered")).toBe(false);
    expect(variantBelongsInKey("unknown")).toBe(false);
  });

  it("provas distintas põem", () => {
    expect(variantBelongsInKey("distinct")).toBe(true);
  });

  it("a chave reflete a decisão", () => {
    const base = { providerId: "enem", editionId: "2025", phase: "day1", number: 5 };
    const semVariante = buildQuestionKey(base);
    const comVariante = buildQuestionKey({ ...base, variant: "cd2" });

    expect(semVariante).toBe("enem-2025-day1-5");
    expect(comVariante).toBe("enem-2025-day1-cd2-5");
    expect(semVariante).not.toBe(comVariante);
  });
});

describe("gabaritos entre variantes", () => {
  it("numa prova reordenada, os gabaritos precisam divergir", () => {
    // A questão 5 do Azul não é a 5 do Amarelo. Divergência é o esperado.
    const r = compareVariantKeys(
      { variant: "cd1", answers: { 1: "A", 2: "B", 3: "C" } },
      { variant: "cd2", answers: { 1: "C", 2: "A", 3: "B" } },
    );
    expect(r.mismatches).toHaveLength(3);
    expect(r.suspiciouslyIdentical).toBe(false);
  });

  it("gabaritos idênticos em prova reordenada são suspeitos", () => {
    // Sinal de que o importador leu o mesmo arquivo duas vezes, ou de que a
    // relação declarada está errada. Não é aprovação.
    const r = compareVariantKeys(
      { variant: "cd1", answers: { 1: "A", 2: "B" } },
      { variant: "cd2", answers: { 1: "A", 2: "B" } },
    );
    expect(r.mismatches).toEqual([]);
    expect(r.suspiciouslyIdentical).toBe(true);
  });

  it("aponta exatamente onde os gabaritos diferem", () => {
    const r = compareVariantKeys(
      { variant: "cd1", answers: { 1: "A", 2: "B" } },
      { variant: "cd2", answers: { 1: "A", 2: "E" } },
    );
    expect(r.mismatches).toEqual([
      { number: 2, variantA: "cd1", letterA: "B", variantB: "cd2", letterB: "E" },
    ]);
  });

  it("sem gabarito nenhum, não afirma suspeita", () => {
    const r = compareVariantKeys({ variant: "a", answers: {} }, { variant: "b", answers: {} });
    expect(r.suspiciouslyIdentical).toBe(false);
  });
});
